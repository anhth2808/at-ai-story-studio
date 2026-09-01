import { createHash, randomUUID } from 'node:crypto';
import {
  AppError,
  imageGenerationSettingsSchema,
  imageGenerationSettingsUpdateSchema,
  sceneImageGenerationDtoSchema,
  sceneImageReviewUpdateSchema,
  type Id,
  type ImageGenerationSettings,
  type ImageGenerationSettingsDto,
  type ImageGenerationSettingsUpdate,
  type ImageProvider,
  type SceneImageGenerationDto,
  type SceneImageReviewUpdate,
  type SceneImageSource,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';
import type { StepLeaseGuard } from './repositories.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value ?? {});
const safeError = (value: string): string => value.slice(0, 2_000);
const IMAGE_MAPPING_VERSION = 'text-to-image-v1-mapping-1';

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

function settingsFingerprint(settings: ImageGenerationSettings): string {
  return fingerprint({
    version: IMAGE_MAPPING_VERSION,
    input: {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      workflowTemplate: settings.workflowTemplate,
      diffusionModel: settings.diffusionModel,
      textEncoder: settings.textEncoder,
      vaeName: settings.vaeName,
      sampler: settings.sampler,
      width: settings.width,
      height: settings.height,
      steps: settings.steps,
      guidance: settings.guidance,
    },
  });
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new AppError('DATA_CORRUPTION', 'Stored image metadata is invalid', 500);
  return parsed as Record<string, unknown>;
}

function assertSafePath(path: string): void {
  if (!path || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.split(/[\\/]/).includes('..'))
    throw new AppError('UNSAFE_PATH', 'Asset path must be workspace-relative', 400);
}

export class ImageGenerationSettingsRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get(projectId: Id): ImageGenerationSettingsDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,provider,base_url as baseUrl,workflow_template as workflowTemplate,
          diffusion_model as diffusionModel,text_encoder as textEncoder,vae_name as vaeName,sampler,
          connection_timeout_ms as connectionTimeoutMs,generation_timeout_ms as generationTimeoutMs,
          width,height,steps,guidance,seed_mode as seedMode,fixed_seed as fixedSeed,row_version as rowVersion,
          input_fingerprint as inputFingerprint,created_at as createdAt,updated_at as updatedAt
         FROM image_generation_settings WHERE project_id=?`,
      )
      .get(projectId) as ImageSettingsRow | undefined;
    return row ? parseSettings(row) : null;
  }

  getOrCreate(projectId: Id): ImageGenerationSettingsDto {
    const existing = this.get(projectId);
    if (existing) return existing;
    const project = this.database.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = imageGenerationSettingsSchema.parse({});
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT OR IGNORE INTO image_generation_settings(
          id,project_id,provider,base_url,workflow_template,diffusion_model,text_encoder,vae_name,sampler,
          connection_timeout_ms,generation_timeout_ms,width,height,steps,guidance,seed_mode,fixed_seed,
          row_version,input_fingerprint,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        projectId,
        settings.provider,
        settings.baseUrl,
        settings.workflowTemplate,
        settings.diffusionModel,
        settings.textEncoder,
        settings.vaeName,
        settings.sampler,
        settings.connectionTimeoutMs,
        settings.generationTimeoutMs,
        settings.width,
        settings.height,
        settings.steps,
        settings.guidance,
        settings.seedMode,
        settings.fixedSeed,
        1,
        settingsFingerprint(settings),
        stamp,
        stamp,
      );
    return this.get(projectId)!;
  }

  update(projectId: Id, value: ImageGenerationSettingsUpdate): ImageGenerationSettingsDto {
    const input = imageGenerationSettingsUpdateSchema.parse(value);
    const { expectedRowVersion: _expectedRowVersion, ...settingsInput } = input;
    const current = this.get(projectId);
    if (!current) return this.create(projectId, settingsInput);
    if (_expectedRowVersion !== undefined && _expectedRowVersion !== current.rowVersion)
      throw new AppError('CONFLICT', 'Image generation settings changed; reload and retry', 409);
    const settings = imageGenerationSettingsSchema.parse(settingsInput);
    const result = this.database.sqlite
      .prepare(
        `UPDATE image_generation_settings SET provider=?,base_url=?,workflow_template=?,diffusion_model=?,
          text_encoder=?,vae_name=?,sampler=?,connection_timeout_ms=?,generation_timeout_ms=?,width=?,height=?,
          steps=?,guidance=?,seed_mode=?,fixed_seed=?,row_version=row_version+1,input_fingerprint=?,updated_at=?
         WHERE project_id=? AND row_version=?`,
      )
      .run(
        settings.provider,
        settings.baseUrl,
        settings.workflowTemplate,
        settings.diffusionModel,
        settings.textEncoder,
        settings.vaeName,
        settings.sampler,
        settings.connectionTimeoutMs,
        settings.generationTimeoutMs,
        settings.width,
        settings.height,
        settings.steps,
        settings.guidance,
        settings.seedMode,
        settings.fixedSeed,
        settingsFingerprint(settings),
        now(),
        projectId,
        current.rowVersion,
      );
    if (result.changes !== 1)
      throw new AppError('CONFLICT', 'Image generation settings changed; reload and retry', 409);
    return this.get(projectId)!;
  }

  private create(projectId: Id, value: ImageGenerationSettingsUpdate): ImageGenerationSettingsDto {
    const project = this.database.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = imageGenerationSettingsSchema.parse(value);
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO image_generation_settings(
          id,project_id,provider,base_url,workflow_template,diffusion_model,text_encoder,vae_name,sampler,
          connection_timeout_ms,generation_timeout_ms,width,height,steps,guidance,seed_mode,fixed_seed,
          row_version,input_fingerprint,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        projectId,
        settings.provider,
        settings.baseUrl,
        settings.workflowTemplate,
        settings.diffusionModel,
        settings.textEncoder,
        settings.vaeName,
        settings.sampler,
        settings.connectionTimeoutMs,
        settings.generationTimeoutMs,
        settings.width,
        settings.height,
        settings.steps,
        settings.guidance,
        settings.seedMode,
        settings.fixedSeed,
        1,
        settingsFingerprint(settings),
        stamp,
        stamp,
      );
    return this.get(projectId)!;
  }
}

type ImageSettingsRow = {
  id: Id;
  projectId: Id;
  provider: string;
  baseUrl: string;
  workflowTemplate: string;
  diffusionModel: string;
  textEncoder: string;
  vaeName: string;
  sampler: string;
  connectionTimeoutMs: number;
  generationTimeoutMs: number;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seedMode: string;
  fixedSeed: number | null;
  rowVersion: number;
  inputFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

function parseSettings(row: ImageSettingsRow): ImageGenerationSettingsDto {
  const settings = imageGenerationSettingsSchema.parse({
    provider: row.provider,
    baseUrl: row.baseUrl,
    workflowTemplate: row.workflowTemplate,
    diffusionModel: row.diffusionModel,
    textEncoder: row.textEncoder,
    vaeName: row.vaeName,
    sampler: row.sampler,
    connectionTimeoutMs: row.connectionTimeoutMs,
    generationTimeoutMs: row.generationTimeoutMs,
    width: row.width,
    height: row.height,
    steps: row.steps,
    guidance: row.guidance,
    seedMode: row.seedMode,
    fixedSeed: row.fixedSeed,
  });
  return {
    ...settings,
    id: row.id,
    projectId: row.projectId,
    rowVersion: row.rowVersion,
    inputFingerprint: row.inputFingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CreateSceneImageGenerationInput = {
  projectId: Id;
  sceneStableId: string;
  sceneRevisionId: Id;
  visualPromptPackageId: Id | null;
  revision?: number;
  source: SceneImageSource;
  provider: ImageProvider | null;
  status?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  requestedSeed: number | null;
  requestedWidth: number | null;
  requestedHeight: number | null;
  providerJobId: Id | null;
  workflowTemplate: 'text-to-image-v1' | null;
  modelSettings: Record<string, unknown>;
  packageFingerprint: string | null;
  settingsFingerprint: string | null;
  inputFingerprint: string;
  generationInstructions: string | null;
  metadata?: Record<string, unknown>;
};

export type GeneratedImageCommitInput = {
  generationId: Id;
  projectId: Id;
  sceneStableId: string;
  sceneRevisionId: Id;
  assetPath: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  seed: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
};

export type ManualImageCommitInput = Omit<GeneratedImageCommitInput, 'generationId' | 'seed' | 'durationMs'> & {
  generationId?: Id;
  notes?: string;
};

export class SceneImageGenerationRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get(projectId: Id, generationId: Id): SceneImageGenerationDto | null {
    const row = this.database.sqlite
      .prepare(`${generationSelect} WHERE g.project_id=? AND g.id=?`)
      .get(projectId, generationId) as GenerationRow | undefined;
    return row ? parseGeneration(this.database, row) : null;
  }

  getCurrent(projectId: Id, sceneStableId: string): SceneImageGenerationDto | null {
    const row = this.database.sqlite
      .prepare(`${generationSelect} WHERE g.project_id=? AND g.scene_stable_id=? AND g.is_current=1`)
      .get(projectId, sceneStableId) as GenerationRow | undefined;
    return row ? parseGeneration(this.database, row) : null;
  }

  getByProviderJobId(projectId: Id, providerJobId: Id): SceneImageGenerationDto | null {
    const row = this.database.sqlite
      .prepare(`${generationSelect} WHERE g.project_id=? AND g.provider_job_id=?`)
      .get(projectId, providerJobId) as GenerationRow | undefined;
    return row ? parseGeneration(this.database, row) : null;
  }

  list(projectId: Id, sceneStableId: string, limit = 50, offset = 0): SceneImageGenerationDto[] {
    const rows = this.database.sqlite
      .prepare(
        `${generationSelect} WHERE g.project_id=? AND g.scene_stable_id=? ORDER BY g.revision DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, sceneStableId, Math.max(1, Math.min(100, limit)), Math.max(0, offset)) as GenerationRow[];
    return rows.map((row) => parseGeneration(this.database, row));
  }

  create(input: CreateSceneImageGenerationInput): SceneImageGenerationDto {
    const scene = this.scene(input.projectId, input.sceneRevisionId);
    if (!scene || scene.stableId !== input.sceneStableId)
      throw new AppError('NOT_FOUND', 'Scene revision not found', 404);
    if (input.source === 'GENERATED') {
      if (!input.visualPromptPackageId || !input.provider || !input.providerJobId)
        throw new AppError('INVALID_INPUT', 'Generated image fields are incomplete', 400);
      const packageRow = this.database.sqlite
        .prepare(
          `SELECT id FROM visual_prompt_packages WHERE id=? AND project_id=? AND scene_revision_id=? AND status='CURRENT' AND is_current=1`,
        )
        .get(input.visualPromptPackageId, input.projectId, input.sceneRevisionId);
      if (!packageRow) throw new AppError('STALE_INPUT', 'Visual prompt package is not current', 409);
    }
    if (input.source === 'MANUAL' && (input.provider !== null || input.providerJobId !== null))
      throw new AppError('INVALID_INPUT', 'Manual images cannot have a provider job', 400);
    const latest = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM scene_image_generations WHERE project_id=? AND scene_stable_id=?',
      )
      .get(input.projectId, input.sceneStableId) as { revision: number };
    const revision = input.revision ?? latest.revision + 1;
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO scene_image_generations(
          id,project_id,scene_stable_id,scene_revision_id,visual_prompt_package_id,revision,source,provider,status,
          review_status,is_current,requested_seed,requested_width,requested_height,provider_job_id,workflow_template,
          model_settings,package_fingerprint,settings_fingerprint,input_fingerprint,attempt,notes,generation_instructions,
          metadata,created_at,started_at,completed_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectId,
        input.sceneStableId,
        input.sceneRevisionId,
        input.visualPromptPackageId,
        revision,
        input.source,
        input.provider,
        input.status ?? 'PENDING',
        'UNREVIEWED',
        0,
        input.requestedSeed,
        input.requestedWidth,
        input.requestedHeight,
        input.providerJobId,
        input.workflowTemplate,
        json(input.modelSettings),
        input.packageFingerprint,
        input.settingsFingerprint,
        input.inputFingerprint,
        0,
        '',
        input.generationInstructions,
        json(input.metadata ?? {}),
        stamp,
        null,
        null,
        stamp,
      );
    return this.get(input.projectId, id)!;
  }

  linkWorkflowStep(projectId: Id, generationId: Id, workflowStepId: Id): void {
    const result = this.database.sqlite
      .prepare('UPDATE scene_image_generations SET workflow_step_id=?,updated_at=? WHERE project_id=? AND id=?')
      .run(workflowStepId, now(), projectId, generationId);
    if (result.changes !== 1) throw new AppError('NOT_FOUND', 'Scene image generation not found', 404);
  }

  markRunning(projectId: Id, generationId: Id, attempt: number): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_image_generations SET status='RUNNING',attempt=?,started_at=COALESCE(started_at,?),
          error_code=NULL,error=NULL,updated_at=? WHERE project_id=? AND id=? AND status IN ('PENDING','RUNNING')`,
      )
      .run(attempt, now(), now(), projectId, generationId);
  }

  markFailed(projectId: Id, generationId: Id, code: string, message: string): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_image_generations SET status='FAILED',error_code=?,error=?,updated_at=?
         WHERE project_id=? AND id=? AND status IN ('PENDING','RUNNING')`,
      )
      .run(code, safeError(message), now(), projectId, generationId);
  }

  markRetryPending(projectId: Id, generationId: Id, code: string, message: string): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_image_generations SET status='PENDING',error_code=?,error=?,updated_at=?
         WHERE project_id=? AND id=? AND status='RUNNING'`,
      )
      .run(code, safeError(message), now(), projectId, generationId);
  }

  markCancelled(projectId: Id, generationId: Id, message = 'Image generation cancelled'): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_image_generations SET status='CANCELLED',error_code='CANCELLED',error=?,updated_at=?
         WHERE project_id=? AND id=? AND status IN ('PENDING','RUNNING')`,
      )
      .run(safeError(message), now(), projectId, generationId);
  }

  commitGenerated(input: GeneratedImageCommitInput, guard: StepLeaseGuard): boolean {
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
          `SELECT visual_prompt_package_id as packageId,package_fingerprint as packageFingerprint,
            settings_fingerprint as settingsFingerprint,status FROM scene_image_generations
           WHERE id=? AND project_id=? AND scene_stable_id=? AND scene_revision_id=?`,
        )
        .get(input.generationId, input.projectId, input.sceneStableId, input.sceneRevisionId) as GenerationCommitRow | undefined;
      if (!generation || generation.status !== 'RUNNING') return false;
      const currentPackage = this.database.sqlite
        .prepare(
          `SELECT id,input_fingerprint as inputFingerprint FROM visual_prompt_packages
           WHERE project_id=? AND scene_revision_id=? AND status='CURRENT' AND is_current=1`,
        )
        .get(input.projectId, input.sceneRevisionId) as CurrentPackageRow | undefined;
      const currentSettings = this.database.sqlite
        .prepare('SELECT input_fingerprint as inputFingerprint FROM image_generation_settings WHERE project_id=?')
        .get(input.projectId) as CurrentSettingsRow | undefined;
      const fresh = Boolean(
        generation.packageId &&
          generation.packageFingerprint &&
          currentPackage &&
          generation.packageId === currentPackage.id &&
          generation.packageFingerprint === currentPackage.inputFingerprint &&
          generation.settingsFingerprint &&
          currentSettings &&
          generation.settingsFingerprint === currentSettings.inputFingerprint,
      );
      const stamp = now();
      const assetId = randomUUID();
      const role = sceneImageRole(input.sceneStableId);
      if (fresh) {
        this.database.sqlite
          .prepare(
            'UPDATE scene_image_generations SET is_current=0,updated_at=? WHERE project_id=? AND scene_stable_id=?',
          )
          .run(stamp, input.projectId, input.sceneStableId);
        this.database.sqlite
          .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
          .run(stamp, input.projectId, role);
      }
      this.database.sqlite
        .prepare(
          `INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,source_step_id,
            input_fingerprint,metadata,is_current,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          assetId,
          input.projectId,
          'SCENE_IMAGE',
          role,
          'READY',
          input.assetPath,
          input.mediaType,
          input.bytes,
          input.sha256,
          input.sceneRevisionId,
          guard.stepId,
          generation.packageFingerprint,
          json({ ...(input.metadata ?? {}), width: input.width, height: input.height, seed: input.seed }),
          fresh ? 1 : 0,
          stamp,
          stamp,
        );
      this.database.sqlite
        .prepare(
          `UPDATE scene_image_generations SET status='COMPLETED',actual_seed=?,actual_width=?,actual_height=?,
            asset_id=?,duration_ms=?,is_current=?,error_code=NULL,error=NULL,completed_at=?,updated_at=?
           WHERE id=? AND project_id=? AND status='RUNNING'`,
        )
        .run(
          input.seed,
          input.width,
          input.height,
          assetId,
          input.durationMs,
          fresh ? 1 : 0,
          stamp,
          stamp,
          input.generationId,
          input.projectId,
        );
      return true;
    })();
  }

  commitManual(input: ManualImageCommitInput): SceneImageGenerationDto {
    assertSafePath(input.assetPath);
    const scene = this.scene(input.projectId, input.sceneRevisionId);
    if (!scene || scene.stableId !== input.sceneStableId)
      throw new AppError('NOT_FOUND', 'Scene revision not found', 404);
    return this.database.sqlite.transaction(() => {
      const latest = this.database.sqlite
        .prepare(
          'SELECT COALESCE(MAX(revision),0) as revision FROM scene_image_generations WHERE project_id=? AND scene_stable_id=?',
        )
        .get(input.projectId, input.sceneStableId) as { revision: number };
      const id = input.generationId ?? randomUUID();
      const assetId = randomUUID();
      const stamp = now();
      const role = sceneImageRole(input.sceneStableId);
      this.database.sqlite
        .prepare(
          'UPDATE scene_image_generations SET is_current=0,updated_at=? WHERE project_id=? AND scene_stable_id=?',
        )
        .run(stamp, input.projectId, input.sceneStableId);
      this.database.sqlite
        .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
        .run(stamp, input.projectId, role);
      this.database.sqlite
        .prepare(
          `INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,input_fingerprint,
            metadata,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          assetId,
          input.projectId,
          'SCENE_IMAGE',
          role,
          'READY',
          input.assetPath,
          input.mediaType,
          input.bytes,
          input.sha256,
          input.sceneRevisionId,
          fingerprint({ source: 'MANUAL', sha256: input.sha256 }),
          json({ width: input.width, height: input.height }),
          1,
          stamp,
          stamp,
        );
      this.database.sqlite
        .prepare(
          `INSERT INTO scene_image_generations(
            id,project_id,scene_stable_id,scene_revision_id,revision,source,status,review_status,is_current,
            actual_width,actual_height,asset_id,input_fingerprint,attempt,notes,metadata,created_at,completed_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.projectId,
          input.sceneStableId,
          input.sceneRevisionId,
          latest.revision + 1,
          'MANUAL',
          'COMPLETED',
          'UNREVIEWED',
          1,
          input.width,
          input.height,
          assetId,
          fingerprint({ source: 'MANUAL', sha256: input.sha256 }),
          0,
          input.notes ?? '',
          json({}),
          stamp,
          stamp,
          stamp,
        );
      return this.get(input.projectId, id)!;
    })();
  }

  updateReview(projectId: Id, generationId: Id, value: SceneImageReviewUpdate): SceneImageGenerationDto {
    const input = sceneImageReviewUpdateSchema.parse(value);
    const result = this.database.sqlite
      .prepare('UPDATE scene_image_generations SET review_status=?,notes=?,updated_at=? WHERE project_id=? AND id=?')
      .run(input.status, input.notes, now(), projectId, generationId);
    if (result.changes !== 1) throw new AppError('NOT_FOUND', 'Scene image generation not found', 404);
    return this.get(projectId, generationId)!;
  }

  setCurrent(
    projectId: Id,
    sceneStableId: string,
    generationId: Id,
    expectedSceneRevision?: number,
  ): SceneImageGenerationDto {
    return this.database.sqlite.transaction(() => {
      const target = this.database.sqlite
        .prepare(
          `SELECT g.scene_revision_id as sceneRevisionId,g.asset_id as assetId,g.status,a.status as assetStatus
           FROM scene_image_generations g LEFT JOIN assets a ON a.id=g.asset_id
           WHERE g.project_id=? AND g.scene_stable_id=? AND g.id=?`,
        )
        .get(projectId, sceneStableId, generationId) as CurrentSelectionRow | undefined;
      if (!target || target.status !== 'COMPLETED' || !target.assetId || target.assetStatus !== 'READY')
        throw new AppError('INVALID_INPUT', 'Only a completed valid image can be selected', 409);
      if (expectedSceneRevision !== undefined) {
        const scene = this.database.sqlite
          .prepare('SELECT revision FROM scene_revisions WHERE id=? AND project_id=?')
          .get(target.sceneRevisionId, projectId) as { revision: number } | undefined;
        if (!scene || scene.revision !== expectedSceneRevision)
          throw new AppError('CONFLICT', 'Scene revision changed; reload and retry', 409);
      }
      const stamp = now();
      const role = sceneImageRole(sceneStableId);
      this.database.sqlite
        .prepare('UPDATE scene_image_generations SET is_current=0,updated_at=? WHERE project_id=? AND scene_stable_id=?')
        .run(stamp, projectId, sceneStableId);
      this.database.sqlite
        .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
        .run(stamp, projectId, role);
      this.database.sqlite
        .prepare('UPDATE scene_image_generations SET is_current=1,updated_at=? WHERE project_id=? AND id=?')
        .run(stamp, projectId, generationId);
      this.database.sqlite
        .prepare('UPDATE assets SET is_current=1,updated_at=? WHERE id=? AND project_id=?')
        .run(stamp, target.assetId, projectId);
      return this.get(projectId, generationId)!;
    })();
  }

  private scene(projectId: Id, sceneRevisionId: Id): SceneIdentity | undefined {
    return this.database.sqlite
      .prepare('SELECT stable_id as stableId,revision FROM scene_revisions WHERE id=? AND project_id=?')
      .get(sceneRevisionId, projectId) as SceneIdentity | undefined;
  }
}

const generationSelect = `SELECT g.id,g.project_id as projectId,g.scene_stable_id as sceneId,g.scene_revision_id as sceneRevisionId,
  g.visual_prompt_package_id as visualPromptPackageId,g.revision,g.source,g.provider,g.status,g.review_status as reviewStatus,
  g.is_current as isCurrent,g.requested_seed as requestedSeed,g.actual_seed as actualSeed,
  g.requested_width as requestedWidth,g.requested_height as requestedHeight,g.actual_width as actualWidth,
  g.actual_height as actualHeight,g.provider_job_id as providerJobId,g.workflow_template as workflowTemplate,
  g.input_fingerprint as inputFingerprint,g.attempt,g.asset_id as assetId,g.duration_ms as durationMs,
  g.error_code as errorCode,g.error,g.notes,g.generation_instructions as generationInstructions,g.metadata,
  g.created_at as createdAt,g.started_at as startedAt,g.completed_at as completedAt,g.updated_at as updatedAt
  FROM scene_image_generations g`;

type GenerationRow = {
  id: Id;
  projectId: Id;
  sceneId: string;
  sceneRevisionId: Id;
  visualPromptPackageId: Id | null;
  revision: number;
  source: string;
  provider: ImageProvider | null;
  status: string;
  reviewStatus: string;
  isCurrent: number | boolean;
  requestedSeed: number | null;
  actualSeed: number | null;
  requestedWidth: number | null;
  requestedHeight: number | null;
  actualWidth: number | null;
  actualHeight: number | null;
  providerJobId: Id | null;
  workflowTemplate: 'text-to-image-v1' | null;
  inputFingerprint: string;
  attempt: number;
  assetId: Id | null;
  durationMs: number | null;
  errorCode: string | null;
  error: string | null;
  notes: string;
  generationInstructions: string | null;
  metadata: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

function parseGeneration(database: DatabaseHandle, row: GenerationRow): SceneImageGenerationDto {
  let freshness: 'CURRENT' | 'STALE' = 'STALE';
  if (row.source === 'MANUAL') freshness = 'CURRENT';
  else if (row.status === 'COMPLETED') {
    const current = database.sqlite
      .prepare(
        `SELECT p.id,p.input_fingerprint as packageFingerprint,s.input_fingerprint as settingsFingerprint
         FROM visual_prompt_packages p LEFT JOIN image_generation_settings s ON s.project_id=p.project_id
         WHERE p.id=? AND p.status='CURRENT' AND p.is_current=1`,
      )
      .get(row.visualPromptPackageId) as FreshnessRow | undefined;
    const stored = database.sqlite
      .prepare(
        'SELECT package_fingerprint as packageFingerprint,settings_fingerprint as settingsFingerprint FROM scene_image_generations WHERE id=?',
      )
      .get(row.id) as FreshnessRow | undefined;
    if (current && stored && current.id === row.visualPromptPackageId && current.packageFingerprint === stored.packageFingerprint && current.settingsFingerprint === stored.settingsFingerprint)
      freshness = 'CURRENT';
  }
  return sceneImageGenerationDtoSchema.parse({
    ...row,
    isCurrent: Boolean(row.isCurrent),
    freshness,
    metadata: parseRecord(row.metadata),
    assetUrl: row.assetId ? `/api/assets/${row.assetId}` : null,
  });
}

function sceneImageRole(sceneStableId: string): string {
  return `scene:${sceneStableId}:image`;
}
type SceneIdentity = { stableId: string; revision: number };
type GenerationCommitRow = {
  packageId: Id | null;
  packageFingerprint: string | null;
  settingsFingerprint: string | null;
  status: string;
};
type CurrentPackageRow = { id: Id; inputFingerprint: string };
type CurrentSettingsRow = { inputFingerprint: string };
type FreshnessRow = {
  id?: Id;
  packageFingerprint: string | null;
  settingsFingerprint: string | null;
};
type CurrentSelectionRow = {
  sceneRevisionId: Id;
  assetId: Id | null;
  status: string;
  assetStatus: string | null;
};
