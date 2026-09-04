import { z } from 'zod';
import type { Id, WorkflowStatus } from './index.js';
import { motionSourceSchema } from './video.js';

const idSchema = z.string().uuid();
const workflowStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'INVALIDATED',
  'CANCELLED',
]);
const boundedFingerprint = z.string().trim().min(1).max(128);
const assetUrlSchema = z.union([z.string().url(), z.string().startsWith('/api/')]);
const positiveMilliseconds = z.number().int().positive();
const nonNegativeMilliseconds = z.number().int().min(0);

export const motionTypeSchema = z.enum([
  'STATIC',
  'ZOOM_IN',
  'ZOOM_OUT',
  'PAN_LEFT',
  'PAN_RIGHT',
  'PAN_UP',
  'PAN_DOWN',
  'PAN_ZOOM',
  'SLOW_PUSH_IN',
]);
export type MotionType = z.infer<typeof motionTypeSchema>;

export const motionEasingSchema = z.enum(['LINEAR', 'EASE_IN_OUT']);
export type MotionEasing = z.infer<typeof motionEasingSchema>;

export const timelineModeSchema = z.enum(['AUTO', 'MANUAL']);
export type TimelineMode = z.infer<typeof timelineModeSchema>;

export const fitModeSchema = z.enum(['COVER', 'CONTAIN']);
export type FitMode = z.infer<typeof fitModeSchema>;

export const transitionTypeSchema = z.enum(['CUT', 'CROSSFADE', 'FADE']);
export type TransitionType = z.infer<typeof transitionTypeSchema>;

export const visualSourceSchema = z.enum(['SCENES', 'BACKGROUND']);
export type VisualSource = z.infer<typeof visualSourceSchema>;

export const renderFallbackPolicySchema = z.enum([
  'FAIL',
  'HOLD_PREVIOUS',
  'BLACK',
  'PROJECT_BACKGROUND',
]);
export type RenderFallbackPolicy = z.infer<typeof renderFallbackPolicySchema>;

export const qualityPresetSchema = z.enum(['FAST_PREVIEW', 'STANDARD', 'HIGH']);
export type QualityPreset = z.infer<typeof qualityPresetSchema>;

export const normalizedPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();
export type NormalizedPoint = z.infer<typeof normalizedPointSchema>;

export const sourceRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end <= value.start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'Source range end must be greater than start',
      });
    }
  });
export type TimelineSourceRange = z.infer<typeof sourceRangeSchema>;

export const motionPlanSchema = z
  .object({
    id: idSchema,
    sceneId: z.string().trim().min(1).max(200),
    sceneRevision: z.number().int().positive(),
    timingRevision: z.number().int().positive().nullable(),
    revision: z.number().int().positive(),
    motionType: motionTypeSchema,
    startScale: z.number().finite().min(1).max(1.25),
    endScale: z.number().finite().min(1).max(1.25),
    startPosition: normalizedPointSchema,
    endPosition: normalizedPointSchema,
    easing: motionEasingSchema,
    focusPoint: normalizedPointSchema.nullable(),
    intensity: z.number().finite().min(0).max(1),
    durationMs: positiveMilliseconds,
    status: workflowStatusSchema,
    inputFingerprint: boundedFingerprint,
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();
export type MotionPlan = z.infer<typeof motionPlanSchema>;

export const motionPlanUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive().optional(),
    motionType: motionTypeSchema,
    startScale: z.number().finite().min(1).max(1.25),
    endScale: z.number().finite().min(1).max(1.25),
    startPosition: normalizedPointSchema,
    endPosition: normalizedPointSchema,
    easing: motionEasingSchema,
    focusPoint: normalizedPointSchema.nullable().default(null),
    intensity: z.number().finite().min(0).max(1).default(0.5),
  })
  .strict();
export type MotionPlanUpdate = z.infer<typeof motionPlanUpdateSchema>;

export const sceneTimingItemSchema = z
  .object({
    sceneId: idSchema,
    sceneRevision: z.number().int().positive(),
    sourceRange: sourceRangeSchema,
    rawStartMs: nonNegativeMilliseconds,
    rawEndMs: nonNegativeMilliseconds,
    startMs: nonNegativeMilliseconds,
    endMs: positiveMilliseconds,
    durationMs: positiveMilliseconds,
    warning: z.string().max(500).nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.rawEndMs <= value.rawStartMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rawEndMs'],
        message: 'Raw timing end must be greater than start',
      });
    }
    if (value.endMs <= value.startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endMs'],
        message: 'Timing end must be greater than start',
      });
    }
    if (value.durationMs !== value.endMs - value.startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationMs'],
        message: 'Timing duration must equal end minus start',
      });
    }
  });
export type SceneTimingItem = z.infer<typeof sceneTimingItemSchema>;

export const sceneTimingSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    chapterId: idSchema,
    chapterRevision: z.number().int().positive(),
    audioAssetId: idSchema,
    mode: timelineModeSchema,
    revision: z.number().int().positive(),
    durationMs: positiveMilliseconds,
    minimumSceneDurationMs: positiveMilliseconds,
    items: z.array(sceneTimingItemSchema).min(1).max(2_000),
    warnings: z.array(z.string().max(500)).max(100),
    inputFingerprint: boundedFingerprint,
    status: workflowStatusSchema,
    isCurrent: z.boolean(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();
export type SceneTiming = z.infer<typeof sceneTimingSchema>;

export const sceneTimingUpdateItemSchema = z
  .object({
    sceneId: idSchema,
    startMs: nonNegativeMilliseconds,
    endMs: positiveMilliseconds,
  })
  .strict();
export type SceneTimingUpdateItem = z.infer<typeof sceneTimingUpdateItemSchema>;

export const sceneTimingUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive().optional(),
    mode: timelineModeSchema.default('MANUAL'),
    items: z.array(sceneTimingUpdateItemSchema).min(1).max(2_000),
  })
  .strict();
export type SceneTimingUpdate = z.infer<typeof sceneTimingUpdateSchema>;

export const sceneAiMotionStatusSchema = z
  .object({
    generationId: idSchema.nullable(),
    status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'MISSING']),
    reviewStatus: z.enum(['UNREVIEWED', 'ACCEPTED', 'REJECTED']).default('UNREVIEWED'),
    hasAcceptedClip: z.boolean(),
  })
  .strict();
export type SceneAiMotionStatus = z.infer<typeof sceneAiMotionStatusSchema>;

export const sceneTimelineItemSchema = z
  .object({
    sceneId: idSchema,
    sceneRevision: z.number().int().positive(),
    sceneNumber: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    sourceExcerpt: z.string().max(500),
    sourceRange: sourceRangeSchema,
    startMs: nonNegativeMilliseconds,
    endMs: positiveMilliseconds,
    durationMs: positiveMilliseconds,
    motionPlan: motionPlanSchema.nullable(),
    transition: transitionTypeSchema,
    motionSource: motionSourceSchema.default('KEN_BURNS'),
    aiMotion: sceneAiMotionStatusSchema.nullable(),
    transitionDurationMs: z.number().int().min(0).max(800),
    imageAssetId: idSchema.nullable(),
    imageAssetUrl: assetUrlSchema.nullable(),
    sceneClipAssetId: idSchema.nullable(),
    sceneClipAssetUrl: assetUrlSchema.nullable(),
    status: workflowStatusSchema,
    blockers: z.array(z.string().max(500)).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endMs <= value.startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endMs'],
        message: 'Scene timeline end must be greater than start',
      });
    }
    if (value.durationMs !== value.endMs - value.startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationMs'],
        message: 'Scene timeline duration must equal end minus start',
      });
    }
    if (value.transition === 'CUT' && value.transitionDurationMs !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transitionDurationMs'],
        message: 'CUT transitions must have zero duration',
      });
    }
  });
export type SceneTimelineItem = z.infer<typeof sceneTimelineItemSchema>;

export const chapterTimelineSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    chapterId: idSchema,
    chapterRevision: z.number().int().positive(),
    mode: timelineModeSchema,
    timingRevision: z.number().int().positive(),
    audioAssetId: idSchema.nullable(),
    subtitleAssetId: idSchema.nullable(),
    durationMs: positiveMilliseconds,
    items: z.array(sceneTimelineItemSchema).min(1).max(2_000),
    fingerprint: boundedFingerprint,
    status: workflowStatusSchema,
    videoAssetId: idSchema.nullable(),
    videoAssetUrl: assetUrlSchema.nullable(),
    warnings: z.array(z.string().max(500)).max(100).default([]),
    blockers: z.array(z.string().max(500)).max(100),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();
export type ChapterTimeline = z.infer<typeof chapterTimelineSchema>;

export const renderScopeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('SCENE'), sceneId: idSchema }).strict(),
    z.object({ kind: z.literal('CHAPTER'), chapterId: idSchema }).strict(),
    z
      .object({
        kind: z.literal('CHAPTER_RANGE'),
        startChapterNumber: z.number().int().positive(),
        endChapterNumber: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('SELECTED_CHAPTERS'),
        chapterIds: z.array(idSchema).min(1).max(500),
      })
      .strict(),
    z.object({ kind: z.literal('FULL_STORY') }).strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.kind === 'CHAPTER_RANGE' && value.endChapterNumber < value.startChapterNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endChapterNumber'],
        message: 'Chapter range must be ascending',
      });
    }
    if (
      value.kind === 'SELECTED_CHAPTERS' &&
      new Set(value.chapterIds).size !== value.chapterIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapterIds'],
        message: 'Selected Chapters must be unique',
      });
    }
  });
export type RenderScope = z.infer<typeof renderScopeSchema>;

export const projectTimelineSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    scope: renderScopeSchema,
    chapterIds: z.array(idSchema).min(1).max(500),
    chapterNumbers: z.array(z.number().int().positive()).min(1).max(500),
    chapterVideoAssetIds: z.array(idSchema).min(1).max(500),
    durationMs: positiveMilliseconds,
    musicAssetId: idSchema.nullable(),
    musicEnabled: z.boolean(),
    fingerprint: boundedFingerprint,
    status: workflowStatusSchema,
    videoAssetUrl: assetUrlSchema.nullable(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();
export type ProjectTimeline = z.infer<typeof projectTimelineSchema>;

export const renderRequestSchema = z
  .object({
    source: visualSourceSchema.default('SCENES'),
    scope: renderScopeSchema.default({ kind: 'FULL_STORY' }),
    autoBuild: z.boolean().default(false),
    fallbackPolicy: renderFallbackPolicySchema.default('FAIL'),
    qualityPreset: qualityPresetSchema.optional(),
    fitMode: fitModeSchema.optional(),
  })
  .strict();
export type RenderRequest = z.infer<typeof renderRequestSchema>;

export const renderBlockerSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
    entityId: idSchema.nullable(),
    retryable: z.boolean(),
  })
  .strict();
export type RenderBlocker = z.infer<typeof renderBlockerSchema>;

export const renderPlanCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    reusable: z.number().int().nonnegative(),
    required: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  })
  .strict();
export type RenderPlanCounts = z.infer<typeof renderPlanCountsSchema>;

export const renderPlanSchema = z
  .object({
    projectId: idSchema,
    scope: renderScopeSchema,
    source: visualSourceSchema,
    autoBuild: z.boolean(),
    fallbackPolicy: renderFallbackPolicySchema,
    scenes: renderPlanCountsSchema,
    chapters: renderPlanCountsSchema,
    project: z
      .object({
        required: z.boolean(),
        reusable: z.boolean(),
        fingerprint: boundedFingerprint.nullable(),
      })
      .strict(),
    ai: z
      .object({
        scenesSelected: z.number().int().nonnegative(),
        missingMotion: z.number().int().nonnegative(),
        clipsToNormalize: z.number().int().nonnegative(),
        estimatedGenerations: z.number().int().nonnegative(),
        estimatedGenerationMs: nonNegativeMilliseconds.nullable(),
      })
      .strict()
      .nullable(),
    expectedDurationMs: nonNegativeMilliseconds.nullable(),
    blockers: z.array(renderBlockerSchema).max(1_000),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type RenderPlan = z.infer<typeof renderPlanSchema>;

const hierarchicalProgressLevelSchema = z
  .object({
    stage: z.enum(['TIMING', 'MOTION', 'SCENE_CLIP', 'CHAPTER_VIDEO', 'PROJECT_VIDEO']),
    status: workflowStatusSchema,
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    progress: z.number().finite().min(0).max(1),
    currentTimeMs: nonNegativeMilliseconds.nullable(),
    expectedDurationMs: nonNegativeMilliseconds.nullable(),
    activeEntityId: idSchema.nullable(),
    error: z.string().max(500).nullable(),
  })
  .strict();
export type HierarchicalProgressLevel = z.infer<typeof hierarchicalProgressLevelSchema>;
export const hierarchicalProgressSchema = hierarchicalProgressLevelSchema
  .extend({
    levels: z.array(hierarchicalProgressLevelSchema).max(5).default([]),
  })
  .strict();
export type HierarchicalProgress = z.infer<typeof hierarchicalProgressSchema>;

export type TimelineStatus = {
  status: WorkflowStatus;
  blockers: string[];
  progress: HierarchicalProgress | null;
};

export type TimelineId = Id;
