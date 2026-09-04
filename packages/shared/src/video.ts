import { z } from 'zod';

const idSchema = z.string().uuid();
const boundedString = (max: number) => z.string().max(max);
const safeSeed = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const videoProviderSchema = z.enum(['COMFYUI']);
export type VideoProvider = z.infer<typeof videoProviderSchema>;

export const videoWorkflowTemplateSchema = z.enum(['image-to-video-v1']);
export type VideoWorkflowTemplate = z.infer<typeof videoWorkflowTemplateSchema>;

export const videoPresetSchema = z.enum(['LOW_VRAM', 'BALANCED', 'QUALITY']);
export type VideoPreset = z.infer<typeof videoPresetSchema>;

export const motionSourceSchema = z.enum(['KEN_BURNS', 'AI_VIDEO', 'HYBRID']);
export type MotionSource = z.infer<typeof motionSourceSchema>;

export const aiMotionIntensitySchema = z.enum(['SUBTLE', 'MEDIUM', 'STRONG']);
export type AiMotionIntensity = z.infer<typeof aiMotionIntensitySchema>;

export const aiMotionPrioritySchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
export type AiMotionPriority = z.infer<typeof aiMotionPrioritySchema>;

export const aiCameraMotionSchema = z.enum([
  'STATIC',
  'PUSH_IN',
  'PULL_OUT',
  'PAN_LEFT',
  'PAN_RIGHT',
  'ORBIT_SUBTLE',
  'HANDHELD_SUBTLE',
]);
export type AiCameraMotion = z.infer<typeof aiCameraMotionSchema>;

// The only duration policy implemented: AI motion first, then a crossfade into
// a bounded Ken Burns continuation over the accepted scene image. LOOP_AI and
// TIME_STRETCH are deliberately absent; repeated diffusion motion looks
// unnatural and time-stretching changes narration-independent pacing.
export const aiClipDurationPolicySchema = z.literal('AI_THEN_KEN_BURNS');
export type AiClipDurationPolicy = z.infer<typeof aiClipDurationPolicySchema>;

export const videoReadinessStatusSchema = z.enum([
  'NOT_CONFIGURED',
  'COMFYUI_UNAVAILABLE',
  'WORKFLOW_MISSING',
  'VIDEO_MODEL_MISSING',
  'DEPENDENCY_MISSING',
  'INSUFFICIENT_CONFIGURATION',
  'READY',
  'ERROR',
]);
export type VideoReadinessStatus = z.infer<typeof videoReadinessStatusSchema>;

export const sceneVideoGenerationStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type SceneVideoGenerationStatus = z.infer<typeof sceneVideoGenerationStatusSchema>;

export const sceneVideoReviewStatusSchema = z.enum(['UNREVIEWED', 'ACCEPTED', 'REJECTED']);
export type SceneVideoReviewStatus = z.infer<typeof sceneVideoReviewStatusSchema>;

export const videoGenerationErrorCodeSchema = z.enum([
  'PROVIDER_UNAVAILABLE',
  'WORKFLOW_INVALID',
  'MODEL_MISSING',
  'SUBMISSION_FAILED',
  'GENERATION_FAILED',
  'OUTPUT_MISSING',
  'OUTPUT_INVALID',
  'DOWNLOAD_FAILED',
  'TIMEOUT',
  'CANCELLED',
  'STALE_INPUT',
  'OUTCOME_UNKNOWN',
  'CONFIGURATION_ERROR',
  'SOURCE_UPLOAD_FAILED',
  'OUT_OF_MEMORY',
]);
export type VideoGenerationErrorCode = z.infer<typeof videoGenerationErrorCodeSchema>;

export const videoGenerationIssueSchema = z.enum([
  'IDENTITY_DRIFT',
  'FACE_DISTORTION',
  'BODY_DISTORTION',
  'EXTRA_LIMBS',
  'MOTION_TOO_STRONG',
  'MOTION_TOO_WEAK',
  'CAMERA_WRONG',
  'OBJECT_MORPHING',
  'BACKGROUND_MORPHING',
  'FLICKER',
  'LOOP_BAD',
  'OTHER',
]);
export type VideoGenerationIssue = z.infer<typeof videoGenerationIssueSchema>;

const videoBaseUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Video provider base URL must use HTTP or HTTPS',
  });

// Wan 2.2 TI2V-5B is the only approved template; the model component names are
// the canonical ComfyUI repackaged files so a fresh install is READY once the
// three files exist in the server model directories.
export const wan22Ti2v5bDefaults = {
  diffusionModel: 'wan2.2_ti2v_5B_fp16.safetensors',
  textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vaeName: 'wan2.2_vae.safetensors',
} as const;

export const videoProviderSettingsBaseSchema = z
  .object({
    provider: videoProviderSchema.default('COMFYUI'),
    baseUrl: videoBaseUrlSchema.default('http://127.0.0.1:8188'),
    workflowTemplate: z.literal('image-to-video-v1').default('image-to-video-v1'),
    diffusionModel: z.string().trim().max(300).default(wan22Ti2v5bDefaults.diffusionModel),
    textEncoder: z.string().trim().max(300).default(wan22Ti2v5bDefaults.textEncoder),
    vaeName: z.string().trim().max(300).default(wan22Ti2v5bDefaults.vaeName),
    sampler: z.string().trim().min(1).max(120).default('uni_pc'),
    scheduler: z.string().trim().min(1).max(120).default('simple'),
    steps: z.number().int().min(1).max(100).default(20),
    guidance: z.number().min(0).max(30).default(5),
    shift: z.number().min(0).max(100).default(8),
    preset: videoPresetSchema.default('BALANCED'),
    connectionTimeoutMs: z.number().int().min(500).max(120_000).default(5_000),
    generationTimeoutMs: z.number().int().min(30_000).max(86_400_000).default(3_600_000),
  })
  .strict();
export type VideoProviderSettings = z.infer<typeof videoProviderSettingsBaseSchema>;

const videoSeedModeSchema = z.enum(['RANDOM', 'FIXED']);

const validateVideoGenerationSettings = (
  value: { seedMode: z.infer<typeof videoSeedModeSchema>; fixedSeed: number | null },
  context: z.RefinementCtx,
): void => {
  if (value.seedMode === 'FIXED' && value.fixedSeed === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fixedSeed'],
      message: 'A fixed seed is required when seed mode is FIXED',
    });
  }
};

export const videoGenerationSettingsBaseSchema = videoProviderSettingsBaseSchema
  .extend({
    seedMode: videoSeedModeSchema.default('RANDOM'),
    fixedSeed: safeSeed.nullable().default(null),
    requireMotionApproval: z.boolean().default(true),
  })
  .strict();

export const videoGenerationSettingsSchema = videoGenerationSettingsBaseSchema.superRefine(
  validateVideoGenerationSettings,
);
export type VideoGenerationSettings = z.infer<typeof videoGenerationSettingsSchema>;
export type VideoGenerationSettingsInput = z.input<typeof videoGenerationSettingsSchema>;

export const videoGenerationSettingsUpdateSchema = videoGenerationSettingsBaseSchema
  .extend({ expectedRowVersion: z.number().int().positive().optional() })
  .strict()
  .superRefine(validateVideoGenerationSettings);
export type VideoGenerationSettingsUpdate = z.infer<typeof videoGenerationSettingsUpdateSchema>;

export const videoGenerationSettingsDtoSchema = videoGenerationSettingsBaseSchema
  .extend({
    id: idSchema,
    projectId: idSchema,
    rowVersion: z.number().int().positive(),
    inputFingerprint: z.string().min(1).max(128),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine(validateVideoGenerationSettings);
export type VideoGenerationSettingsDto = z.infer<typeof videoGenerationSettingsDtoSchema>;

// Wan 2.2 latent geometry: width/height must be multiples of 32 and the frame
// count must satisfy 4k+1 (81 frames = 3.375s, 121 frames = 5.04s at 24fps).
export const videoFrameCountSchema = z
  .number()
  .int()
  .min(9)
  .max(241)
  .refine((value) => (value - 1) % 4 === 0, {
    message: 'Frame count must satisfy 4k+1 for the Wan latent geometry',
  });
export const videoDimensionSchema = z
  .number()
  .int()
  .min(256)
  .max(1_280)
  .refine((value) => value % 32 === 0, {
    message: 'Video dimension must be a multiple of 32',
  });
export const videoOutputFpsSchema = z.number().int().min(8).max(60);
export const VIDEO_OUTPUT_FPS = 24;
export const AI_CLIP_CROSSFADE_MAX_MS = 1_000;
export const AI_CLIP_CROSSFADE_DEFAULT_MS = 500;

// Composition crossfade is internal to a Scene's AI_THEN_KEN_BURNS policy and
// independent of the between-scene transition setting (CUT must not produce a
// zero-duration xfade). Always >= 1ms whenever composition is needed.
export function resolveAiCrossfadeMs(rawClipDurationMs: number, sceneDurationMs: number): number {
  const overlapMs = Math.min(rawClipDurationMs, sceneDurationMs - rawClipDurationMs);
  const cap = Math.min(AI_CLIP_CROSSFADE_MAX_MS, Math.max(0, Math.floor(overlapMs / 2) - 1));
  return Math.max(1, Math.min(AI_CLIP_CROSSFADE_DEFAULT_MS, cap));
}

export type VideoPresetSpec = {
  width: number;
  height: number;
  frames: number;
  steps: number;
  guidance: number;
};

// Presets are ceiling-clamped to what the selected technique reliably runs on
// the RTX 3060 12GB; the real benchmark in the change may tighten the default.
export const VIDEO_PRESETS: Record<z.infer<typeof videoPresetSchema>, VideoPresetSpec> = {
  LOW_VRAM: { width: 704, height: 384, frames: 81, steps: 20, guidance: 5 },
  BALANCED: { width: 832, height: 480, frames: 81, steps: 20, guidance: 5 },
  QUALITY: { width: 1_280, height: 704, frames: 121, steps: 20, guidance: 5 },
};

// Motion-source storage has no revision counter, so optimistic concurrency is
// intentionally absent here (unlike AiMotionPlan updates).
export const sceneMotionSourceUpdateSchema = z
  .object({
    motionSource: motionSourceSchema,
  })
  .strict();
export type SceneMotionSourceUpdate = z.infer<typeof sceneMotionSourceUpdateSchema>;

export const sceneMotionSourceDtoSchema = z
  .object({
    sceneId: z.string().trim().min(1).max(120),
    motionSource: motionSourceSchema,
    updatedAt: z.string(),
  })
  .strict();
export type SceneMotionSourceDto = z.infer<typeof sceneMotionSourceDtoSchema>;

export const aiMotionPlanIntentSchema = z
  .object({
    characterAction: boundedString(500).default(''),
    environmentMotion: boundedString(500).default(''),
    cameraMotion: aiCameraMotionSchema.default('STATIC'),
    intensity: aiMotionIntensitySchema.default('SUBTLE'),
    priority: aiMotionPrioritySchema.default('NONE'),
  })
  .strict();
export type AiMotionPlanIntent = z.infer<typeof aiMotionPlanIntentSchema>;

export const aiMotionPlanUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive().optional(),
    characterAction: boundedString(500).optional(),
    environmentMotion: boundedString(500).optional(),
    cameraMotion: aiCameraMotionSchema.optional(),
    intensity: aiMotionIntensitySchema.optional(),
    priority: aiMotionPrioritySchema.optional(),
  })
  .strict();
export type AiMotionPlanUpdate = z.infer<typeof aiMotionPlanUpdateSchema>;

export const aiMotionPlanDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    chapterId: idSchema,
    sceneId: z.string().trim().min(1).max(120),
    sceneRevisionId: idSchema,
    revision: z.number().int().positive(),
    intent: aiMotionPlanIntentSchema,
    motionPrompt: boundedString(2_000),
    negativePrompt: boundedString(3_000).nullable(),
    inputFingerprint: z.string().min(1).max(128),
    status: z.enum(['CURRENT', 'INVALIDATED']),
    isCurrent: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type AiMotionPlanDto = z.infer<typeof aiMotionPlanDtoSchema>;

export type VideoGenerationRequest = z.infer<typeof videoGenerationRequestSchema>;
export const videoGenerationRequestSchema = z
  .object({
    projectId: idSchema,
    sceneId: z.string().trim().min(1).max(120),
    sceneRevisionId: idSchema,
    providerJobId: idSchema,
    sourceImageAssetId: idSchema,
    sourceImageSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    sourceImagePath: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine((value) => !value.includes('\\') && !value.startsWith('/'), {
        message: 'Source image path must be a workspace-relative POSIX path',
      }),
    motionPrompt: boundedString(2_000),
    negativePrompt: boundedString(3_000).nullable(),
    width: videoDimensionSchema,
    height: videoDimensionSchema,
    frameCount: videoFrameCountSchema,
    fps: videoOutputFpsSchema,
    seed: safeSeed,
    providerSettings: videoProviderSettingsBaseSchema,
  })
  .strict();

export type VideoGenerationResult = z.infer<typeof videoGenerationResultSchema>;
export const videoGenerationResultSchema = z
  .object({
    provider: videoProviderSchema,
    providerJobId: idSchema,
    seed: safeSeed,
    width: videoDimensionSchema,
    height: videoDimensionSchema,
    fps: videoOutputFpsSchema,
    frameCount: videoFrameCountSchema,
    durationMs: z.number().int().nonnegative(),
    clipDurationMs: z.number().int().positive(),
    videos: z
      .array(
        z
          .object({
            mediaType: z.enum(['video/mp4', 'video/webm']),
            stagingPath: z.string().min(1).max(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    metadata: z.record(z.unknown()).default({}),
    warnings: z.array(boundedString(500)).max(20).default([]),
  })
  .strict();

export const videoReadinessSchema = z
  .object({
    provider: videoProviderSchema,
    status: videoReadinessStatusSchema,
    message: boundedString(1_000),
    checkedAt: z.string(),
    supportsCancellation: z.boolean().default(false),
    details: z.record(z.unknown()).default({}),
  })
  .strict();
export type VideoReadiness = z.infer<typeof videoReadinessSchema>;

const uniqueVideoIssues = z
  .array(videoGenerationIssueSchema)
  .max(12)
  .refine((issues) => new Set(issues).size === issues.length, {
    message: 'Issue tags must be unique',
  });

export const sceneVideoReviewUpdateSchema = z
  .object({
    status: sceneVideoReviewStatusSchema.exclude(['ACCEPTED']),
    issues: uniqueVideoIssues.default([]),
    notes: boundedString(1_000).default(''),
  })
  .strict();
export type SceneVideoReviewUpdate = z.infer<typeof sceneVideoReviewUpdateSchema>;

export const sceneVideoRegenerationSchema = z
  .object({
    mode: z.enum(['SAME_SEED', 'NEW_SEED']),
    instructions: boundedString(2_000).default(''),
    useReviewFeedback: z.boolean().default(false),
  })
  .strict();
export type SceneVideoRegeneration = z.infer<typeof sceneVideoRegenerationSchema>;

export const sceneVideoGenerationDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    sceneId: z.string().trim().min(1).max(120),
    sceneRevisionId: idSchema,
    revision: z.number().int().positive(),
    provider: videoProviderSchema.nullable(),
    status: sceneVideoGenerationStatusSchema,
    reviewStatus: sceneVideoReviewStatusSchema,
    reviewIssues: z.array(videoGenerationIssueSchema).default([]),
    reviewNotes: boundedString(1_000).default(''),
    freshness: z.enum(['CURRENT', 'STALE']),
    isCurrent: z.boolean(),
    requestedSeed: safeSeed.nullable(),
    actualSeed: safeSeed.nullable(),
    requestedWidth: videoDimensionSchema.nullable(),
    requestedHeight: videoDimensionSchema.nullable(),
    // Actual dimensions come from ffprobe of the raw output; keep them
    // permissive (validated again at normalization).
    actualWidth: z.number().int().min(16).max(16_384).nullable(),
    actualHeight: z.number().int().min(16).max(16_384).nullable(),
    frameCount: videoFrameCountSchema.nullable(),
    fps: videoOutputFpsSchema.nullable(),
    providerJobId: idSchema.nullable(),
    workflowTemplate: videoWorkflowTemplateSchema.nullable(),
    inputFingerprint: z.string().min(1).max(128),
    sourceImageAssetId: idSchema.nullable(),
    sourceImageSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    attempt: z.number().int().nonnegative(),
    assetId: idSchema.nullable(),
    assetUrl: z.string().max(1_000).nullable(),
    clipDurationMs: z.number().int().positive().nullable(),
    generationDurationMs: z.number().int().nonnegative().nullable(),
    errorCode: videoGenerationErrorCodeSchema.nullable(),
    error: boundedString(2_000).nullable(),
    generationInstructions: boundedString(2_000).nullable(),
    metadata: z.record(z.unknown()),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict();
export type SceneVideoGenerationDto = z.infer<typeof sceneVideoGenerationDtoSchema>;

export const aiVideoBatchSchema = z
  .object({
    sceneIds: z.array(idSchema).min(1).max(200),
    onlyMissing: z.boolean().default(true),
  })
  .strict()
  .refine((value) => new Set(value.sceneIds).size === value.sceneIds.length, {
    message: 'Scene IDs must be unique',
  });
export type AiVideoBatch = z.infer<typeof aiVideoBatchSchema>;

export type VideoProviderFailure = {
  code: VideoGenerationErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: string;
};
