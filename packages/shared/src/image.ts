import { z } from 'zod';

const idSchema = z.string().uuid();
const boundedString = (max: number) => z.string().max(max);

export const imageProviderSchema = z.enum(['COMFYUI']);
export type ImageProvider = z.infer<typeof imageProviderSchema>;

export const imageWorkflowTemplateSchema = z.enum(['text-to-image-v1', 'reference-character-v1']);
export type ImageWorkflowTemplate = z.infer<typeof imageWorkflowTemplateSchema>;

export const imageConditioningModeSchema = z.enum(['TEXT_ONLY', 'REFERENCE_CONDITIONED']);
export type ImageConditioningMode = z.infer<typeof imageConditioningModeSchema>;

export const imageConditioningReadinessSchema = z.enum([
  'CONDITIONING_READY',
  'REFERENCE_NODE_MISSING',
  'MODEL_MISSING',
  'INCOMPATIBLE_WORKFLOW',
]);
export type ImageConditioningReadiness = z.infer<typeof imageConditioningReadinessSchema>;

export const imageSeedModeSchema = z.enum(['RANDOM', 'FIXED']);
export type ImageSeedMode = z.infer<typeof imageSeedModeSchema>;

export const imageReadinessStatusSchema = z.enum([
  'NOT_CONFIGURED',
  'UNREACHABLE',
  'READY',
  'INVALID_WORKFLOW',
  'INCOMPATIBLE_API',
  'ERROR',
]);
export type ImageReadinessStatus = z.infer<typeof imageReadinessStatusSchema>;

export const sceneImageGenerationStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type SceneImageGenerationStatus = z.infer<typeof sceneImageGenerationStatusSchema>;

export const sceneImageFreshnessSchema = z.enum(['CURRENT', 'STALE']);
export type SceneImageFreshness = z.infer<typeof sceneImageFreshnessSchema>;

export const sceneImageReviewStatusSchema = z.enum(['UNREVIEWED', 'ACCEPTED', 'REJECTED']);
export type SceneImageReviewStatus = z.infer<typeof sceneImageReviewStatusSchema>;

export const sceneImageSourceSchema = z.enum(['GENERATED', 'MANUAL']);
export type SceneImageSource = z.infer<typeof sceneImageSourceSchema>;

export const imageGenerationErrorCodeSchema = z.enum([
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
  'REFERENCE_UPLOAD_FAILED',
]);
export type ImageGenerationErrorCode = z.infer<typeof imageGenerationErrorCodeSchema>;

const safeSeed = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const imageDimensions = z.number().int().min(16).max(16_384);

const imageBaseUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Image provider base URL must use HTTP or HTTPS',
  });

const imageProviderSettingsBaseSchema = z
  .object({
    provider: imageProviderSchema.default('COMFYUI'),
    baseUrl: imageBaseUrlSchema.default('http://127.0.0.1:8188'),
    workflowTemplate: imageWorkflowTemplateSchema.default('text-to-image-v1'),
    diffusionModel: z.string().trim().max(300).default(''),
    textEncoder: z.string().trim().max(300).default(''),
    vaeName: z.string().trim().max(300).default(''),
    sampler: z.string().trim().min(1).max(120).default('euler'),
    connectionTimeoutMs: z.number().int().min(500).max(120_000).default(5_000),
    generationTimeoutMs: z.number().int().min(5_000).max(86_400_000).default(3_600_000),
  })
  .strict();
export const imageProviderSettingsSchema = imageProviderSettingsBaseSchema;
export type ImageProviderSettings = z.infer<typeof imageProviderSettingsSchema>;

const imageGenerationSettingsBaseSchema = imageProviderSettingsBaseSchema
  .extend({
    workflowTemplate: z.literal('text-to-image-v1').default('text-to-image-v1'),
    width: imageDimensions.default(1024),
    height: imageDimensions.default(576),
    steps: z.number().int().min(1).max(4096).default(20),
    guidance: z.number().min(0).max(100).default(5),
    seedMode: imageSeedModeSchema.default('RANDOM'),
    fixedSeed: safeSeed.nullable().default(null),
    conditioningMode: imageConditioningModeSchema.default('TEXT_ONLY'),
  })
  .strict();

const validateImageGenerationSettings = (
  value: z.infer<typeof imageGenerationSettingsBaseSchema>,
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

export const imageGenerationSettingsSchema = imageGenerationSettingsBaseSchema.superRefine(
  validateImageGenerationSettings,
);
export type ImageGenerationSettings = z.infer<typeof imageGenerationSettingsSchema>;
export type ImageGenerationSettingsInput = z.input<typeof imageGenerationSettingsSchema>;

export const imageGenerationSettingsUpdateSchema = imageGenerationSettingsBaseSchema
  .extend({ expectedRowVersion: z.number().int().positive().optional() })
  .strict()
  .superRefine(validateImageGenerationSettings);
export type ImageGenerationSettingsUpdate = z.infer<typeof imageGenerationSettingsUpdateSchema>;

export const imageGenerationSettingsDtoSchema = imageGenerationSettingsBaseSchema
  .extend({
    id: idSchema,
    projectId: idSchema,
    rowVersion: z.number().int().positive(),
    inputFingerprint: z.string().min(1).max(128),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine(validateImageGenerationSettings);
export type ImageGenerationSettingsDto = z.infer<typeof imageGenerationSettingsDtoSchema>;

const referenceSha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, 'Reference hash must be lowercase sha256');
const workspaceRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine((value) => !value.includes('\\') && !value.startsWith('/'), {
    message: 'Reference path must be a workspace-relative POSIX path',
  });

export const imageConditioningCharacterSchema = z
  .object({
    characterId: z.string().trim().min(1).max(120),
    referenceAssetId: idSchema,
    referenceSha256: referenceSha256Schema,
    referencePath: workspaceRelativePathSchema,
    profileRevision: z.number().int().positive(),
  })
  .strict();
export type ImageConditioningCharacter = z.infer<typeof imageConditioningCharacterSchema>;

export const imageConditioningSchema = z
  .object({
    mode: imageConditioningModeSchema,
    characters: z.array(imageConditioningCharacterSchema).max(4),
  })
  .strict();
export type ImageConditioning = z.infer<typeof imageConditioningSchema>;

export const textOnlyConditioning: ImageConditioning = { mode: 'TEXT_ONLY', characters: [] };

export const imageReferenceInputSchema = z.object({ assetId: idSchema }).strict();
export type ImageReferenceInput = z.infer<typeof imageReferenceInputSchema>;

export const imageGenerationRequestSchema = z
  .object({
    projectId: idSchema,
    sceneId: idSchema,
    visualPromptPackageId: idSchema,
    providerJobId: idSchema,
    prompt: boundedString(8_000),
    negativePrompt: boundedString(3_000).nullable(),
    width: imageDimensions,
    height: imageDimensions,
    seed: safeSeed,
    steps: z.number().int().min(1).max(4096),
    guidance: z.number().min(0).max(100),
    samplerHint: z.string().trim().min(1).max(120),
    referenceImages: z.array(imageReferenceInputSchema).max(12).default([]),
    providerSettings: imageProviderSettingsSchema,
    conditioning: imageConditioningSchema.default(textOnlyConditioning),
    generationInstructions: boundedString(2_000).default(''),
  })
  .strict();
export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;

export const imageProviderResultImageSchema = z
  .object({
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    stagingPath: z.string().min(1).max(1_000),
    width: imageDimensions,
    height: imageDimensions,
  })
  .strict();
export type ImageProviderResultImage = z.infer<typeof imageProviderResultImageSchema>;

export const imageProviderResultSchema = z
  .object({
    provider: imageProviderSchema,
    providerJobId: idSchema,
    seed: safeSeed,
    width: imageDimensions,
    height: imageDimensions,
    durationMs: z.number().int().nonnegative(),
    images: z.array(imageProviderResultImageSchema).min(1).max(8),
    metadata: z.record(z.unknown()).default({}),
    warnings: z.array(boundedString(500)).max(20).default([]),
  })
  .strict();
export type ImageProviderResult = z.infer<typeof imageProviderResultSchema>;

export const imageReadinessSchema = z
  .object({
    provider: imageProviderSchema,
    status: imageReadinessStatusSchema,
    message: boundedString(1_000),
    checkedAt: z.string(),
    supportsCancellation: z.boolean().default(false),
    details: z.record(z.unknown()).default({}),
  })
  .strict();
export type ImageReadiness = z.infer<typeof imageReadinessSchema>;

export const sceneImageGenerationScheduleSchema = z
  .object({
    instructions: boundedString(2_000).default(''),
    conditioningMode: imageConditioningModeSchema.optional(),
  })
  .strict();
export type SceneImageGenerationSchedule = z.infer<typeof sceneImageGenerationScheduleSchema>;

export const sceneImageRegenerationSchema = z
  .object({
    mode: z.enum(['SAME_SEED', 'NEW_SEED']),
    instructions: boundedString(2_000).default(''),
    conditioningMode: imageConditioningModeSchema.optional(),
  })
  .strict();
export type SceneImageRegeneration = z.infer<typeof sceneImageRegenerationSchema>;

export const sceneImageReviewUpdateSchema = z
  .object({
    status: sceneImageReviewStatusSchema,
    notes: boundedString(1_000).default(''),
  })
  .strict();
export type SceneImageReviewUpdate = z.infer<typeof sceneImageReviewUpdateSchema>;

export const sceneImageReferencePromotionSchema = z
  .object({
    characterId: z.string().trim().min(1).max(120),
    expectedRevision: z.number().int().positive(),
    primary: z.boolean().default(false),
  })
  .strict();
export type SceneImageReferencePromotion = z.infer<typeof sceneImageReferencePromotionSchema>;

export const referenceApprovalSchema = z.enum(['CANDIDATE', 'APPROVED', 'REJECTED']);
export type ReferenceApproval = z.infer<typeof referenceApprovalSchema>;

export const referenceApprovalUpdateSchema = z
  .object({ approval: referenceApprovalSchema })
  .strict();
export type ReferenceApprovalUpdate = z.infer<typeof referenceApprovalUpdateSchema>;

export const sceneImageManualUploadSchema = z
  .object({ notes: boundedString(1_000).default('') })
  .strict();
export type SceneImageManualUpload = z.infer<typeof sceneImageManualUploadSchema>;

export const sceneImageCurrentSelectionSchema = z
  .object({
    expectedSceneRevision: z.number().int().positive().optional(),
  })
  .strict();
export type SceneImageCurrentSelection = z.infer<typeof sceneImageCurrentSelectionSchema>;

export const imageGenerationBatchSchema = z
  .object({
    sceneIds: z.array(idSchema).min(1).max(200),
    onlyMissing: z.boolean().default(true),
    includeStale: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.sceneIds).size !== value.sceneIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sceneIds'],
        message: 'Scene IDs must be unique',
      });
  });
export type ImageGenerationBatch = z.infer<typeof imageGenerationBatchSchema>;

export const imageGenerationChapterBatchSchema = z
  .object({
    onlyMissing: z.boolean().default(true),
    includeStale: z.boolean().default(false),
  })
  .strict();
export type ImageGenerationChapterBatch = z.infer<typeof imageGenerationChapterBatchSchema>;

export const sceneImageGenerationDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    sceneId: z.string().trim().min(1).max(120),
    sceneRevisionId: idSchema,
    visualPromptPackageId: idSchema.nullable(),
    revision: z.number().int().positive(),
    source: sceneImageSourceSchema,
    provider: imageProviderSchema.nullable(),
    status: sceneImageGenerationStatusSchema,
    freshness: sceneImageFreshnessSchema,
    reviewStatus: sceneImageReviewStatusSchema,
    isCurrent: z.boolean(),
    requestedSeed: safeSeed.nullable(),
    actualSeed: safeSeed.nullable(),
    requestedWidth: imageDimensions.nullable(),
    requestedHeight: imageDimensions.nullable(),
    actualWidth: imageDimensions.nullable(),
    actualHeight: imageDimensions.nullable(),
    providerJobId: idSchema.nullable(),
    workflowTemplate: imageWorkflowTemplateSchema.nullable(),
    inputFingerprint: z.string().min(1).max(128),
    attempt: z.number().int().nonnegative(),
    assetId: idSchema.nullable(),
    assetUrl: z.string().max(1_000).nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    errorCode: imageGenerationErrorCodeSchema.nullable(),
    error: boundedString(2_000).nullable(),
    notes: boundedString(1_000),
    generationInstructions: boundedString(2_000).nullable(),
    metadata: z.record(z.unknown()),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict();
export type SceneImageGenerationDto = z.infer<typeof sceneImageGenerationDtoSchema>;

export type SceneImageGenerationListItem = SceneImageGenerationDto;

export type ImageProviderFailure = {
  code: ImageGenerationErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: string;
};
