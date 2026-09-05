import { z } from 'zod';
import {
  automaticQualityStatusSchema,
  criticEvidenceSchema,
  criticIdentitySchema,
} from './quality.js';
import { referenceBindingsSchema } from './visual.js';

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

export const imageQualityScoreCategorySchema = z.enum([
  'IDENTITY',
  'FACE_CONSISTENCY',
  'HAIR',
  'CLOTHING_STAGE',
  'VISIBLE_CHARACTER_COUNT',
  'PROMPT_ADHERENCE',
  'COMPOSITION',
  'POSE_ACTION',
  'CAMERA_FRAMING',
  'LOCATION',
  'IMPORTANT_OBJECTS',
  'ANATOMY',
  'HANDS',
  'STYLE',
  'ARTIFACTS',
  'OVERALL',
]);
export type ImageQualityScoreCategory = z.infer<typeof imageQualityScoreCategorySchema>;

export const imageQualityIssueSchema = z.enum([
  'WRONG_FACE',
  'WRONG_HAIR',
  'WRONG_CLOTHING',
  'STAGE_MISMATCH',
  'MISSING_CHARACTER',
  'EXTRA_CHARACTER',
  'WRONG_POSE',
  'WRONG_COMPOSITION',
  'WRONG_CAMERA',
  'WRONG_LOCATION',
  'MISSING_OBJECT',
  'EXTRA_OBJECT',
  'DUPLICATE_OBJECT',
  'BAD_HANDS',
  'ANATOMY_DEFECT',
  'BAD_TEXT',
  'STYLE_DRIFT',
  'REFERENCE_POSE_BLEED',
  'OTHER',
]);
export type ImageQualityIssue = z.infer<typeof imageQualityIssueSchema>;

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
  'REFERENCE_REQUIRED',
  'REFERENCE_STALE',
  'REFERENCE_BINDING_INVALID',
  'QUALITY_REJECTED',
  'CRITIC_UNAVAILABLE',
]);
export type ImageGenerationErrorCode = z.infer<typeof imageGenerationErrorCodeSchema>;

const safeSeed = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const sceneImageSourceSchema = z.enum(['GENERATED', 'MANUAL']);
export type SceneImageSource = z.infer<typeof sceneImageSourceSchema>;

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
    requireImageApproval: z.boolean().default(false),
  })
  .strict();

export const imageQualityScoreSchema = z.record(
  imageQualityScoreCategorySchema,
  z.number().int().min(1).max(5),
);
export type ImageQualityScores = z.infer<typeof imageQualityScoreSchema>;

const uniqueIssues = z
  .array(imageQualityIssueSchema)
  .max(15)
  .refine((issues) => new Set(issues).size === issues.length, {
    message: 'Issue tags must be unique',
  });

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

export const imageReviewFeedbackSchema = z
  .object({
    version: z.literal('image-review-feedback-v1'),
    sourceGenerationId: idSchema,
    sourceReview: z.object({
      status: sceneImageReviewStatusSchema,
      scores: imageQualityScoreSchema,
      issues: uniqueIssues,
      notes: boundedString(1_000),
    }),
    guidance: boundedString(2_000),
  })
  .strict();
export type ImageReviewFeedback = z.infer<typeof imageReviewFeedbackSchema>;

export const imageQualityReviewSchema = z
  .object({
    status: sceneImageReviewStatusSchema,
    scores: imageQualityScoreSchema,
    issues: uniqueIssues,
    notes: boundedString(1_000).default(''),
  })
  .strict();
export type ImageQualityReview = z.infer<typeof imageQualityReviewSchema>;

export const imageCriticResultSchema = z
  .object({
    status: automaticQualityStatusSchema,
    scores: imageQualityScoreSchema,
    issues: uniqueIssues,
    hardFailure: z.boolean(),
    confidence: z.number().min(0).max(1),
    explanation: boundedString(2_000),
    guidance: boundedString(2_000),
  })
  .strict();
export type ImageCriticResult = z.infer<typeof imageCriticResultSchema>;

export const imageCriticEvaluationSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    generationId: idSchema,
    candidateSetId: idSchema.nullable(),
    shotId: z.string().trim().min(1).max(120).nullable(),
    sceneRevisionId: idSchema,
    assetId: idSchema,
    assetSha256: referenceSha256Schema,
    packageFingerprint: z.string().trim().min(1).max(128),
    referenceFingerprint: z.string().trim().min(1).max(128),
    inputFingerprint: z.string().trim().min(1).max(128),
    status: automaticQualityStatusSchema,
    critic: criticIdentitySchema,
    evidence: z.array(criticEvidenceSchema).min(1).max(20),
    scores: imageQualityScoreSchema,
    issues: uniqueIssues,
    hardFailure: z.boolean(),
    confidence: z.number().min(0).max(1),
    explanation: boundedString(2_000),
    guidance: boundedString(2_000),
    attempt: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
export type ImageCriticEvaluation = z.infer<typeof imageCriticEvaluationSchema>;

export const imageCandidateRankingEntrySchema = z
  .object({
    generationId: idSchema,
    candidateIndex: z.number().int().positive(),
    score: z.number().finite().min(0).max(5),
    severeIssueCount: z.number().int().nonnegative(),
    excluded: z.boolean(),
    reason: boundedString(500),
  })
  .strict();

export const imageCandidateRankingSchema = z
  .object({
    version: z.string().trim().min(1).max(80),
    entries: z.array(imageCandidateRankingEntrySchema).min(1).max(4),
    winnerGenerationId: idSchema.nullable(),
    reason: boundedString(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.entries.map((entry) => entry.generationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entries'],
        message: 'Ranked candidate IDs must be unique',
      });
    }
    if (
      value.winnerGenerationId !== null &&
      !value.entries.some(
        (entry) => entry.generationId === value.winnerGenerationId && !entry.excluded,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['winnerGenerationId'],
        message: 'Ranking winner must be an eligible entry',
      });
    }
  });
export type ImageCandidateRanking = z.infer<typeof imageCandidateRankingSchema>;

export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;

export const imageGenerationRequestSchema = z
  .object({
    projectId: idSchema,
    sceneId: idSchema,
    visualPromptPackageId: idSchema,
    shotId: z.string().trim().min(1).max(120).nullable().optional(),
    shotRevision: z.number().int().positive().nullable().optional(),
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
    referenceBindings: referenceBindingsSchema.optional(),
    conditioning: imageConditioningSchema.default(textOnlyConditioning),
    generationInstructions: boundedString(2_000).default(''),
    reviewFeedback: imageReviewFeedbackSchema.nullable().default(null),
  })
  .strict();

export const sceneImageGenerationScheduleSchema = z
  .object({
    instructions: boundedString(2_000).default(''),
    conditioningMode: imageConditioningModeSchema.optional(),
    candidateCount: z.number().int().min(1).max(4).default(1),
  })
  .strict();
export type SceneImageGenerationSchedule = z.infer<typeof sceneImageGenerationScheduleSchema>;

export const sceneImageRegenerationSchema = z
  .object({
    mode: z.enum(['SAME_SEED', 'NEW_SEED']),
    instructions: boundedString(2_000).default(''),
    conditioningMode: imageConditioningModeSchema.optional(),
    useReviewFeedback: z.boolean().default(false),
  })
  .strict();
export type SceneImageRegeneration = z.infer<typeof sceneImageRegenerationSchema>;

export const imageAdvancedControlStatusSchema = z.enum(['NOT_ADOPTED', 'READY', 'UNAVAILABLE']);
export type ImageAdvancedControlStatus = z.infer<typeof imageAdvancedControlStatusSchema>;

export const imageAdvancedControlDiagnosticSchema = z
  .object({
    status: imageAdvancedControlStatusSchema,
    technique: z.string().nullable(),
    reasonCode: z.string().min(1).max(120).nullable(),
    message: boundedString(500),
  })
  .strict();
export type ImageAdvancedControlDiagnostic = z.infer<typeof imageAdvancedControlDiagnosticSchema>;

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

export const imageQualityReviewUpdateSchema = z
  .object({
    status: sceneImageReviewStatusSchema.exclude(['ACCEPTED']),
    scores: imageQualityScoreSchema.optional(),
    issues: uniqueIssues.default([]),
    notes: boundedString(1_000).default(''),
  })
  .strict();
export type ImageQualityReviewUpdate = z.infer<typeof imageQualityReviewUpdateSchema>;

export const sceneImageReviewUpdateSchema = imageQualityReviewUpdateSchema;

export const sceneImageReferencePromotionSchema = z
  .object({
    characterId: z.string().trim().min(1).max(120),
    expectedRevision: z.number().int().positive(),
    primary: z.boolean().default(false),
  })
  .strict();

export const referenceApprovalSchema = z.enum(['CANDIDATE', 'APPROVED', 'REJECTED']);
export type ReferenceApproval = z.infer<typeof referenceApprovalSchema>;

export const referenceApprovalUpdateSchema = z
  .object({ approval: referenceApprovalSchema })
  .strict();
export type ReferenceApprovalUpdate = z.infer<typeof referenceApprovalUpdateSchema>;

export const sceneImageManualUploadSchema = z
  .object({ notes: boundedString(1_000).default('') })
  .strict();

export const imageGenerationBatchSchema = z
  .object({
    sceneIds: z.array(idSchema).min(1).max(200),
    onlyMissing: z.boolean().default(true),
    includeStale: z.boolean().default(false),
    candidateCount: z.number().int().min(1).max(4).default(1),
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
    candidateCount: z.number().int().min(1).max(4).default(1),
  })
  .strict();
export type ImageGenerationChapterBatch = z.infer<typeof imageGenerationChapterBatchSchema>;

export const sceneImageCurrentSelectionSchema = z
  .object({
    expectedSceneRevision: z.number().int().positive().optional(),
  })
  .strict();
export type SceneImageCurrentSelection = z.infer<typeof sceneImageCurrentSelectionSchema>;

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
    review: imageQualityReviewSchema.nullable(),
    candidateSetId: idSchema.nullable(),
    candidateIndex: z.number().int().positive().nullable(),
    productionReady: z.boolean().default(false),
    productionBlockers: z.array(boundedString(200)).max(5).default([]),
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

export const sceneImageCandidateSetDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    sceneId: z.string().trim().min(1).max(120),
    sceneRevisionId: idSchema,
    visualPromptPackageId: idSchema.nullable(),
    mode: imageConditioningModeSchema,
    workflowTemplate: imageWorkflowTemplateSchema.nullable(),
    packageFingerprint: z.string().min(1).max(128).nullable(),
    settingsFingerprint: z.string().min(1).max(128).nullable(),
    requestedCount: z.number().int().min(1).max(4),
    sourceGenerationId: idSchema.nullable(),
    generationInstructions: boundedString(2_000).nullable(),
    metadata: z.record(z.unknown()),
    ranking: imageCandidateRankingSchema.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type SceneImageCandidateSetDto = z.infer<typeof sceneImageCandidateSetDtoSchema>;

export type SceneImageGenerationListItem = SceneImageGenerationDto;

export type ImageProviderFailure = {
  code: ImageGenerationErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: string;
};
