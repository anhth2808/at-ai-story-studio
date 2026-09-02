import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { safeWorkspacePath } from '@studio/media';
import {
  ChapterRepository,
  ProjectRepository,
  RenderJobRepository,
  SceneRepository,
  TimelineRepository,
  WorkflowRepository,
  type DatabaseHandle,
} from '@studio/database';
import {
  AppError,
  chapterTimelineSchema,
  motionPlanSchema,
  renderFallbackPolicySchema,
  renderScopeSchema,
  motionPlanUpdateSchema,
  renderConfigSchema,
  renderPlanSchema,
  renderRequestSchema,
  sceneTimingItemSchema,
  type ChapterDto,
  type ChapterTimeline,
  type HierarchicalProgress,
  type HierarchicalProgressLevel,
  type Id,
  type MotionPlan,
  type RenderConfig,
  type RenderPlan,
  type RenderRequest,
  type MotionPlanUpdate,
  type RenderFallbackPolicy,
  type SceneDto,
  type SceneTiming,
  type SceneTimingItem,
  type SceneTimingUpdate,
  type RenderScope,
  type WorkflowStatus,
} from '@studio/shared';
import type { FfmpegTools, WorkspacePaths } from '@studio/media';
import { buildSceneTiming, validateManualSceneTiming } from './scene-timing.js';
import { createDefaultMotionPlan } from './motion-plan.js';

export type TimelineWorkflowContext = {
  database: DatabaseHandle;
  workspace: WorkspacePaths;
  media: FfmpegTools;
};

export type TimelineJobSchedule = { executionId: Id; jobId: Id };

export type TimelineRenderSchedule = {
  executionId: Id;
  jobIds: Id[];
  plan: RenderPlan;
};

type AssetDetails = {
  id: Id;
  path: string;
  type: string;
  sha256: string;
  inputFingerprint: string | null;
  metadata: Record<string, unknown>;
};
type TimelineStepType =
  | 'BUILD_SCENE_TIMING'
  | 'BUILD_MOTION_PLAN'
  | 'RENDER_SCENE_CLIP'
  | 'RENDER_CHAPTER_VIDEO'
  | 'RENDER_PROJECT_VIDEO';
type TimelineStatusRow = {
  type: TimelineStepType;
  entityId: Id;
  status: WorkflowStatus;
  progress: number;
  message: string;
  expectedDurationMs: number | null;
  progressTimeMs: number | null;
};
const timelineStageByType: Record<TimelineStepType, HierarchicalProgressLevel['stage']> = {
  BUILD_SCENE_TIMING: 'TIMING',
  BUILD_MOTION_PLAN: 'MOTION',
  RENDER_SCENE_CLIP: 'SCENE_CLIP',
  RENDER_CHAPTER_VIDEO: 'CHAPTER_VIDEO',
  RENDER_PROJECT_VIDEO: 'PROJECT_VIDEO',
};
const timelineStageOrder: HierarchicalProgressLevel['stage'][] = [
  'TIMING',
  'MOTION',
  'SCENE_CLIP',
  'CHAPTER_VIDEO',
  'PROJECT_VIDEO',
];
function summarizeTimelineStage(
  rows: TimelineStatusRow[],
  stage: HierarchicalProgressLevel['stage'],
  fallbackEntityId: Id,
): HierarchicalProgressLevel {
  const completed = rows.filter((row) => row.status === 'COMPLETED').length;
  const total = rows.length;
  const status: WorkflowStatus = rows.some((row) => row.status === 'FAILED')
    ? 'FAILED'
    : rows.some((row) => row.status === 'RUNNING')
      ? 'RUNNING'
      : rows.some((row) => row.status === 'PENDING')
        ? 'PENDING'
        : rows.some((row) => row.status === 'INVALIDATED')
          ? 'INVALIDATED'
          : rows.every((row) => row.status === 'CANCELLED')
            ? 'CANCELLED'
            : 'COMPLETED';
  return {
    stage,
    status,
    completed,
    total,
    progress:
      rows.reduce(
        (totalProgress, row) => totalProgress + Math.max(0, Math.min(1, row.progress)),
        0,
      ) / Math.max(1, total),
    currentTimeMs:
      rows.reduce((totalTime, row) => totalTime + (row.progressTimeMs ?? 0), 0) || null,
    expectedDurationMs:
      rows.reduce((totalDuration, row) => totalDuration + (row.expectedDurationMs ?? 0), 0) || null,
    activeEntityId: rows.length === 1 ? rows[0]!.entityId : fallbackEntityId,
    error: rows.find((row) => row.status === 'FAILED')?.message ?? null,
  };
}

type SceneTimingPayload = {
  projectId: Id;
  chapterId: Id;
  update?: SceneTimingUpdate;
};

const renderAssetPathSchema = z.string().trim().min(1).max(1_000);
export const renderSceneClipPayloadSchema = z
  .object({
    kind: z.literal('SCENE_CLIP'),
    projectId: z.string().uuid(),
    chapterId: z.string().uuid(),
    sceneId: z.string().uuid(),
    sceneStableId: z.string().trim().min(1).max(200),
    timingRevision: z.number().int().positive(),
    timing: sceneTimingItemSchema,
    fallbackPolicy: renderFallbackPolicySchema,
    imagePath: renderAssetPathSchema.nullable(),
    imageSha256: z.string().trim().min(1).max(128).nullable(),
    imageWidth: z.number().int().positive().nullable(),
    imageHeight: z.number().int().positive().nullable(),
    motionPlan: motionPlanSchema,
    config: renderConfigSchema,
    outputPath: renderAssetPathSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const RENDER_COMPILER_VERSIONS = {
  scene: 'scene-clip-ffmpeg-v1',
  chapter: 'chapter-video-ffmpeg-v1',
  project: 'project-video-ffmpeg-v1',
} as const;

function renderScopeKey(scope: RenderScope): string {
  switch (scope.kind) {
    case 'FULL_STORY':
      return 'full-story';
    case 'SCENE':
      return `scene-${scope.sceneId}`;
    case 'CHAPTER':
      return `chapter-${scope.chapterId}`;
    case 'CHAPTER_RANGE':
      return `range-${scope.startChapterNumber}-${scope.endChapterNumber}`;
    case 'SELECTED_CHAPTERS':
      return `selected-${[...scope.chapterIds].sort().join('-')}`;
  }
}

export function projectVideoRole(projectId: Id, scope: RenderScope): string {
  return `project:${projectId}:video:${renderScopeKey(scope)}`;
}
function chapterRenderConfiguration(config: RenderConfig): Record<string, unknown> {
  return {
    compilerVersion: RENDER_COMPILER_VERSIONS.chapter,
    width: config.width,
    height: config.height,
    fps: config.fps,
    qualityPreset: config.qualityPreset,
    fitMode: config.fitMode,
    transition: config.transition,
    transitionDurationMs: config.transitionDurationMs,
    subtitleFontSize: config.subtitleFontSize,
    subtitlePosition: config.subtitlePosition,
    subtitleOutlineWidth: config.subtitleOutlineWidth,
    narrationVolume: config.narrationVolume,
  };
}
export type RenderSceneClipPayload = z.infer<typeof renderSceneClipPayloadSchema>;

const renderChapterClipSchema = z
  .object({
    sceneId: z.string().uuid(),
    sceneStableId: z.string().trim().min(1).max(200),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    durationMs: z.number().int().positive(),
  })
  .strict();

export const renderChapterPayloadSchema = z
  .object({
    kind: z.literal('CHAPTER_VIDEO'),
    projectId: z.string().uuid(),
    chapterId: z.string().uuid(),
    timingRevision: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    clips: z.array(renderChapterClipSchema).min(1).max(2_000),
    narrationSha256: z.string().trim().min(1).max(128),
    subtitleSha256: z.string().trim().min(1).max(128),
    narrationPath: renderAssetPathSchema,
    subtitlePath: renderAssetPathSchema,
    config: renderConfigSchema,
    outputPath: renderAssetPathSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RenderChapterPayload = z.infer<typeof renderChapterPayloadSchema>;

const renderProjectChapterSchema = z
  .object({
    chapterId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    durationMs: z.number().int().positive(),
  })
  .strict();

export const renderProjectPayloadSchema = z
  .object({
    kind: z.literal('PROJECT_VIDEO'),
    projectId: z.string().uuid(),
    scope: renderScopeSchema,
    musicSha256: z.string().trim().min(1).max(128).nullable(),
    chapters: z.array(renderProjectChapterSchema).min(1).max(500),
    expectedDurationMs: z.number().int().positive(),
    musicPath: renderAssetPathSchema.nullable(),
    config: renderConfigSchema,
    outputPath: renderAssetPathSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RenderProjectPayload = z.infer<typeof renderProjectPayloadSchema>;

const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function assetUrl(id: Id | null): string | null {
  return id ? `/api/assets/${id}` : null;
}

function durationFromMetadata(asset: AssetDetails): number | null {
  const value = asset.metadata.durationMs;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export class TimelineWorkflowService {
  readonly timeline: TimelineRepository;
  readonly renderJobs: RenderJobRepository;

  constructor(
    private readonly context: TimelineWorkflowContext,
    private readonly projects = new ProjectRepository(context.database),
    private readonly chapters = new ChapterRepository(context.database),
    private readonly scenes = new SceneRepository(context.database),
    private readonly workflow = new WorkflowRepository(context.database),
  ) {
    this.timeline = new TimelineRepository(context.database);
    this.renderJobs = new RenderJobRepository(context.database);
  }

  getChapterTimeline(projectId: Id, chapterId: Id): ChapterTimeline | null {
    const chapter = this.chapter(projectId, chapterId);
    const timing = this.timeline.getCurrentSceneTiming(chapter.id);
    if (!timing) return null;
    const config = this.config(projectId);
    const scenes = this.scenes.listScenes(chapter.id);
    const items = timing.items.map((timingItem, itemIndex) => {
      const scene = scenes.find((candidate) => candidate.id === timingItem.sceneId);
      const blockers: string[] = [];
      if (!scene) {
        blockers.push('SCENE_REVISION_MISSING');
        return {
          sceneId: timingItem.sceneId,
          sceneRevision: timingItem.sceneRevision,
          sceneNumber: itemIndex + 1,
          title: `Scene ${itemIndex + 1}`,
          sourceExcerpt: '',
          startMs: timingItem.startMs,
          endMs: timingItem.endMs,
          durationMs: timingItem.durationMs,
          motionPlan: null,
          transition: config.transition,
          transitionDurationMs: config.transitionDurationMs,
          imageAssetId: null,
          imageAssetUrl: null,
          sceneClipAssetId: null,
          sceneClipAssetUrl: null,
          status: 'PENDING' as const,
          blockers,
        };
      }
      const image = this.currentAsset(projectId, `scene:${scene.stableId}:image`);
      const fallback = image
        ? null
        : this.fallbackAsset(projectId, scene.stableId, config.fallbackPolicy);
      const visualAvailable = Boolean(image || fallback || config.fallbackPolicy === 'BLACK');
      const clip = this.currentAsset(projectId, `scene:${scene.stableId}:video`);
      const motion = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
      const expectedClipFingerprint =
        motion && visualAvailable
          ? this.sceneClipFingerprint(
              scene,
              timingItem,
              motion,
              image ?? fallback,
              config,
              config.fallbackPolicy,
              fallback,
            )
          : null;
      const currentClip =
        expectedClipFingerprint && clip?.inputFingerprint === expectedClipFingerprint ? clip : null;
      if (!visualAvailable) blockers.push('SCENE_IMAGE_REQUIRED');
      if (!motion) blockers.push('MOTION_PLAN_REQUIRED');
      if (!currentClip) blockers.push('SCENE_CLIP_REQUIRED');
      return {
        sceneId: scene.id,
        sceneRevision: scene.revision,
        sceneNumber: scene.sceneNumber,
        title: scene.title,
        sourceExcerpt: scene.sourceExcerpt ?? '',
        startMs: timingItem.startMs,
        endMs: timingItem.endMs,
        durationMs: timingItem.durationMs,
        motionPlan: motion,
        transition: config.transition,
        transitionDurationMs: config.transitionDurationMs,
        imageAssetId: image?.id ?? fallback?.id ?? null,
        imageAssetUrl: assetUrl(image?.id ?? fallback?.id ?? null),
        sceneClipAssetId: currentClip?.id ?? null,
        sceneClipAssetUrl: assetUrl(currentClip?.id ?? null),
        status: blockers.length === 0 ? ('COMPLETED' as const) : ('PENDING' as const),
        blockers,
      };
    });
    const audio = this.currentAsset(projectId, `chapter:${chapter.id}:audio`);
    const subtitle = this.currentAsset(projectId, `chapter:${chapter.id}:subtitle`);
    const video = this.currentAsset(projectId, `chapter:${chapter.id}:video`);
    const sceneFingerprints = scenes.map((scene) => {
      const timingItem = timing.items.find((item) => item.sceneId === scene.id);
      const motion = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
      const image = this.currentAsset(projectId, `scene:${scene.stableId}:image`);
      const fallback = image
        ? null
        : this.fallbackAsset(projectId, scene.stableId, config.fallbackPolicy);
      const visualAvailable = Boolean(image || fallback || config.fallbackPolicy === 'BLACK');
      return timingItem && motion && visualAvailable
        ? this.sceneClipFingerprint(
            scene,
            timingItem,
            motion,
            image ?? fallback,
            config,
            config.fallbackPolicy,
            fallback,
          )
        : null;
    });
    const chapterFingerprint = fingerprint({
      compilerVersion: RENDER_COMPILER_VERSIONS.chapter,
      chapterId: chapter.id,
      timing: timing.inputFingerprint,
      audio: audio?.sha256 ?? null,
      subtitle: subtitle?.sha256 ?? null,
      sceneFingerprints,
      config: chapterRenderConfiguration(config),
    });
    const currentVideo = video?.inputFingerprint === chapterFingerprint ? video : null;
    const blockers = items.flatMap((item) => item.blockers);
    if (!audio) blockers.push('CHAPTER_AUDIO_REQUIRED');
    if (!subtitle) blockers.push('SUBTITLE_REQUIRED');
    if (!currentVideo) blockers.push('CHAPTER_VIDEO_REQUIRED');
    return chapterTimelineSchema.parse({
      id: timing.id,
      projectId,
      chapterId: chapter.id,
      chapterRevision: chapter.revision,
      mode: timing.mode,
      timingRevision: timing.revision,
      audioAssetId: audio?.id ?? null,
      subtitleAssetId: subtitle?.id ?? null,
      durationMs: timing.durationMs,
      items,
      fingerprint: fingerprint({
        compilerVersion: RENDER_COMPILER_VERSIONS.chapter,
        timing: timing.inputFingerprint,
        config,
        imageIds: items.map((item) => item.imageAssetId),
        clipIds: items.map((item) => item.sceneClipAssetId),
      }),
      status: blockers.length === 0 ? 'COMPLETED' : 'PENDING',
      videoAssetId: currentVideo?.id ?? null,
      videoAssetUrl: assetUrl(currentVideo?.id ?? null),
      warnings: timing.warnings,
      blockers: [...new Set(blockers)],
    });
  }

  scheduleSceneTiming(chapterId: Id, update?: SceneTimingUpdate): TimelineJobSchedule {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'SCENE_TIMING');
    const payload: SceneTimingPayload = {
      projectId: chapter.projectId,
      chapterId,
      ...(update ? { update } : {}),
    };
    const stepId = this.workflow.createStep(
      executionId,
      `scene-timing:${chapter.id}:${chapter.revision}`,
      'BUILD_SCENE_TIMING',
      chapter.id,
      fingerprint(payload),
      3,
      payload,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('BUILD_SCENE_TIMING', chapter.id, stepId),
    };
  }

  scheduleMotionPlan(chapterId: Id, replace = false): TimelineJobSchedule {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'MOTION_PLAN');
    const payload = { projectId: chapter.projectId, chapterId, replace };
    const stepId = this.workflow.createStep(
      executionId,
      `motion-plan:${chapter.id}:${chapter.revision}:${replace ? 'replace' : 'preserve'}`,
      'BUILD_MOTION_PLAN',
      chapter.id,
      fingerprint(payload),
      3,
      payload,
    );
    return { executionId, jobId: this.workflow.createJob('BUILD_MOTION_PLAN', chapter.id, stepId) };
  }

  async buildSceneTiming(chapterId: Id, update?: SceneTimingUpdate): Promise<SceneTiming> {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const current = this.timeline.getCurrentSceneTiming(chapter.id);
    const audio = this.currentAsset(chapter.projectId, `chapter:${chapter.id}:audio`);
    if (!audio)
      throw new AppError(
        'TIMELINE_AUDIO_REQUIRED',
        'Current chapter audio is required before timing',
        409,
      );
    if (!update && current?.mode === 'MANUAL') {
      if (current.audioAssetId === audio.id && current.chapterRevision === chapter.revision)
        return current;
      if (current.audioAssetId !== audio.id)
        throw new AppError(
          'TIMELINE_MANUAL_LOCKED',
          'Manual timing is locked to the previous audio asset; explicitly replace it before rebuilding',
          409,
        );
    }
    const audioDurationMs = await this.audioDuration(audio);
    const sourceSegments = this.timeline.listTtsSourceSegments(chapter.id);
    if (
      sourceSegments.length === 0 ||
      sourceSegments.some(
        (segment) =>
          segment.chapterRevision !== chapter.revision ||
          segment.sourceStartOffset === null ||
          segment.sourceEndOffset === null ||
          segment.sourceText === null ||
          segment.sourceText !==
            chapter.content.slice(segment.sourceStartOffset, segment.sourceEndOffset) ||
          segment.durationMs === null ||
          segment.durationMs <= 0 ||
          segment.status !== 'COMPLETED',
      )
    ) {
      throw new AppError(
        'TIMELINE_SOURCE_MAPPINGS_REQUIRED',
        'Completed TTS source mappings and measured durations are required before timing',
        409,
      );
    }
    const scenes = this.scenes.listScenes(chapter.id);
    const sceneInputs = scenes.map((scene) => ({
      sceneId: scene.id,
      sceneRevision: scene.revision,
      sourceRange: scene.sourceRange,
    }));
    let items: SceneTimingItem[];
    let warnings: string[] = [];
    const mode = update?.mode ?? current?.mode ?? 'AUTO';
    if (
      mode === 'MANUAL' &&
      update?.expectedRevision !== undefined &&
      update.expectedRevision !== (this.timeline.getCurrentSceneTiming(chapter.id)?.revision ?? 0)
    )
      throw new AppError('REVISION_CONFLICT', 'Scene timing revision is stale', 409);
    try {
      if (mode === 'MANUAL') {
        items = validateManualSceneTiming(
          sceneInputs,
          update?.items ?? current?.items ?? [],
          audioDurationMs,
        );
      } else {
        const result = buildSceneTiming({
          scenes: sceneInputs,
          segments: sourceSegments.map((segment) => ({
            sourceStartOffset: segment.sourceStartOffset!,
            sourceEndOffset: segment.sourceEndOffset!,
            durationMs: segment.durationMs!,
          })),
          chapterLength: chapter.content.length,
          audioDurationMs,
          minimumSceneDurationMs: 500,
          mode,
        });
        items = result.items;
        warnings = result.warnings;
      }
    } catch (error) {
      throw new AppError(
        'TIMELINE_INVALID',
        error instanceof Error ? error.message : 'Scene timing is invalid',
        409,
      );
    }
    const inputFingerprint = fingerprint({
      chapterId,
      chapterRevision: chapter.revision,
      chapterContent: fingerprint(chapter.content),
      audio: audio.sha256,
      audioDurationMs,
      sourceSegments: sourceSegments.map((segment) => ({
        index: segment.index,
        chapterRevision: segment.chapterRevision,
        sourceStartOffset: segment.sourceStartOffset,
        sourceEndOffset: segment.sourceEndOffset,
        durationMs: segment.durationMs,
      })),
      scenes: sceneInputs,
      mode,
      items,
    });
    if (
      current?.inputFingerprint === inputFingerprint &&
      current.chapterRevision === chapter.revision
    )
      return current;
    return this.timeline.createSceneTiming({
      projectId: chapter.projectId,
      chapterId: chapter.id,
      chapterRevision: chapter.revision,
      audioAssetId: audio.id,
      mode,
      durationMs: audioDurationMs,
      minimumSceneDurationMs: 500,
      items,
      warnings,
      inputFingerprint,
    });
  }
  buildMotionPlans(chapterId: Id, replace = false): MotionPlan[] {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const timing = this.timeline.getCurrentSceneTiming(chapter.id);
    if (!timing)
      throw new AppError(
        'TIMELINE_REQUIRED',
        'Scene timing must be built before Motion Plans',
        409,
      );
    const config = this.config(chapter.projectId);
    return this.scenes.listScenes(chapter.id).map((scene) => {
      const timingItem = timing.items.find((item) => item.sceneId === scene.id);
      if (!timingItem)
        throw new AppError('TIMELINE_INVALID', `Scene ${scene.id} has no timing`, 409);
      const existing = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
      if (!replace && existing && existing.timingRevision === timing.revision) return existing;
      const draft = createDefaultMotionPlan({
        sceneId: scene.stableId,
        sceneRevision: scene.revision,
        sceneNumber: scene.sceneNumber,
        purpose: scene.purpose,
        camera: scene.camera,
        composition: scene.composition,
        durationMs: timingItem.durationMs,
        timingRevision: timing.revision,
        intensity: config.motionIntensity,
      });
      const inputFingerprint = fingerprint({
        scene: scene.inputFingerprint,
        timing: timing.inputFingerprint,
        timingRevision: timing.revision,
        config: { motionIntensity: config.motionIntensity },
      });
      return this.timeline.createMotionPlan(
        {
          projectId: chapter.projectId,
          chapterId: chapter.id,
          sceneStableId: scene.stableId,
          sceneRevisionId: scene.id,
          timingRevisionId: timing.id,
          motionType: draft.motionType,
          startScale: draft.startScale,
          endScale: draft.endScale,
          startPositionX: draft.startPosition.x,
          startPositionY: draft.startPosition.y,
          endPositionX: draft.endPosition.x,
          endPositionY: draft.endPosition.y,
          easing: draft.easing,
          focusPointX: draft.focusPoint?.x ?? null,
          focusPointY: draft.focusPoint?.y ?? null,
          intensity: draft.intensity,
          durationMs: draft.durationMs,
          inputFingerprint,
        },
        scene.revision,
      );
    });
  }
  updateMotionPlan(projectId: Id, sceneId: Id, input: MotionPlanUpdate): MotionPlan {
    const scene = this.scenes.getScene(sceneId);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    const timing = this.timeline.getCurrentSceneTiming(scene.chapterId);
    if (!timing)
      throw new AppError(
        'TIMELINE_REQUIRED',
        'Scene timing must be built before MotionPlan edits',
        409,
      );
    const current = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
    const { expectedRevision, ...style } = motionPlanUpdateSchema.parse(input);
    if (expectedRevision !== undefined && expectedRevision !== (current?.revision ?? 0))
      throw new AppError('REVISION_CONFLICT', 'MotionPlan revision is stale', 409);
    const timingItem = timing.items.find((item) => item.sceneId === scene.id);
    if (!timingItem) throw new AppError('TIMELINE_INVALID', 'Scene has no timing item', 409);
    const inputFingerprint = fingerprint({
      scene: scene.inputFingerprint,
      timing: timing.inputFingerprint,
      timingRevision: timing.revision,
      style,
    });
    return this.timeline.createMotionPlan(
      {
        projectId,
        chapterId: scene.chapterId,
        sceneStableId: scene.stableId,
        sceneRevisionId: scene.id,
        timingRevisionId: timing.id,
        motionType: style.motionType,
        startScale: style.startScale,
        endScale: style.endScale,
        startPositionX: style.startPosition.x,
        startPositionY: style.startPosition.y,
        endPositionX: style.endPosition.x,
        endPositionY: style.endPosition.y,
        easing: style.easing,
        focusPointX: style.focusPoint?.x ?? null,
        focusPointY: style.focusPoint?.y ?? null,
        intensity: style.intensity,
        durationMs: timingItem.durationMs,
        inputFingerprint,
      },
      scene.revision,
    );
  }

  getRenderPlan(projectId: Id, request: RenderRequest): RenderPlan {
    const project = this.projects.get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const parsedRequest = renderRequestSchema.parse(request);
    const config = this.config(projectId, parsedRequest);
    if (parsedRequest.scope.kind === 'SCENE')
      return this.getSingleSceneRenderPlan(projectId, parsedRequest, config);
    const selectedChapters = this.resolveChapters(projectId, parsedRequest.scope);
    const blockers: Array<{
      code: string;
      message: string;
      entityId: Id | null;
      retryable: boolean;
    }> = [];
    if (parsedRequest.source === 'BACKGROUND') {
      return renderPlanSchema.parse({
        projectId,
        scope: parsedRequest.scope,
        source: parsedRequest.source,
        autoBuild: parsedRequest.autoBuild,
        fallbackPolicy: parsedRequest.fallbackPolicy,
        scenes: { total: 0, reusable: 0, required: 0, blocked: 0 },
        chapters: {
          total: selectedChapters.length,
          reusable: 0,
          required: selectedChapters.length,
          blocked: 0,
        },
        project: { required: true, reusable: false, fingerprint: null },
        expectedDurationMs: null,
        blockers,
        generatedAt: new Date().toISOString(),
      });
    }
    let sceneTotal = 0;
    let sceneReusable = 0;
    let sceneBlocked = 0;
    let chapterReusable = 0;
    let chapterBlocked = 0;
    let expectedDurationMs = 0;
    const chapterFingerprints: string[] = [];
    for (const chapter of selectedChapters) {
      const timing = this.timeline.getCurrentSceneTiming(chapter.id);
      const audio = this.currentAsset(projectId, `chapter:${chapter.id}:audio`);
      const subtitle = this.currentAsset(projectId, `chapter:${chapter.id}:subtitle`);
      if (!timing)
        blockers.push({
          code: 'TIMING_REQUIRED',
          message: `Chapter ${chapter.number} requires Scene Timing`,
          entityId: chapter.id,
          retryable: true,
        });
      if (!audio)
        blockers.push({
          code: 'AUDIO_REQUIRED',
          message: `Chapter ${chapter.number} requires narration`,
          entityId: chapter.id,
          retryable: true,
        });
      if (!subtitle)
        blockers.push({
          code: 'SUBTITLE_REQUIRED',
          message: `Chapter ${chapter.number} requires subtitles`,
          entityId: chapter.id,
          retryable: true,
        });
      const scenes = this.scenes.listScenes(chapter.id);
      const sceneFingerprints: string[] = [];
      let chapterSceneBlocked = 0;
      for (const scene of scenes) {
        sceneTotal += 1;
        const timingItem = timing?.items.find((item) => item.sceneId === scene.id);
        const motion = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
        const image = this.currentAsset(projectId, `scene:${scene.stableId}:image`);
        const fallback = image
          ? null
          : this.fallbackAsset(projectId, scene.stableId, parsedRequest.fallbackPolicy);
        const visualAvailable = Boolean(
          image || fallback || parsedRequest.fallbackPolicy === 'BLACK',
        );
        if (!timingItem || !motion || !visualAvailable) {
          sceneBlocked += 1;
          chapterSceneBlocked += 1;
          if (!timingItem)
            blockers.push({
              code: 'SCENE_TIMING_REQUIRED',
              message: `Scene ${scene.sceneNumber} requires timing`,
              entityId: scene.id,
              retryable: true,
            });
          if (!visualAvailable)
            blockers.push({
              code: 'SCENE_IMAGE_REQUIRED',
              message: `Scene ${scene.sceneNumber} has no accepted image or usable ${parsedRequest.fallbackPolicy} fallback`,
              entityId: scene.id,
              retryable: true,
            });
          if (!motion)
            blockers.push({
              code: 'MOTION_PLAN_REQUIRED',
              message: `Scene ${scene.sceneNumber} requires a Motion Plan`,
              entityId: scene.id,
              retryable: true,
            });
          continue;
        }
        const sceneFingerprint = this.sceneClipFingerprint(
          scene,
          timingItem,
          motion,
          image ?? fallback,
          config,
          parsedRequest.fallbackPolicy,
          fallback,
        );
        const clip = this.currentAsset(projectId, `scene:${scene.stableId}:video`);
        if (clip?.inputFingerprint === sceneFingerprint) sceneReusable += 1;
        sceneFingerprints.push(sceneFingerprint);
      }
      if (timing) expectedDurationMs += timing.durationMs;
      const chapterFingerprint = fingerprint({
        compilerVersion: RENDER_COMPILER_VERSIONS.chapter,
        chapterId: chapter.id,
        timing: timing?.inputFingerprint ?? null,
        audio: audio?.sha256 ?? null,
        subtitle: subtitle?.sha256 ?? null,
        sceneFingerprints,
        config: chapterRenderConfiguration(config),
      });
      chapterFingerprints.push(chapterFingerprint);
      const chapterVideo = this.currentAsset(projectId, `chapter:${chapter.id}:video`);
      if (chapterVideo?.inputFingerprint === chapterFingerprint) chapterReusable += 1;
      else if (!timing || !audio || !subtitle || chapterSceneBlocked > 0) chapterBlocked += 1;
    }
    const music = config.musicEnabled ? this.currentAsset(projectId, 'project:music') : null;
    const projectFingerprint = fingerprint({
      compilerVersion: RENDER_COMPILER_VERSIONS.project,
      projectId,
      scope: parsedRequest.scope,
      chapterFingerprints,
      config: {
        width: config.width,
        height: config.height,
        fps: config.fps,
        qualityPreset: config.qualityPreset,
        musicEnabled: config.musicEnabled && Boolean(music),
        loopMusic: config.loopMusic,
        musicVolume: config.musicVolume,
      },
      music: config.musicEnabled ? (music?.sha256 ?? null) : null,
    });
    const projectVideo = this.currentAsset(
      projectId,
      projectVideoRole(projectId, parsedRequest.scope),
    );
    return renderPlanSchema.parse({
      projectId,
      scope: parsedRequest.scope,
      source: parsedRequest.source,
      autoBuild: parsedRequest.autoBuild,
      fallbackPolicy: parsedRequest.fallbackPolicy,
      scenes: {
        total: sceneTotal,
        reusable: sceneReusable,
        required: sceneTotal - sceneReusable,
        blocked: sceneBlocked,
      },
      chapters: {
        total: selectedChapters.length,
        reusable: chapterReusable,
        required: selectedChapters.length - chapterReusable,
        blocked: chapterBlocked,
      },
      project: {
        required: selectedChapters.length > 0,
        reusable: projectVideo?.inputFingerprint === projectFingerprint,
        fingerprint: projectFingerprint,
      },
      expectedDurationMs: expectedDurationMs || null,
      blockers: [
        ...new Map(
          blockers.map((blocker) => [`${blocker.code}:${blocker.entityId}`, blocker]),
        ).values(),
      ].slice(0, 1_000),
      generatedAt: new Date().toISOString(),
    });
  }
  async scheduleRender(projectId: Id, request: RenderRequest): Promise<TimelineRenderSchedule> {
    const project = this.projects.get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const parsedRequest = renderRequestSchema.parse(request);
    if (parsedRequest.source !== 'SCENES')
      throw new AppError(
        'RENDER_SOURCE_UNSUPPORTED',
        'Scene timeline rendering requires SCENES',
        400,
      );
    let plan = this.getRenderPlan(projectId, parsedRequest);
    if (plan.blockers.length > 0 && parsedRequest.autoBuild) {
      const unsupported = plan.blockers.filter(
        (blocker) =>
          !['TIMING_REQUIRED', 'SCENE_TIMING_REQUIRED', 'MOTION_PLAN_REQUIRED'].includes(
            blocker.code,
          ),
      );
      if (unsupported.length > 0)
        throw new AppError('RENDER_BLOCKED', JSON.stringify(unsupported), 409);
      for (const chapter of this.resolveChapters(projectId, parsedRequest.scope)) {
        if (!this.timeline.getCurrentSceneTiming(chapter.id))
          await this.buildSceneTiming(chapter.id);
        const timing = this.timeline.getCurrentSceneTiming(chapter.id);
        if (
          timing &&
          this.scenes
            .listScenes(chapter.id)
            .some((scene) => !this.timeline.getCurrentMotionPlan(scene.stableId, scene.id))
        )
          this.buildMotionPlans(chapter.id);
      }
      plan = this.getRenderPlan(projectId, parsedRequest);
    }
    if (plan.blockers.length > 0)
      throw new AppError('RENDER_BLOCKED', JSON.stringify(plan.blockers), 409);
    if (parsedRequest.scope.kind === 'SCENE') {
      this.assertNoActiveRenderJobs(projectId, parsedRequest.scope);
      return this.scheduleSingleSceneRender(projectId, parsedRequest, plan);
    }
    const config = this.config(projectId, parsedRequest);
    const selectedChapters = this.resolveChapters(projectId, parsedRequest.scope);
    if (selectedChapters.length === 0)
      throw new AppError('RENDER_SCOPE_EMPTY', 'Render scope does not contain chapters', 409);
    this.assertNoActiveRenderJobs(projectId, parsedRequest.scope);

    return this.context.database.sqlite.transaction(() => {
      const executionId = this.workflow.createExecution(projectId, 'TIMELINE_RENDER');
      const jobIds: Id[] = [];
      const chapterStepIds: Id[] = [];
      const chapterFingerprints: Array<{ chapterId: Id; fingerprint: string; durationMs: number }> =
        [];

      for (const chapter of selectedChapters) {
        const timing = this.timeline.getCurrentSceneTiming(chapter.id);
        const audio = this.currentAsset(projectId, `chapter:${chapter.id}:audio`);
        const subtitle = this.currentAsset(projectId, `chapter:${chapter.id}:subtitle`);
        if (!timing || !audio || !subtitle)
          throw new AppError(
            'RENDER_BLOCKED',
            `Chapter ${chapter.number} is missing timeline inputs`,
            409,
          );
        const sceneStepIds: Id[] = [];
        const sceneFingerprints: string[] = [];
        for (const scene of this.scenes.listScenes(chapter.id)) {
          const timingItem = timing.items.find((item) => item.sceneId === scene.id);
          const motion = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
          const image = this.currentAsset(projectId, `scene:${scene.stableId}:image`);
          const fallback = image
            ? null
            : this.fallbackAsset(projectId, scene.stableId, parsedRequest.fallbackPolicy);
          const visualAvailable = Boolean(
            image || fallback || parsedRequest.fallbackPolicy === 'BLACK',
          );
          if (!timingItem || !motion || !visualAvailable)
            throw new AppError(
              'RENDER_BLOCKED',
              `Scene ${scene.sceneNumber} is missing timeline inputs`,
              409,
            );
          const effectiveImage = image ?? fallback;
          const imageWidth =
            typeof effectiveImage?.metadata.width === 'number'
              ? effectiveImage.metadata.width
              : null;
          const imageHeight =
            typeof effectiveImage?.metadata.height === 'number'
              ? effectiveImage.metadata.height
              : null;
          if (effectiveImage && (imageWidth === null || imageHeight === null))
            throw new AppError(
              'RENDER_INPUT_INVALID',
              `Scene ${scene.sceneNumber} image dimensions are missing`,
              409,
            );
          const sceneFingerprint = this.sceneClipFingerprint(
            scene,
            timingItem,
            motion,
            effectiveImage,
            config,
            parsedRequest.fallbackPolicy,
            fallback,
          );
          sceneFingerprints.push(sceneFingerprint);
          const currentClip = this.currentAsset(projectId, `scene:${scene.stableId}:video`);
          if (currentClip?.inputFingerprint === sceneFingerprint) continue;
          const payload: RenderSceneClipPayload = {
            kind: 'SCENE_CLIP',
            projectId,
            chapterId: chapter.id,
            sceneId: scene.id,
            sceneStableId: scene.stableId,
            timingRevision: timing.revision,
            timing: timingItem,
            fallbackPolicy: parsedRequest.fallbackPolicy,
            imagePath: effectiveImage?.path ?? null,
            imageSha256: effectiveImage?.sha256 ?? null,
            imageWidth: imageWidth ?? null,
            imageHeight: imageHeight ?? null,
            motionPlan: motion,
            config,
            outputPath: `projects/${projectId}/video/scenes/${scene.id}-${randomUUID()}.mp4`,
            fingerprint: sceneFingerprint,
          };
          const stepId = this.workflow.createStep(
            executionId,
            `scene-clip:${scene.id}:${sceneFingerprint.slice(0, 16)}`,
            'RENDER_SCENE_CLIP',
            scene.id,
            sceneFingerprint,
            3,
            payload,
          );
          const sceneJobId = this.workflow.createJob('RENDER_SCENE_CLIP', scene.id, stepId);
          this.renderJobs.create({
            projectId,
            stepId,
            renderType: 'SCENE_CLIP',
            scopeId: `scene:${scene.stableId}`,
            expectedDurationMs: timingItem.durationMs,
          });
          sceneStepIds.push(stepId);
          jobIds.push(sceneJobId);
        }
        const chapterFingerprint = fingerprint({
          compilerVersion: RENDER_COMPILER_VERSIONS.chapter,
          chapterId: chapter.id,
          timing: timing.inputFingerprint,
          audio: audio.sha256,
          subtitle: subtitle.sha256,
          sceneFingerprints,
          config: chapterRenderConfiguration(config),
        });
        const chapterVideo = this.currentAsset(projectId, `chapter:${chapter.id}:video`);
        chapterFingerprints.push({
          chapterId: chapter.id,
          fingerprint: chapterFingerprint,
          durationMs: timing.durationMs,
        });
        if (chapterVideo?.inputFingerprint === chapterFingerprint) continue;
        const chapterPayload: RenderChapterPayload = {
          kind: 'CHAPTER_VIDEO',
          projectId,
          chapterId: chapter.id,
          timingRevision: timing.revision,
          durationMs: timing.durationMs,
          clips: this.scenes.listScenes(chapter.id).map((scene, index) => ({
            sceneId: scene.id,
            sceneStableId: scene.stableId,
            fingerprint: sceneFingerprints[index]!,
            durationMs: timing.items.find((item) => item.sceneId === scene.id)?.durationMs ?? 1,
          })),
          narrationSha256: audio.sha256,
          subtitleSha256: subtitle.sha256,
          narrationPath: audio.path,
          subtitlePath: subtitle.path,
          config,
          outputPath: `projects/${projectId}/video/chapters/${chapter.id}-${randomUUID()}.mp4`,
          fingerprint: chapterFingerprint,
        };
        const chapterStepId = this.workflow.createStep(
          executionId,
          `chapter-video:${chapter.id}:${chapterFingerprint.slice(0, 16)}`,
          'RENDER_CHAPTER_VIDEO',
          chapter.id,
          chapterFingerprint,
          3,
          chapterPayload,
        );
        for (const sceneStepId of sceneStepIds)
          this.workflow.dependency(chapterStepId, sceneStepId);
        const chapterJobId = this.workflow.createJob(
          'RENDER_CHAPTER_VIDEO',
          chapter.id,
          chapterStepId,
        );
        this.renderJobs.create({
          projectId,
          stepId: chapterStepId,
          renderType: 'CHAPTER_VIDEO',
          scopeId: `chapter:${chapter.id}`,
          expectedDurationMs: timing.durationMs,
        });
        chapterStepIds.push(chapterStepId);
        jobIds.push(chapterJobId);
      }

      const projectFingerprint = plan.project.fingerprint;
      if (!projectFingerprint)
        throw new AppError('RENDER_PLAN_INVALID', 'Project render fingerprint is missing', 500);
      const projectVideo = this.currentAsset(
        projectId,
        projectVideoRole(projectId, parsedRequest.scope),
      );
      if (!projectVideo || projectVideo.inputFingerprint !== projectFingerprint) {
        const music = config.musicEnabled ? this.currentAsset(projectId, 'project:music') : null;
        const projectConfig = renderConfigSchema.parse({
          ...config,
          musicEnabled: config.musicEnabled && Boolean(music),
        });
        const projectPayload: RenderProjectPayload = {
          kind: 'PROJECT_VIDEO',
          projectId,
          scope: parsedRequest.scope,
          chapters: chapterFingerprints,
          expectedDurationMs: plan.expectedDurationMs!,
          musicSha256: music?.sha256 ?? null,
          musicPath: music?.path ?? null,
          config: projectConfig,
          outputPath: `projects/${projectId}/video/projects/${projectId}-${randomUUID()}.mp4`,
          fingerprint: projectFingerprint,
        };
        const projectStepId = this.workflow.createStep(
          executionId,
          `project-video:${projectFingerprint.slice(0, 16)}`,
          'RENDER_PROJECT_VIDEO',
          projectId,
          projectFingerprint,
          3,
          projectPayload,
        );
        for (const chapterStepId of chapterStepIds)
          this.workflow.dependency(projectStepId, chapterStepId);
        const projectJobId = this.workflow.createJob(
          'RENDER_PROJECT_VIDEO',
          projectId,
          projectStepId,
        );
        this.renderJobs.create({
          projectId,
          stepId: projectStepId,
          renderType: 'PROJECT_VIDEO',
          scopeId: projectVideoRole(projectId, parsedRequest.scope),
          expectedDurationMs: plan.expectedDurationMs,
        });
        jobIds.push(projectJobId);
      }
      return { executionId, jobIds, plan };
    })();
  }
  private getSingleSceneRenderPlan(
    projectId: Id,
    request: RenderRequest,
    config: RenderConfig,
  ): RenderPlan {
    if (request.scope.kind !== 'SCENE')
      throw new AppError('RENDER_SCOPE_INVALID', 'Scene render scope is required', 400);
    const scene = this.scenes.getScene(request.scope.sceneId);
    const blockers: Array<{
      code: string;
      message: string;
      entityId: Id | null;
      retryable: boolean;
    }> = [];
    if (!scene || scene.projectId !== projectId) {
      blockers.push({
        code: 'SCENE_NOT_FOUND',
        message: 'The requested Scene is not available in this Project',
        entityId: request.scope.sceneId,
        retryable: false,
      });
      return renderPlanSchema.parse({
        projectId,
        scope: request.scope,
        source: request.source,
        autoBuild: request.autoBuild,
        fallbackPolicy: request.fallbackPolicy,
        scenes: { total: 1, reusable: 0, required: 0, blocked: 1 },
        chapters: { total: 0, reusable: 0, required: 0, blocked: 0 },
        project: { required: false, reusable: false, fingerprint: null },
        expectedDurationMs: null,
        blockers,
        generatedAt: new Date().toISOString(),
      });
    }
    const timing = this.timeline.getCurrentSceneTiming(scene.chapterId);
    const timingItem = timing?.items.find((item) => item.sceneId === scene.id);
    const motion = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
    const image = this.currentAsset(projectId, `scene:${scene.stableId}:image`);
    const fallback = image
      ? null
      : this.fallbackAsset(projectId, scene.stableId, request.fallbackPolicy);
    const visualAvailable = Boolean(image || fallback || request.fallbackPolicy === 'BLACK');
    if (!timingItem)
      blockers.push({
        code: 'SCENE_TIMING_REQUIRED',
        message: `Scene ${scene.sceneNumber} requires timing`,
        entityId: scene.id,
        retryable: true,
      });
    if (!motion)
      blockers.push({
        code: 'MOTION_PLAN_REQUIRED',
        message: `Scene ${scene.sceneNumber} requires a Motion Plan`,
        entityId: scene.id,
        retryable: true,
      });
    if (!visualAvailable)
      blockers.push({
        code: 'SCENE_IMAGE_REQUIRED',
        message: `Scene ${scene.sceneNumber} has no accepted image or usable ${request.fallbackPolicy} fallback`,
        entityId: scene.id,
        retryable: true,
      });
    const effectiveImage = image ?? fallback;
    const sceneFingerprint =
      timingItem && motion && visualAvailable
        ? this.sceneClipFingerprint(
            scene,
            timingItem,
            motion,
            effectiveImage,
            config,
            request.fallbackPolicy,
            fallback,
          )
        : null;
    const currentClip = this.currentAsset(projectId, `scene:${scene.stableId}:video`);
    const reusable = Boolean(
      sceneFingerprint && currentClip?.inputFingerprint === sceneFingerprint,
    );
    return renderPlanSchema.parse({
      projectId,
      scope: request.scope,
      source: request.source,
      autoBuild: request.autoBuild,
      fallbackPolicy: request.fallbackPolicy,
      scenes: {
        total: 1,
        reusable: reusable ? 1 : 0,
        required: reusable ? 0 : blockers.length ? 0 : 1,
        blocked: blockers.length ? 1 : 0,
      },
      chapters: { total: 0, reusable: 0, required: 0, blocked: 0 },
      project: { required: false, reusable: false, fingerprint: null },
      expectedDurationMs: timingItem?.durationMs ?? null,
      blockers,
      generatedAt: new Date().toISOString(),
    });
  }
  private scheduleSingleSceneRender(
    projectId: Id,
    request: RenderRequest,
    plan: RenderPlan,
  ): TimelineRenderSchedule {
    if (request.scope.kind !== 'SCENE')
      throw new AppError('RENDER_SCOPE_INVALID', 'Scene render scope is required', 400);
    const scene = this.scenes.getScene(request.scope.sceneId);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    const timing = this.timeline.getCurrentSceneTiming(scene.chapterId);
    const timingItem = timing?.items.find((item) => item.sceneId === scene.id);
    const motion = this.timeline.getCurrentMotionPlan(scene.stableId, scene.id);
    const image = this.currentAsset(projectId, `scene:${scene.stableId}:image`);
    const fallback = image
      ? null
      : this.fallbackAsset(projectId, scene.stableId, request.fallbackPolicy);
    if (
      !timing ||
      !timingItem ||
      !motion ||
      (!image && !fallback && request.fallbackPolicy !== 'BLACK')
    )
      throw new AppError('RENDER_BLOCKED', JSON.stringify(plan.blockers), 409);
    const effectiveImage = image ?? fallback;
    const imageWidth =
      typeof effectiveImage?.metadata.width === 'number' ? effectiveImage.metadata.width : null;
    const imageHeight =
      typeof effectiveImage?.metadata.height === 'number' ? effectiveImage.metadata.height : null;
    if (effectiveImage && (imageWidth === null || imageHeight === null))
      throw new AppError(
        'RENDER_INPUT_INVALID',
        `Scene ${scene.sceneNumber} image dimensions are missing`,
        409,
      );
    const config = this.config(projectId, request);
    const sceneFingerprint = this.sceneClipFingerprint(
      scene,
      timingItem,
      motion,
      effectiveImage,
      config,
      request.fallbackPolicy,
      fallback,
    );
    const currentClip = this.currentAsset(projectId, `scene:${scene.stableId}:video`);
    const executionId = this.workflow.createExecution(projectId, 'TIMELINE_RENDER');
    if (currentClip?.inputFingerprint === sceneFingerprint)
      return { executionId, jobIds: [], plan };
    const payload: RenderSceneClipPayload = {
      kind: 'SCENE_CLIP',
      projectId,
      chapterId: scene.chapterId,
      sceneId: scene.id,
      sceneStableId: scene.stableId,
      timingRevision: timing.revision,
      timing: timingItem,
      fallbackPolicy: request.fallbackPolicy,
      imagePath: effectiveImage?.path ?? null,
      imageSha256: effectiveImage?.sha256 ?? null,
      imageWidth,
      imageHeight,
      motionPlan: motion,
      config,
      outputPath: `projects/${projectId}/video/scenes/${scene.id}-${randomUUID()}.mp4`,
      fingerprint: sceneFingerprint,
    };
    const stepId = this.workflow.createStep(
      executionId,
      `scene-clip:${scene.id}:${sceneFingerprint.slice(0, 16)}`,
      'RENDER_SCENE_CLIP',
      scene.id,
      sceneFingerprint,
      3,
      payload,
    );
    const jobId = this.workflow.createJob('RENDER_SCENE_CLIP', scene.id, stepId);
    this.renderJobs.create({
      projectId,
      stepId,
      renderType: 'SCENE_CLIP',
      scopeId: `scene:${scene.stableId}`,
      expectedDurationMs: timingItem.durationMs,
    });
    return { executionId, jobIds: [jobId], plan };
  }

  status(projectId: Id, chapterId?: Id): HierarchicalProgress | null {
    const chapter = chapterId ? this.chapters.get(chapterId) : null;
    const sceneIds = chapter
      ? new Set(this.scenes.listScenes(chapter.id).map((scene) => scene.id))
      : new Set<Id>();
    const rows = this.context.database.sqlite
      .prepare(
        `SELECT ws.type,ws.entity_id as entityId,ws.status,ws.progress,
          ws.progress_message as message,ws.updated_at as updatedAt,
          r.expected_duration_ms as expectedDurationMs,r.progress_time_ms as progressTimeMs
         FROM workflow_steps ws
         JOIN workflow_executions we ON we.id=ws.execution_id
         LEFT JOIN render_jobs r ON r.step_id=ws.id
         WHERE we.project_id=?
           AND ws.type IN ('BUILD_SCENE_TIMING','BUILD_MOTION_PLAN','RENDER_SCENE_CLIP',
                           'RENDER_CHAPTER_VIDEO','RENDER_PROJECT_VIDEO')
         ORDER BY ws.updated_at DESC`,
      )
      .all(projectId) as TimelineStatusRow[];
    const relevant = rows.filter((row) => {
      if (!chapter) return true;
      return (
        (row.type === 'BUILD_SCENE_TIMING' && row.entityId === chapter.id) ||
        (row.type === 'BUILD_MOTION_PLAN' && row.entityId === chapter.id) ||
        (row.type === 'RENDER_CHAPTER_VIDEO' && row.entityId === chapter.id) ||
        (row.type === 'RENDER_SCENE_CLIP' && sceneIds.has(row.entityId))
      );
    });
    const latestByEntity = new Map<string, TimelineStatusRow>();
    for (const row of relevant) {
      const key = `${row.type}:${row.entityId}`;
      if (!latestByEntity.has(key)) latestByEntity.set(key, row);
    }
    const latest = [...latestByEntity.values()];
    if (!latest.length) return null;
    const active = latest.filter(
      (row) =>
        row.status !== 'COMPLETED' && row.status !== 'INVALIDATED' && row.status !== 'CANCELLED',
    );
    const pool = active.length ? active : latest;
    const rank = Math.max(
      ...pool.map((row) => timelineStageOrder.indexOf(timelineStageByType[row.type]) + 1),
    );
    const stageRows = pool.filter(
      (row) => timelineStageOrder.indexOf(timelineStageByType[row.type]) + 1 === rank,
    );
    const stage = stageRows[0] ? timelineStageByType[stageRows[0].type] : null;
    if (!stage) return null;
    const levels = timelineStageOrder.flatMap((level) => {
      const levelRows = latest.filter((row) => timelineStageByType[row.type] === level);
      return levelRows.length
        ? [summarizeTimelineStage(levelRows, level, chapterId ?? projectId)]
        : [];
    });
    const summary = summarizeTimelineStage(stageRows, stage, chapterId ?? projectId);
    return {
      ...summary,
      status: latest.some((row) => row.status === 'FAILED') ? 'FAILED' : summary.status,
      error: latest.find((row) => row.status === 'FAILED')?.message ?? summary.error,
      levels,
    };
  }
  invalidateRenderOutputs(projectId: Id): void {
    this.timeline.invalidateRenderOutputs(projectId);
  }

  private config(projectId: Id, request?: RenderRequest): RenderConfig {
    return renderConfigSchema.parse({
      ...renderConfigSchema.parse({}),
      ...this.projects.getRenderConfig(projectId),
      ...(request?.qualityPreset ? { qualityPreset: request.qualityPreset } : {}),
      ...(request?.fitMode ? { fitMode: request.fitMode } : {}),
      ...(request?.fallbackPolicy ? { fallbackPolicy: request.fallbackPolicy } : {}),
    });
  }

  private fallbackAsset(
    projectId: Id,
    sceneStableId: string,
    policy: RenderFallbackPolicy,
  ): AssetDetails | null {
    if (policy === 'HOLD_PREVIOUS') {
      const row = this.context.database.sqlite
        .prepare(
          `SELECT a.id,a.path,a.type,a.sha256,a.input_fingerprint as inputFingerprint,a.metadata
           FROM assets a
           LEFT JOIN scene_image_generations g ON g.asset_id=a.id
           LEFT JOIN visual_prompt_packages p ON p.id=g.visual_prompt_package_id
           LEFT JOIN image_generation_settings s ON s.project_id=a.project_id
           WHERE a.project_id=? AND a.role=? AND a.status='READY' AND a.is_current=0
             AND (
               g.id IS NULL OR (
                 g.status='COMPLETED' AND g.review_status<>'REJECTED' AND
                 (COALESCE(s.require_image_approval,0)=0 OR g.review_status='ACCEPTED') AND
                 (
                   g.source='MANUAL' OR (
                     p.status='CURRENT' AND p.is_current=1 AND
                     p.input_fingerprint=g.package_fingerprint AND
                     s.input_fingerprint=g.settings_fingerprint
                   )
                 )
               )
             )
           ORDER BY a.updated_at DESC,a.created_at DESC LIMIT 1`,
        )
        .get(projectId, `scene:${sceneStableId}:image`) as
        | {
            id: Id;
            path: string;
            type: string;
            sha256: string;
            inputFingerprint: string | null;
            metadata: string;
          }
        | undefined;
      return row ? { ...row, metadata: parseMetadata(row.metadata) } : null;
    }
    if (policy === 'PROJECT_BACKGROUND') {
      const background = this.currentAsset(projectId, 'project:background');
      return background?.type === 'BACKGROUND_IMAGE' ? background : null;
    }
    return null;
  }

  private chapter(projectId: Id, chapterId: Id): ChapterDto {
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    return chapter;
  }

  private currentAsset(projectId: Id, role: string): AssetDetails | null {
    const row = this.context.database.sqlite
      .prepare(
        `SELECT a.id,a.path,a.type,a.sha256,a.input_fingerprint as inputFingerprint,a.metadata
         FROM assets a
         LEFT JOIN scene_image_generations g ON g.asset_id=a.id
         LEFT JOIN visual_prompt_packages p ON p.id=g.visual_prompt_package_id
         LEFT JOIN image_generation_settings s ON s.project_id=a.project_id
         WHERE a.project_id=? AND a.role=? AND a.status='READY' AND a.is_current=1
           AND (
             a.type<>'SCENE_IMAGE' OR g.id IS NULL OR (
               g.status='COMPLETED' AND g.review_status<>'REJECTED' AND
               (COALESCE(s.require_image_approval,0)=0 OR g.review_status='ACCEPTED') AND
               (
                 g.source='MANUAL' OR (
                   p.status='CURRENT' AND p.is_current=1 AND
                   p.input_fingerprint=g.package_fingerprint AND
                   s.input_fingerprint=g.settings_fingerprint
                 )
               )
             )
           )
         ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(projectId, role) as
      | {
          id: Id;
          path: string;
          type: string;
          sha256: string;
          inputFingerprint: string | null;
          metadata: string;
        }
      | undefined;
    if (!row) return null;
    return { ...row, metadata: parseMetadata(row.metadata) };
  }

  private async audioDuration(asset: AssetDetails): Promise<number> {
    const metadataDuration = durationFromMetadata(asset);
    if (metadataDuration) return metadataDuration;
    const probe = await this.context.media.probe(
      safeWorkspacePath(this.context.workspace.root, asset.path),
    );
    const format =
      probe.format && typeof probe.format === 'object'
        ? (probe.format as Record<string, unknown>)
        : {};
    const duration =
      typeof format.duration === 'string' ? Number(format.duration) : Number(format.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new AppError('TIMELINE_AUDIO_INVALID', 'Chapter audio has no measured duration', 409);
    return Math.round(duration * 1_000);
  }

  private sceneClipFingerprint(
    scene: SceneDto,
    timing: SceneTimingItem,
    motion: MotionPlan,
    image: AssetDetails | null,
    config: RenderConfig,
    fallbackPolicy = 'FAIL' as RenderFallbackPolicy,
    fallbackAsset: AssetDetails | null = null,
  ): string {
    return fingerprint({
      compilerVersion: RENDER_COMPILER_VERSIONS.scene,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      timing: {
        revision: timing.sceneRevision,
        startMs: timing.startMs,
        endMs: timing.endMs,
        sourceRange: timing.sourceRange,
      },
      motion: motion.inputFingerprint,
      image: image?.sha256 ?? null,
      fallbackPolicy,
      fallbackAsset: fallbackAsset?.sha256 ?? null,
      profile: {
        width: config.width,
        height: config.height,
        fps: config.fps,
        qualityPreset: config.qualityPreset,
      },
      fitMode: config.fitMode,
    });
  }

  private assertNoActiveRenderJobs(projectId: Id, scope: RenderScope): void {
    const active = this.renderJobs
      .list(projectId)
      .filter((job) => job.status === 'PENDING' || job.status === 'RUNNING');
    const matches = new Set<string>();
    if (scope.kind === 'SCENE') {
      const scene = this.scenes.getScene(scope.sceneId);
      if (scene) matches.add(`SCENE_CLIP:scene:${scene.stableId}`);
    } else {
      for (const chapter of this.resolveChapters(projectId, scope)) {
        matches.add(`CHAPTER_VIDEO:chapter:${chapter.id}`);
        for (const scene of this.scenes.listScenes(chapter.id))
          matches.add(`SCENE_CLIP:scene:${scene.stableId}`);
      }
      matches.add(`PROJECT_VIDEO:${projectVideoRole(projectId, scope)}`);
    }
    if (active.some((job) => matches.has(`${job.renderType}:${job.scopeId}`)))
      throw new AppError('CONFLICT', 'A render job for this scope is already active', 409);
  }

  private resolveChapters(projectId: Id, scope: RenderRequest['scope']): ChapterDto[] {
    const chapters = this.chapters.list(projectId);
    if (scope.kind === 'FULL_STORY') {
      if (chapters.length === 0)
        throw new AppError('RENDER_SCOPE_EMPTY', 'Project has no Chapters', 409);
      return chapters;
    }
    if (scope.kind === 'CHAPTER') {
      const chapter = chapters.find((candidate) => candidate.id === scope.chapterId);
      if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found in this Project', 404);
      return [chapter];
    }
    if (scope.kind === 'CHAPTER_RANGE') {
      const selected = chapters.filter(
        (chapter) =>
          chapter.number >= scope.startChapterNumber && chapter.number <= scope.endChapterNumber,
      );
      if (selected.length === 0)
        throw new AppError('RENDER_SCOPE_EMPTY', 'Chapter range is empty', 409);
      return selected;
    }
    if (scope.kind === 'SELECTED_CHAPTERS') {
      const selected = chapters.filter((chapter) => scope.chapterIds.includes(chapter.id));
      if (selected.length !== scope.chapterIds.length)
        throw new AppError(
          'NOT_FOUND',
          'One or more selected Chapters are not in this Project',
          404,
        );
      return selected;
    }
    const scene = this.scenes.getScene(scope.sceneId);
    return scene ? chapters.filter((chapter) => chapter.id === scene.chapterId) : [];
  }
}
