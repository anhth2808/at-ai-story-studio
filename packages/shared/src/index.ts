import { z } from 'zod';
import type { StoryLongStoryCounts } from './story.js';

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
  'TIMELINE_MANIFEST',
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
    subtitleFontSize: z.number().int().min(12).max(120).default(42),
    narrationVolume: z.number().min(0).max(2).default(1),
    musicVolume: z.number().min(0).max(1).default(0.12),
    musicEnabled: z.boolean().default(true),
    loopMusic: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.width === value.height)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Render dimensions must have aspect ratio',
      });
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
    | 'BUDGET';
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
export * from './story.js';
