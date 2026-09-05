import { createHash, randomUUID } from 'node:crypto';
import {
  AppError,
  sceneVideoGenerationDtoSchema,
  sceneVideoReviewUpdateSchema,
  videoGenerationSettingsSchema,
  videoGenerationSettingsUpdateSchema,
  type AiMotionPlanDto,
  type AiMotionPlanIntent,
  type Id,
  type MotionSource,
  type SceneVideoGenerationDto,
  type SceneVideoReviewUpdate,
  type VideoGenerationSettings,
  type VideoGenerationSettingsDto,
  type VideoGenerationSettingsUpdate,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';
import { AssetRepository, invalidateAssetDependents, type StepLeaseGuard } from './repositories.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value ?? {});
const safeError = (value: string): string => value.slice(0, 2_000);

export const VIDEO_MAPPING_VERSION = 'image-to-video-v1-mapping-1';

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

export function videoSettingsFingerprint(settings: VideoGenerationSettings): string {
  return fingerprint({
    version: VIDEO_MAPPING_VERSION,
    input: {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      backend: settings.backend,
      workflowTemplate: settings.workflowTemplate,
      diffusionModel: settings.diffusionModel,
      textEncoder: settings.textEncoder,
      vaeName: settings.vaeName,
      ltxCheckpoint: settings.ltxCheckpoint,
      ltxTextEncoder: settings.ltxTextEncoder,
      ltxVaeName: settings.ltxVaeName,
      ltxFps: settings.ltxFps,
      sampler: settings.sampler,
      scheduler: settings.scheduler,
      steps: settings.steps,
      guidance: settings.guidance,
      shift: settings.shift,
      preset: settings.preset,
    },
  });
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new AppError('DATA_CORRUPTION', 'Stored video metadata is invalid', 500);
  return parsed as Record<string, unknown>;
}

function assertSafePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]/).includes('..')
  )
    throw new AppError('UNSAFE_PATH', 'Asset path must be workspace-relative', 400);
}

export function sceneVideoRole(sceneStableId: string): string {
  return `scene:${sceneStableId}:ai-motion`;
}

const PLAN_COLUMNS = `id,project_id as projectId,chapter_id as chapterId,scene_stable_id as sceneId,
  scene_revision_id as sceneRevisionId,revision,character_action as characterAction,
  environment_motion as environmentMotion,camera_motion as cameraMotion,intensity,priority,
  motion_prompt as motionPrompt,negative_prompt as negativePrompt,
  input_fingerprint as inputFingerprint,status,is_current as isCurrent,
  created_at as createdAt,updated_at as updatedAt`;

type VideoSettingsRow = {
  id: Id;
  projectId: Id;
  provider: string;
  baseUrl: string;
  backend: string;
  workflowTemplate: string;
  diffusionModel: string;
  textEncoder: string;
  vaeName: string;
  ltxCheckpoint: string;
  ltxTextEncoder: string;
  ltxVaeName: string;
  ltxFps: number;
  sampler: string;
  scheduler: string;
  steps: number;
  guidance: number;
  shift: number;
  preset: string;
  connectionTimeoutMs: number;
  generationTimeoutMs: number;
  seedMode: string;
  fixedSeed: number | null;
  requireMotionApproval: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

function parseSettings(row: VideoSettingsRow): VideoGenerationSettingsDto {
  const settings = videoGenerationSettingsSchema.parse({
    provider: row.provider,
    baseUrl: row.baseUrl,
    backend: row.backend,
    workflowTemplate: row.workflowTemplate,
    diffusionModel: row.diffusionModel,
    textEncoder: row.textEncoder,
    vaeName: row.vaeName,
    ltxCheckpoint: row.ltxCheckpoint,
    ltxTextEncoder: row.ltxTextEncoder,
    ltxVaeName: row.ltxVaeName,
    ltxFps: row.ltxFps,
    sampler: row.sampler,
    scheduler: row.scheduler,
    steps: row.steps,
    guidance: row.guidance,
    shift: row.shift,
    preset: row.preset,
    connectionTimeoutMs: row.connectionTimeoutMs,
    generationTimeoutMs: row.generationTimeoutMs,
    seedMode: row.seedMode,
    fixedSeed: row.fixedSeed,
    requireMotionApproval: Boolean(row.requireMotionApproval),
  });
  return {
    ...settings,
    id: row.id,
    projectId: row.projectId,
    rowVersion: row.rowVersion,
    inputFingerprint: videoSettingsFingerprint(settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SETTINGS_COLUMNS = `id,project_id as projectId,provider,base_url as baseUrl,
  backend,workflow_template as workflowTemplate,diffusion_model as diffusionModel,text_encoder as textEncoder,
  vae_name as vaeName,ltx_checkpoint as ltxCheckpoint,ltx_text_encoder as ltxTextEncoder,
  ltx_vae_name as ltxVaeName,ltx_fps as ltxFps,sampler,scheduler,steps,guidance,shift,preset,
  connection_timeout_ms as connectionTimeoutMs,generation_timeout_ms as generationTimeoutMs,
  seed_mode as seedMode,fixed_seed as fixedSeed,require_motion_approval as requireMotionApproval,
  row_version as rowVersion,created_at as createdAt,updated_at as updatedAt`;

export class VideoGenerationSettingsRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get(projectId: Id): VideoGenerationSettingsDto | null {
    const row = this.database.sqlite
      .prepare(`SELECT ${SETTINGS_COLUMNS} FROM video_generation_settings WHERE project_id=?`)
      .get(projectId) as VideoSettingsRow | undefined;
    return row ? parseSettings(row) : null;
  }

  getOrCreate(projectId: Id): VideoGenerationSettingsDto {
    const existing = this.get(projectId);
    if (existing) return existing;
    const project = this.database.sqlite
      .prepare('SELECT 1 FROM projects WHERE id=?')
      .get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = videoGenerationSettingsSchema.parse({});
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT OR IGNORE INTO video_generation_settings(
          id,project_id,provider,base_url,backend,workflow_template,diffusion_model,text_encoder,vae_name,
          ltx_checkpoint,ltx_text_encoder,ltx_vae_name,ltx_fps,sampler,scheduler,steps,guidance,shift,preset,
          connection_timeout_ms,generation_timeout_ms,seed_mode,fixed_seed,require_motion_approval,row_version,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        projectId,
        settings.provider,
        settings.baseUrl,
        settings.backend,
        settings.workflowTemplate,
        settings.diffusionModel,
        settings.textEncoder,
        settings.vaeName,
        settings.ltxCheckpoint,
        settings.ltxTextEncoder,
        settings.ltxVaeName,
        settings.ltxFps,
        settings.sampler,
        settings.scheduler,
        settings.steps,
        settings.guidance,
        settings.shift,
        settings.preset,
        settings.connectionTimeoutMs,
        settings.generationTimeoutMs,
        settings.seedMode,
        settings.fixedSeed,
        settings.requireMotionApproval ? 1 : 0,
        1,
        stamp,
        stamp,
      );
    return this.get(projectId)!;
  }

  update(projectId: Id, value: VideoGenerationSettingsUpdate): VideoGenerationSettingsDto {
    const input = videoGenerationSettingsUpdateSchema.parse(value);
    const { expectedRowVersion: expected, ...settingsInput } = input;
    const current = this.getOrCreate(projectId);
    if (expected !== undefined && expected !== current.rowVersion)
      throw new AppError('CONFLICT', 'Video generation settings changed; reload and retry', 409);
    const settings = videoGenerationSettingsSchema.parse(settingsInput);
    const result = this.database.sqlite
      .prepare(
        `UPDATE video_generation_settings SET provider=?,base_url=?,backend=?,workflow_template=?,diffusion_model=?,
          text_encoder=?,vae_name=?,ltx_checkpoint=?,ltx_text_encoder=?,ltx_vae_name=?,ltx_fps=?,
          sampler=?,scheduler=?,steps=?,guidance=?,shift=?,preset=?,
          connection_timeout_ms=?,generation_timeout_ms=?,seed_mode=?,fixed_seed=?,
          require_motion_approval=?,row_version=row_version+1,updated_at=?
         WHERE project_id=? AND row_version=?`,
      )
      .run(
        settings.provider,
        settings.baseUrl,
        settings.backend,
        settings.workflowTemplate,
        settings.diffusionModel,
        settings.textEncoder,
        settings.vaeName,
        settings.ltxCheckpoint,
        settings.ltxTextEncoder,
        settings.ltxVaeName,
        settings.ltxFps,
        settings.sampler,
        settings.scheduler,
        settings.steps,
        settings.guidance,
        settings.shift,
        settings.preset,
        settings.connectionTimeoutMs,
        settings.generationTimeoutMs,
        settings.seedMode,
        settings.fixedSeed,
        settings.requireMotionApproval ? 1 : 0,
        now(),
        projectId,
        current.rowVersion,
      );
    if (result.changes !== 1)
      throw new AppError('CONFLICT', 'Video generation settings changed; reload and retry', 409);
    return this.get(projectId)!;
  }
}

export class SceneMotionSourceRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get(projectId: Id, sceneStableId: string): MotionSource {
    const row = this.database.sqlite
      .prepare(
        'SELECT motion_source as motionSource FROM scene_motion_sources WHERE project_id=? AND scene_stable_id=?',
      )
      .get(projectId, sceneStableId) as { motionSource: string } | undefined;
    return (row?.motionSource as MotionSource | undefined) ?? 'KEN_BURNS';
  }

  listByProject(projectId: Id): Record<string, MotionSource> {
    const rows = this.database.sqlite
      .prepare(
        'SELECT scene_stable_id as sceneStableId,motion_source as motionSource FROM scene_motion_sources WHERE project_id=?',
      )
      .all(projectId) as Array<{ sceneStableId: string; motionSource: string }>;
    const result: Record<string, MotionSource> = {};
    for (const row of rows) result[row.sceneStableId] = row.motionSource as MotionSource;
    return result;
  }

  set(projectId: Id, sceneStableId: string, motionSource: MotionSource): void {
    const scene = this.database.sqlite
      .prepare('SELECT 1 FROM scene_revisions WHERE project_id=? AND stable_id=? AND is_current=1')
      .get(projectId, sceneStableId);
    if (!scene) throw new AppError('NOT_FOUND', 'Scene not found', 404);
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO scene_motion_sources(id,project_id,scene_stable_id,motion_source,created_at,updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(project_id,scene_stable_id)
         DO UPDATE SET motion_source=excluded.motion_source,updated_at=excluded.updated_at`,
      )
      .run(randomUUID(), projectId, sceneStableId, motionSource, stamp, stamp);
  }
}

export type CreateAiMotionPlanInput = {
  projectId: Id;
  chapterId: Id;
  sceneStableId: string;
  sceneRevisionId: Id;
  intent: AiMotionPlanIntent;
  motionPrompt: string;
  negativePrompt: string | null;
  inputFingerprint: string;
};

type AiMotionPlanRow = {
  id: Id;
  projectId: Id;
  chapterId: Id;
  sceneId: string;
  sceneRevisionId: Id;
  revision: number;
  characterAction: string;
  environmentMotion: string;
  cameraMotion: string;
  intensity: string;
  priority: string;
  motionPrompt: string;
  negativePrompt: string | null;
  inputFingerprint: string;
  status: string;
  isCurrent: number;
  createdAt: string;
  updatedAt: string;
};

function parsePlan(row: AiMotionPlanRow): AiMotionPlanDto {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId,
    sceneId: row.sceneId,
    sceneRevisionId: row.sceneRevisionId,
    revision: row.revision,
    intent: {
      characterAction: row.characterAction,
      environmentMotion: row.environmentMotion,
      cameraMotion: row.cameraMotion as AiMotionPlanIntent['cameraMotion'],
      intensity: row.intensity as AiMotionPlanIntent['intensity'],
      priority: row.priority as AiMotionPlanIntent['priority'],
    },
    motionPrompt: row.motionPrompt,
    negativePrompt: row.negativePrompt,
    inputFingerprint: row.inputFingerprint,
    status: row.status as 'CURRENT' | 'INVALIDATED',
    isCurrent: Boolean(row.isCurrent),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AiMotionPlanRepository {
  constructor(private readonly database: DatabaseHandle) {}

  getCurrent(projectId: Id, sceneRevisionId: Id): AiMotionPlanDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT ${PLAN_COLUMNS} FROM ai_motion_plan_revisions
         WHERE project_id=? AND scene_revision_id=? AND is_current=1`,
      )
      .get(projectId, sceneRevisionId) as AiMotionPlanRow | undefined;
    return row ? parsePlan(row) : null;
  }

  list(projectId: Id, sceneStableId: string, limit = 50): AiMotionPlanDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT ${PLAN_COLUMNS} FROM ai_motion_plan_revisions
         WHERE project_id=? AND scene_stable_id=?
         ORDER BY revision DESC LIMIT ?`,
      )
      .all(projectId, sceneStableId, Math.max(1, Math.min(100, limit))) as AiMotionPlanRow[];
    return rows.map(parsePlan);
  }

  create(input: CreateAiMotionPlanInput): AiMotionPlanDto {
    const scene = this.database.sqlite
      .prepare('SELECT stable_id as stableId FROM scene_revisions WHERE id=? AND project_id=?')
      .get(input.sceneRevisionId, input.projectId) as { stableId: string } | undefined;
    if (!scene || scene.stableId !== input.sceneStableId)
      throw new AppError('NOT_FOUND', 'Scene revision not found', 404);
    return this.database.sqlite.transaction(() => {
      const stamp = now();
      this.database.sqlite
        .prepare(
          'UPDATE ai_motion_plan_revisions SET is_current=0,status=? WHERE scene_revision_id=? AND is_current=1',
        )
        .run('INVALIDATED', input.sceneRevisionId);
      const latest = this.database.sqlite
        .prepare(
          'SELECT COALESCE(MAX(revision),0) as revision FROM ai_motion_plan_revisions WHERE scene_revision_id=?',
        )
        .get(input.sceneRevisionId) as { revision: number };
      const id = randomUUID();
      this.database.sqlite
        .prepare(
          `INSERT INTO ai_motion_plan_revisions(
            id,project_id,chapter_id,scene_stable_id,scene_revision_id,revision,character_action,
            environment_motion,camera_motion,intensity,priority,motion_prompt,negative_prompt,
            input_fingerprint,status,is_current,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.projectId,
          input.chapterId,
          input.sceneStableId,
          input.sceneRevisionId,
          latest.revision + 1,
          input.intent.characterAction,
          input.intent.environmentMotion,
          input.intent.cameraMotion,
          input.intent.intensity,
          input.intent.priority,
          input.motionPrompt,
          input.negativePrompt,
          input.inputFingerprint,
          'CURRENT',
          1,
          stamp,
          stamp,
        );
      return this.getCurrent(input.projectId, input.sceneRevisionId)!;
    })();
  }
}

export type CreateSceneVideoGenerationInput = {
  projectId: Id;
  chapterId: Id;
  sceneStableId: string;
  sceneRevisionId: Id;
  aiMotionPlanRevisionId: Id | null;
  provider: string | null;
  status?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  requestedSeed: number | null;
  requestedWidth: number | null;
  requestedHeight: number | null;
  frameCount: number | null;
  fps: number | null;
  providerJobId: Id | null;
  workflowTemplate: string | null;
  modelSettings: Record<string, unknown>;
  requestSnapshot: Record<string, unknown>;
  motionPlanFingerprint: string | null;
  settingsFingerprint: string | null;
  inputFingerprint: string;
  sourceImageAssetId: Id;
  sourceImageSha256: string;
  generationInstructions: string | null;
  metadata?: Record<string, unknown>;
};

export type GeneratedVideoCommitInput = {
  generationId: Id;
  projectId: Id;
  sceneStableId: string;
  sceneRevisionId: Id;
  assetPath: string;
  mediaType: 'video/mp4' | 'video/webm';
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  seed: number;
  fps: number;
  frameCount: number;
  clipDurationMs: number;
  generationDurationMs: number;
  metadata?: Record<string, unknown>;
};

const generationSelect = `SELECT g.id,g.project_id as projectId,g.chapter_id as chapterId,
  g.scene_stable_id as sceneStableId,g.scene_revision_id as sceneRevisionId,g.revision,g.provider,g.status,
  g.review_status as reviewStatus,g.is_current as isCurrent,g.requested_seed as requestedSeed,
  g.actual_seed as actualSeed,g.requested_width as requestedWidth,g.requested_height as requestedHeight,
  g.actual_width as actualWidth,g.actual_height as actualHeight,g.frame_count as frameCount,
  g.fps,g.provider_job_id as providerJobId,g.workflow_template as workflowTemplate,
  g.input_fingerprint as inputFingerprint,g.source_image_asset_id as sourceImageAssetId,
  g.source_image_sha256 as sourceImageSha256,g.attempt,g.asset_id as assetId,
  g.clip_duration_ms as clipDurationMs,g.generation_duration_ms as generationDurationMs,
  g.error_code as errorCode,g.error,g.generation_instructions as generationInstructions,
  g.metadata,g.review_issues as reviewIssues,g.review_notes as reviewNotes,
  g.created_at as createdAt,g.started_at as startedAt,
  g.completed_at as completedAt,g.updated_at as updatedAt
  FROM scene_video_generations g`;

type GenerationRow = {
  id: Id;
  projectId: Id;
  sceneId: string;
  sceneStableId: string;
  sceneRevisionId: Id;
  revision: number;
  provider: string | null;
  status: string;
  reviewStatus: string;
  isCurrent: number;
  requestedSeed: number | null;
  actualSeed: number | null;
  requestedWidth: number | null;
  requestedHeight: number | null;
  actualWidth: number | null;
  actualHeight: number | null;
  frameCount: number | null;
  fps: number | null;
  providerJobId: string | null;
  workflowTemplate: string | null;
  inputFingerprint: string;
  sourceImageAssetId: Id | null;
  sourceImageSha256: string | null;
  attempt: number;
  assetId: Id | null;
  clipDurationMs: number | null;
  generationDurationMs: number | null;
  errorCode: string | null;
  error: string | null;
  generationInstructions: string | null;
  metadata: string;
  reviewIssues: string;
  reviewNotes: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type GenerationCommitRow = {
  motionPlanFingerprint: string | null;
  settingsFingerprint: string | null;
  inputFingerprint: string;
  status: string;
  metadata: string;
};

type CurrentSelectionRow = {
  sceneRevisionId: Id;
  assetId: Id | null;
  status: string;
  reviewStatus: string;
  assetStatus: string | null;
};

export class SceneVideoGenerationRepository {
  constructor(private readonly database: DatabaseHandle) {}

  private retireCurrentRoleAsset(projectId: Id, role: string, stamp: string): void {
    const current = this.database.sqlite
      .prepare('SELECT id FROM assets WHERE project_id=? AND role=? AND is_current=1')
      .all(projectId, role) as Array<{ id: Id }>;
    this.database.sqlite
      .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
      .run(stamp, projectId, role);
    for (const asset of current)
      invalidateAssetDependents(this.database, projectId, asset.id, stamp);
  }

  // Same canonical downstream Scene-image gate as
  // AssetRepository.currentRenderableSceneImage: a rejected or
  // approval-blocked current image cannot feed AI video generation.
  currentSourceImageSha(projectId: Id, sceneStableId: string): string | null {
    const asset = new AssetRepository(this.database).currentRenderableSceneImage(
      projectId,
      sceneStableId,
    );
    return asset?.sha256 ?? null;
  }

  get(projectId: Id, generationId: Id): SceneVideoGenerationDto | null {
    const row = this.database.sqlite
      .prepare(`${generationSelect} WHERE g.project_id=? AND g.id=?`)
      .get(projectId, generationId) as GenerationRow | undefined;
    return row ? this.parseGeneration(row) : null;
  }

  getCurrent(projectId: Id, sceneStableId: string): SceneVideoGenerationDto | null {
    const row = this.database.sqlite
      .prepare(
        `${generationSelect} WHERE g.project_id=? AND g.scene_stable_id=? AND g.is_current=1`,
      )
      .get(projectId, sceneStableId) as GenerationRow | undefined;
    return row ? this.parseGeneration(row) : null;
  }

  getByProviderJobId(projectId: Id, providerJobId: Id): SceneVideoGenerationDto | null {
    const row = this.database.sqlite
      .prepare(`${generationSelect} WHERE g.project_id=? AND g.provider_job_id=?`)
      .get(projectId, providerJobId) as GenerationRow | undefined;
    return row ? this.parseGeneration(row) : null;
  }

  list(projectId: Id, sceneStableId: string, limit = 50, offset = 0): SceneVideoGenerationDto[] {
    const rows = this.database.sqlite
      .prepare(
        `${generationSelect} WHERE g.project_id=? AND g.scene_stable_id=? ORDER BY g.revision DESC LIMIT ? OFFSET ?`,
      )
      .all(
        projectId,
        sceneStableId,
        Math.max(1, Math.min(100, limit)),
        Math.max(0, offset),
      ) as GenerationRow[];
    return rows.map((row) => this.parseGeneration(row));
  }

  // Reuse lookup: any completed generation with the identical raw
  // fingerprint is reusable, regardless of which revision is current.
  findCompletedByFingerprint(
    projectId: Id,
    sceneStableId: string,
    inputFingerprint: string,
  ): SceneVideoGenerationDto | null {
    const row = this.database.sqlite
      .prepare(
        `${generationSelect}
         WHERE g.project_id=? AND g.scene_stable_id=? AND g.input_fingerprint=? AND g.status='COMPLETED'
         ORDER BY g.revision DESC LIMIT 1`,
      )
      .get(projectId, sceneStableId, inputFingerprint) as GenerationRow | undefined;
    return row ? this.parseGeneration(row) : null;
  }

  nextRevision(projectId: Id, sceneStableId: string): number {
    const row = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM scene_video_generations WHERE project_id=? AND scene_stable_id=?',
      )
      .get(projectId, sceneStableId) as { revision: number };
    return row.revision + 1;
  }

  create(input: CreateSceneVideoGenerationInput): SceneVideoGenerationDto {
    const scene = this.database.sqlite
      .prepare('SELECT stable_id as stableId FROM scene_revisions WHERE id=? AND project_id=?')
      .get(input.sceneRevisionId, input.projectId) as { stableId: string } | undefined;
    if (!scene || scene.stableId !== input.sceneStableId)
      throw new AppError('NOT_FOUND', 'Scene revision not found', 404);
    if (!input.provider || !input.providerJobId)
      throw new AppError('INVALID_INPUT', 'Generated video fields are incomplete', 400);
    const imageSha = this.currentSourceImageSha(input.projectId, input.sceneStableId);
    if (!imageSha || imageSha !== input.sourceImageSha256)
      throw new AppError('STALE_INPUT', 'Scene image is not the current accepted image', 409);
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO scene_video_generations(
          id,project_id,chapter_id,scene_stable_id,scene_revision_id,ai_motion_plan_revision_id,revision,
          provider,status,review_status,is_current,requested_seed,requested_width,requested_height,
          frame_count,fps,provider_job_id,workflow_template,model_settings,request_snapshot,
          motion_plan_fingerprint,settings_fingerprint,input_fingerprint,source_image_asset_id,
          source_image_sha256,attempt,generation_instructions,metadata,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectId,
        input.chapterId,
        input.sceneStableId,
        input.sceneRevisionId,
        input.aiMotionPlanRevisionId,
        this.nextRevision(input.projectId, input.sceneStableId),
        input.provider,
        input.status ?? 'PENDING',
        'UNREVIEWED',
        0,
        input.requestedSeed,
        input.requestedWidth,
        input.requestedHeight,
        input.frameCount,
        input.fps,
        input.providerJobId,
        input.workflowTemplate,
        json(input.modelSettings),
        json(input.requestSnapshot),
        input.motionPlanFingerprint,
        input.settingsFingerprint,
        input.inputFingerprint,
        input.sourceImageAssetId,
        input.sourceImageSha256,
        0,
        input.generationInstructions,
        json(input.metadata ?? {}),
        stamp,
        stamp,
      );
    return this.get(input.projectId, id)!;
  }

  linkWorkflowStep(projectId: Id, generationId: Id, workflowStepId: Id): void {
    const result = this.database.sqlite
      .prepare(
        'UPDATE scene_video_generations SET workflow_step_id=?,updated_at=? WHERE project_id=? AND id=?',
      )
      .run(workflowStepId, now(), projectId, generationId);
    if (result.changes !== 1)
      throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
  }

  markRunning(projectId: Id, generationId: Id, attempt: number): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_video_generations SET status='RUNNING',attempt=?,started_at=COALESCE(started_at,?),
          error_code=NULL,error=NULL,updated_at=? WHERE project_id=? AND id=? AND status IN ('PENDING','RUNNING')`,
      )
      .run(attempt, now(), now(), projectId, generationId);
  }

  markFailed(projectId: Id, generationId: Id, code: string, message: string): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_video_generations SET status='FAILED',error_code=?,error=?,updated_at=?
         WHERE project_id=? AND id=? AND status IN ('PENDING','RUNNING')`,
      )
      .run(code, safeError(message), now(), projectId, generationId);
  }

  markRetryPending(projectId: Id, generationId: Id, code: string, message: string): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_video_generations SET status='PENDING',error_code=?,error=?,updated_at=?
         WHERE project_id=? AND id=? AND status='RUNNING'`,
      )
      .run(code, safeError(message), now(), projectId, generationId);
  }

  markCancelled(projectId: Id, generationId: Id, message = 'Video generation cancelled'): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_video_generations SET status='CANCELLED',error_code='CANCELLED',error=?,updated_at=?
         WHERE project_id=? AND id=? AND status IN ('PENDING','RUNNING')`,
      )
      .run(safeError(message), now(), projectId, generationId);
  }

  // A completed output is fresh only when the source image, the motion plan,
  // and the provider settings all still match their current rows.
  private freshnessInputs(
    projectId: Id,
    sceneStableId: string,
    sceneRevisionId: Id,
    row: {
      sourceImageSha256: string | null;
      motionPlanFingerprint: string | null;
      settingsFingerprint: string | null;
    },
  ): { fresh: boolean; requireApproval: boolean } {
    const settingsRow = this.database.sqlite
      .prepare(`SELECT ${SETTINGS_COLUMNS} FROM video_generation_settings WHERE project_id=?`)
      .get(projectId) as VideoSettingsRow | undefined;
    const settings = settingsRow
      ? {
          inputFingerprint: videoSettingsFingerprint(parseSettings(settingsRow)),
          requireMotionApproval: settingsRow.requireMotionApproval,
        }
      : undefined;
    const plan = this.database.sqlite
      .prepare(
        'SELECT input_fingerprint as inputFingerprint FROM ai_motion_plan_revisions WHERE project_id=? AND scene_revision_id=? AND is_current=1',
      )
      .get(projectId, sceneRevisionId) as { inputFingerprint: string } | undefined;
    const imageSha = this.currentSourceImageSha(projectId, sceneStableId);
    // Freshness is CONTENT staleness only: source image and motion plan.
    // Generation settings (preset, sampler, timeouts) shape future requests;
    // they must not retroactively stale existing raw clips (raw reuse rule).
    const fresh = Boolean(
      row.sourceImageSha256 &&
      imageSha &&
      row.sourceImageSha256 === imageSha &&
      row.motionPlanFingerprint &&
      plan &&
      row.motionPlanFingerprint === plan.inputFingerprint,
    );
    return { fresh, requireApproval: Boolean(settings?.requireMotionApproval) };
  }

  private freshnessForGeneration(
    projectId: Id,
    sceneStableId: string,
    generationId: Id,
  ): { fresh: boolean; requireApproval: boolean } {
    const row = this.database.sqlite
      .prepare(
        `SELECT scene_revision_id as sceneRevisionId,source_image_sha256 as sourceImageSha256,
          motion_plan_fingerprint as motionPlanFingerprint,settings_fingerprint as settingsFingerprint
         FROM scene_video_generations WHERE project_id=? AND id=?`,
      )
      .get(projectId, generationId) as
      | {
          sceneRevisionId: Id;
          sourceImageSha256: string | null;
          motionPlanFingerprint: string | null;
          settingsFingerprint: string | null;
        }
      | undefined;
    if (!row) return { fresh: false, requireApproval: true };
    return this.freshnessInputs(projectId, sceneStableId, row.sceneRevisionId, row);
  }

  commitGenerated(input: GeneratedVideoCommitInput, guard: StepLeaseGuard): boolean {
    assertSafePath(input.assetPath);
    return this.database.sqlite.transaction(() => {
      const active = this.database.sqlite
        .prepare(
          `SELECT 1 FROM workflow_steps WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=? AND input_fingerprint=?`,
        )
        .get(guard.stepId, guard.attemptId, guard.workerId, guard.inputFingerprint);
      if (!active) return false;
      const generation = this.database.sqlite
        .prepare(
          `SELECT motion_plan_fingerprint as motionPlanFingerprint,
            settings_fingerprint as settingsFingerprint,input_fingerprint as inputFingerprint,status,metadata
           FROM scene_video_generations
           WHERE id=? AND project_id=? AND scene_stable_id=? AND scene_revision_id=?`,
        )
        .get(input.generationId, input.projectId, input.sceneStableId, input.sceneRevisionId) as
        GenerationCommitRow | undefined;
      if (!generation || generation.status !== 'RUNNING') return false;
      const sourceImage = this.database.sqlite
        .prepare(
          'SELECT source_image_asset_id as assetId,source_image_sha256 as sha256 FROM scene_video_generations WHERE id=?',
        )
        .get(input.generationId) as { assetId: Id | null; sha256: string | null } | undefined;
      const { fresh, requireApproval } = this.freshnessInputs(
        input.projectId,
        input.sceneStableId,
        input.sceneRevisionId,
        {
          sourceImageSha256: sourceImage?.sha256 ?? null,
          motionPlanFingerprint: generation.motionPlanFingerprint,
          settingsFingerprint: generation.settingsFingerprint,
        },
      );
      const existingCurrent = this.database.sqlite
        .prepare(
          'SELECT 1 FROM scene_video_generations WHERE project_id=? AND scene_stable_id=? AND is_current=1',
        )
        .get(input.projectId, input.sceneStableId);
      const autoSelect = fresh && !existingCurrent && !requireApproval;
      const stamp = now();
      const assetId = randomUUID();
      const role = sceneVideoRole(input.sceneStableId);
      this.database.sqlite
        .prepare(
          `INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,
            source_step_id,input_fingerprint,metadata,is_current,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          assetId,
          input.projectId,
          'AI_SCENE_VIDEO',
          role,
          'READY',
          input.assetPath,
          input.mediaType,
          input.bytes,
          input.sha256,
          input.sceneRevisionId,
          guard.stepId,
          generation.inputFingerprint,
          json({
            ...parseRecord(generation.metadata),
            ...(input.metadata ?? {}),
            width: input.width,
            height: input.height,
            seed: input.seed,
            fps: input.fps,
            frameCount: input.frameCount,
            clipDurationMs: input.clipDurationMs,
          }),
          autoSelect ? 1 : 0,
          stamp,
          stamp,
        );
      if (sourceImage?.assetId)
        this.database.sqlite
          .prepare(
            'INSERT OR IGNORE INTO asset_dependencies(asset_id,depends_on_asset_id,role,source_hash) VALUES(?,?,?,?)',
          )
          .run(assetId, sourceImage.assetId, 'AI_MOTION_SOURCE_IMAGE', sourceImage.sha256 ?? '');
      this.database.sqlite
        .prepare(
          `UPDATE scene_video_generations SET status='COMPLETED',actual_seed=?,actual_width=?,actual_height=?,
            asset_id=?,clip_duration_ms=?,generation_duration_ms=?,is_current=?,error_code=NULL,error=NULL,
            metadata=?,completed_at=?,updated_at=?
           WHERE id=? AND project_id=? AND status='RUNNING'`,
        )
        .run(
          input.seed,
          input.width,
          input.height,
          assetId,
          input.clipDurationMs,
          input.generationDurationMs,
          autoSelect ? 1 : 0,
          json({
            ...parseRecord(generation.metadata),
            ...(input.metadata ?? {}),
          }),
          stamp,
          stamp,
          input.generationId,
          input.projectId,
        );
      return true;
    })();
  }

  updateReview(
    projectId: Id,
    generationId: Id,
    value: SceneVideoReviewUpdate,
  ): SceneVideoGenerationDto {
    const input = sceneVideoReviewUpdateSchema.parse(value);
    const result = this.database.sqlite
      .prepare(
        `UPDATE scene_video_generations SET review_status=?,review_notes=?,review_issues=?,updated_at=?
         WHERE project_id=? AND id=?`,
      )
      .run(
        input.status,
        input.notes,
        JSON.stringify(input.issues ?? []),
        now(),
        projectId,
        generationId,
      );
    if (result.changes !== 1)
      throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
    return this.get(projectId, generationId)!;
  }

  setCurrent(projectId: Id, sceneStableId: string, generationId: Id): SceneVideoGenerationDto {
    return this.database.sqlite.transaction(() => {
      const target = this.database.sqlite
        .prepare(
          `SELECT g.scene_revision_id as sceneRevisionId,g.asset_id as assetId,g.status,
            g.review_status as reviewStatus,a.status as assetStatus
           FROM scene_video_generations g LEFT JOIN assets a ON a.id=g.asset_id
           WHERE g.project_id=? AND g.scene_stable_id=? AND g.id=?`,
        )
        .get(projectId, sceneStableId, generationId) as CurrentSelectionRow | undefined;
      if (
        !target ||
        target.status !== 'COMPLETED' ||
        !target.assetId ||
        target.assetStatus !== 'READY'
      )
        throw new AppError('INVALID_INPUT', 'Only a completed valid video can be set current', 409);
      const { fresh, requireApproval } = this.freshnessForGeneration(
        projectId,
        sceneStableId,
        generationId,
      );
      if (!fresh)
        throw new AppError('STALE_INPUT', 'Video generation does not match current inputs', 409);
      if (requireApproval && target.reviewStatus !== 'ACCEPTED')
        throw new AppError('INVALID_INPUT', 'Video generation requires review acceptance', 409);
      const stamp = now();
      const role = sceneVideoRole(sceneStableId);
      this.database.sqlite
        .prepare(
          'UPDATE scene_video_generations SET is_current=0,updated_at=? WHERE project_id=? AND scene_stable_id=?',
        )
        .run(stamp, projectId, sceneStableId);
      this.retireCurrentRoleAsset(projectId, role, stamp);
      this.database.sqlite
        .prepare(
          'UPDATE scene_video_generations SET is_current=1,updated_at=? WHERE project_id=? AND id=?',
        )
        .run(stamp, projectId, generationId);
      this.database.sqlite
        .prepare('UPDATE assets SET is_current=1,updated_at=? WHERE id=? AND project_id=?')
        .run(stamp, target.assetId, projectId);
      return this.get(projectId, generationId)!;
    })();
  }

  // Median wall time of the last completed generations; null until real data exists.
  recentGenerationDurationMs(projectId: Id, sampleSize = 10): number | null {
    const rows = this.database.sqlite
      .prepare(
        `SELECT generation_duration_ms as durationMs FROM scene_video_generations
         WHERE project_id=? AND status='COMPLETED' AND generation_duration_ms IS NOT NULL
         ORDER BY completed_at DESC LIMIT ?`,
      )
      .all(projectId, Math.max(1, sampleSize)) as Array<{ durationMs: number }>;
    if (!rows.length) return null;
    const sorted = rows.map((row) => row.durationMs).sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  private parseGeneration(row: GenerationRow): SceneVideoGenerationDto {
    const { fresh, requireApproval } = this.freshnessForGeneration(
      row.projectId,
      row.sceneStableId,
      row.id,
    );
    const freshness: 'CURRENT' | 'STALE' = fresh ? 'CURRENT' : 'STALE';
    const blockers: string[] = [];
    if (row.status !== 'COMPLETED') blockers.push('GENERATION_NOT_COMPLETED');
    if (freshness === 'STALE') blockers.push('VISUALLY_STALE');
    if (!row.isCurrent) blockers.push('NOT_CURRENT');
    if (requireApproval && row.reviewStatus !== 'ACCEPTED') blockers.push('APPROVAL_REQUIRED');
    const rest: Record<string, unknown> = { ...row };
    delete rest.chapterId;
    delete rest.sceneStableId;
    rest.sceneId = row.sceneStableId;
    return sceneVideoGenerationDtoSchema.parse({
      ...rest,
      isCurrent: Boolean(row.isCurrent),
      freshness,
      reviewIssues: JSON.parse(row.reviewIssues) as string[],
      metadata: parseRecord(row.metadata),
      assetUrl: row.assetId ? `/api/assets/${row.assetId}` : null,
    });
  }
}
