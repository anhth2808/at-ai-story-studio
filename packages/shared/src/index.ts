import { z } from 'zod';
import type { StoryLongStoryCounts } from './story.js';
import type { HierarchicalProgress } from './timeline.js';
export const idSchema = z.string().uuid();
export type Id = z.infer<typeof idSchema>;

export const workflowStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'INVALIDATED',
  'CANCELLED',
]);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export const projectStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export const workflowTypeSchema = z.literal('AUDIO_STORY');
export const workflowStepTypeSchema = z.enum([
  'CLEAN_TEXT',
  'TTS_SEGMENT',
  'MERGE_AUDIO',
  'SUBTITLE',
  'PREPARE_BACKGROUND',
  'RENDER',
  'BUILD_SCENE_TIMING',
  'BUILD_MOTION_PLAN',
  'RENDER_SCENE_CLIP',
  'RENDER_CHAPTER_VIDEO',
  'RENDER_PROJECT_VIDEO',
  'GENERATE_STORY_BLUEPRINT',
  'GENERATE_CHAPTER_PLANS',
  'GENERATE_CHAPTER',
  'GENERATE_CHAPTER_SUMMARY',
  'GENERATE_STORY_ARCS',
  'GENERATE_CHAPTER_PLAN_WINDOW',
  'GENERATE_CHAPTER_V2',
  'ANALYZE_STORY_STATE',
  'CHECK_CONTINUITY',
  'GENERATE_SCENES',
  'REGENERATE_SCENE',
  'GENERATE_SCENE_PROMPT',
  'GENERATE_CHARACTER_VISUAL_PROFILE',
  'GENERATE_LOCATION_VISUAL_PROFILE',
  'GENERATE_OBJECT_VISUAL_PROFILE',
  'BUILD_VISUAL_PROMPT',
  'GENERATE_SCENE_IMAGE',
  'GENERATE_SHOT_IMAGE',
  'GENERATE_AI_SCENE_VIDEO',
  'GENERATE_AI_SHOT_VIDEO',
  'PLAN_SHOTS',
  'GENERATE_VISUAL_REFERENCE',
  'CRITIQUE_SCENE_IMAGE',
  'CRITIQUE_SCENE_VIDEO',
  'EXTRACT_SHOT_CONTINUATION_FRAME',
  'ADVANCE_PRODUCTION_RUN',
  'GENERATE_PUBLICATION_METADATA',
  'BUILD_PUBLICATION_PACKAGE',
  'EXPORT_PUBLICATION_PACKAGE',
]);
export type WorkflowStepType = z.infer<typeof workflowStepTypeSchema>;
export const assetStatusSchema = z.enum(['READY', 'INVALID']);
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export const assetTypeSchema = z.enum([
  'TTS_SEGMENT_AUDIO',
  'CHAPTER_AUDIO',
  'SUBTITLE',
  'BACKGROUND_IMAGE',
  'BACKGROUND_VIDEO',
  'MUSIC',
  'RENDERED_VIDEO',
  'SCENE_VIDEO_CLIP',
  'CHAPTER_VIDEO',
  'PROJECT_VIDEO',
  'TIMELINE_MANIFEST',
  'SCENE_IMAGE',
  'SHOT_IMAGE',
  'CHARACTER_REFERENCE_IMAGE',
  'STYLE_REFERENCE_IMAGE',
  'AI_SCENE_VIDEO',
  'CHARACTER_PROTOTYPE_REFERENCE',
  'CHARACTER_STAGE_REFERENCE',
  'LOCATION_REFERENCE',
  'SHOT_CONTINUATION_FRAME',
  'CRITIC_SAMPLE_IMAGE',
  'AI_SHOT_VIDEO',
  'PUBLICATION_THUMBNAIL',
]);
export type AssetType = z.infer<typeof assetTypeSchema>;

export const projectInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(''),
    language: z.string().trim().min(2).max(20).default('vi-VN'),
    workflowType: workflowTypeSchema.default('AUDIO_STORY'),
  })
  .strict();
export type ProjectInput = z.infer<typeof projectInputSchema>;
export const projectUpdateSchema = projectInputSchema.partial();

export const chapterInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().max(2_000_000),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export type ChapterInput = z.infer<typeof chapterInputSchema>;

export const reorderSchema = z.object({ chapters: z.array(idSchema).min(1) }).strict();
export const renderConfigSchema = z
  .object({
    width: z.union([z.literal(1920), z.literal(1080)]).default(1920),
    height: z.union([z.literal(1080), z.literal(1920)]).default(1080),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
    qualityPreset: z.enum(['FAST_PREVIEW', 'STANDARD', 'HIGH']).default('STANDARD'),
    fitMode: z.enum(['COVER', 'CONTAIN']).default('COVER'),
    motionIntensity: z.number().finite().min(0).max(1).default(0.5),
    transition: z.enum(['CUT', 'CROSSFADE', 'FADE']).default('CUT'),
    transitionDurationMs: z.number().int().min(0).max(800).default(0),
    subtitleFontSize: z.number().int().min(12).max(120).default(42),
    subtitlePosition: z.enum(['TOP', 'CENTER', 'BOTTOM']).default('BOTTOM'),
    subtitleOutlineWidth: z.number().finite().min(0).max(8).default(2),
    narrationVolume: z.number().finite().min(0).max(2).default(1),
    musicVolume: z.number().finite().min(0).max(1).default(0.12),
    musicEnabled: z.boolean().default(true),
    loopMusic: z.boolean().default(true),
    visualSource: z.enum(['SCENES', 'BACKGROUND']).default('BACKGROUND'),
    fallbackPolicy: z
      .enum(['FAIL', 'HOLD_PREVIOUS', 'BLACK', 'PROJECT_BACKGROUND'])
      .default('FAIL'),
  })
  .superRefine((value, ctx) => {
    const validRatio =
      (value.width === 1920 && value.height === 1080) ||
      (value.width === 1080 && value.height === 1920);
    if (!validRatio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['width'],
        message: 'Render dimensions must be 1920x1080 or 1080x1920',
      });
    }
    if (value.transition === 'CUT' && value.transitionDurationMs !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transitionDurationMs'],
        message: 'CUT transitions must have zero duration',
      });
    }
    if (value.transition !== 'CUT' && value.transitionDurationMs < 300) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transitionDurationMs'],
        message: 'Non-CUT transitions must be at least 300 milliseconds',
      });
    }
  });
export type RenderConfig = z.infer<typeof renderConfigSchema>;
export const subtitleReplacementSchema = z.object({
  srt: z.string().min(1).max(2_000_000),
});

export const healthSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.record(z.object({ ok: z.boolean(), message: z.string() })),
});
export type Health = z.infer<typeof healthSchema>;

export type ProjectDto = {
  id: Id;
  title: string;
  description: string;
  language: string;
  workflowType: 'AUDIO_STORY';
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};
export type ChapterDto = {
  id: Id;
  projectId: Id;
  number: number;
  title: string;
  content: string;
  revision: number;
  origin?: 'MANUAL' | 'GENERATED';
  storyPlanItemId?: string | null;
  storyGenerationId?: Id | null;
  continuityStatus?: 'CURRENT' | 'CONTINUITY_STALE' | 'NOT_ANALYZED';
  continuityCheckStatus?: 'PASS' | 'WARN' | 'FAIL' | null;
  summaryStatus?: 'CURRENT' | 'STALE' | 'MISSING';
  createdAt: string;
  updatedAt: string;
  audioStatus?: WorkflowStatus;
  subtitleStatus?: WorkflowStatus;
};
export type JobDto = {
  id: Id;
  type: string;
  entityId: Id;
  status: WorkflowStatus;
  progress: number;
  error: string | null;
  attempts: number;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
};
export type StatusSummary = {
  projectId: Id;
  chapterId?: Id;
  narration: WorkflowStatus;
  subtitles: WorkflowStatus;
  background: WorkflowStatus;
  render: WorkflowStatus;
  timeline?: HierarchicalProgress | null;
  jobs: JobDto[];
  story?: StoryLongStoryCounts;
};
export type SafeError = {
  code: string;
  message: string;
  retryable: boolean;
  category?:
    | 'INFRASTRUCTURE'
    | 'PROVIDER'
    | 'STRUCTURED_OUTPUT'
    | 'CONTEXT'
    | 'CONTINUITY'
    | 'CANCELLED'
    | 'BUDGET'
    | 'PRODUCTION'
    | 'PACKAGE';
  diagnostics?: string;
};

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly retryable = false,
    public readonly diagnostics?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export * from './visual.js';
export * from './image.js';
export * from './story.js';
export * from './timeline.js';
export * from './video.js';
export * from './production.js';
export * from './publication.js';
export * from './shot.js';
export * from './quality.js';
