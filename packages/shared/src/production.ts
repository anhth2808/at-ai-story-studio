import { z } from 'zod';

const idSchema = z.string().uuid();
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const nullableSafeText = (max: number) => z.string().trim().max(max).nullable();

export const productionProfileKeySchema = z.enum(['MANUAL_REVIEW', 'BALANCED', 'AUTO']);
export type ProductionProfileKey = z.infer<typeof productionProfileKeySchema>;

export const productionAiPolicySchema = z.enum([
  'OFF',
  'SELECTED_ONLY',
  'HIGH_PRIORITY_ONLY',
  'ALL_ELIGIBLE',
]);
export type ProductionAiPolicy = z.infer<typeof productionAiPolicySchema>;

export const productionPriorityThresholdSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type ProductionPriorityThreshold = z.infer<typeof productionPriorityThresholdSchema>;

export const productionSubtitlePolicySchema = z.enum(['REQUIRE_CURRENT', 'WARN_IF_MISSING']);
export type ProductionSubtitlePolicy = z.infer<typeof productionSubtitlePolicySchema>;

export const productionScopeSchema = z
  .union([
    z.object({ type: z.literal('FULL_PROJECT') }).strict(),
    z
      .object({
        type: z.literal('CHAPTER_RANGE'),
        startChapter: z.number().int().positive(),
        endChapter: z.number().int().positive(),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.type === 'CHAPTER_RANGE' && value.startChapter > value.endChapter) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endChapter'],
        message: 'Chapter range must be ascending',
      });
    }
  });
export type ProductionScope = z.infer<typeof productionScopeSchema>;

export const productionRunStatusSchema = z.enum([
  'DRAFT',
  'READY',
  'RUNNING',
  'WAITING_FOR_USER',
  'PAUSED',
  'FAILED',
  'CANCELLED',
  'COMPLETED',
]);
export type ProductionRunStatus = z.infer<typeof productionRunStatusSchema>;

export const productionStageKeySchema = z.enum([
  'STORY',
  'CHAPTERS',
  'AUDIO',
  'SCENES',
  'VISUAL_PROFILES',
  'VISUAL_PROMPTS',
  'SCENE_IMAGES',
  'AI_MOTION',
  'TIMELINE',
  'RENDER',
  'PUBLICATION_PACKAGE',
]);
export type ProductionStageKey = z.infer<typeof productionStageKeySchema>;

export const productionStageStatusSchema = z.enum([
  'PENDING',
  'READY',
  'RUNNING',
  'WAITING',
  'COMPLETED',
  'SKIPPED',
  'FAILED',
  'STALE',
]);
export type ProductionStageStatus = z.infer<typeof productionStageStatusSchema>;

export const productionPlanClassificationSchema = z.enum(['REUSE', 'BUILD', 'REVIEW', 'BLOCKED']);
export type ProductionPlanClassification = z.infer<typeof productionPlanClassificationSchema>;

export const productionPreflightStatusSchema = z.enum(['READY', 'READY_WITH_WARNINGS', 'BLOCKED']);
export type ProductionPreflightStatus = z.infer<typeof productionPreflightStatusSchema>;

export const productionIssueSeveritySchema = z.enum(['INFO', 'WARNING', 'BLOCKING']);
export type ProductionIssueSeverity = z.infer<typeof productionIssueSeveritySchema>;

export const productionInterventionTypeSchema = z.enum([
  'IMAGE_REVIEW_REQUIRED',
  'STORY_APPROVAL_REQUIRED',
  'REFERENCE_REQUIRED',
  'CONTINUITY_STALE',
  'PROVIDER_CONFIGURATION_REQUIRED',
  'RENDER_ASSET_MISSING',
  'QUALITY_REVIEW_REQUIRED',
]);
export type ProductionInterventionType = z.infer<typeof productionInterventionTypeSchema>;

export const productionInterventionStatusSchema = z.enum(['OPEN', 'RESOLVED', 'DISMISSED']);
export type ProductionInterventionStatus = z.infer<typeof productionInterventionStatusSchema>;

export const productionErrorCategorySchema = z.enum([
  'INFRASTRUCTURE',
  'PROVIDER',
  'STRUCTURED_OUTPUT',
  'CONTEXT',
  'CONTINUITY',
  'CANCELLED',
  'BUDGET',
  'PRODUCTION',
  'PACKAGE',
]);
export type ProductionErrorCategory = z.infer<typeof productionErrorCategorySchema>;

export const productionSafeErrorSchema = z
  .object({
    code: nonEmpty(120),
    message: nonEmpty(500),
    retryable: z.boolean(),
    category: productionErrorCategorySchema.optional(),
    diagnostics: z.string().max(2000).optional(),
  })
  .strict();
export type ProductionSafeError = z.infer<typeof productionSafeErrorSchema>;

const boundedSettingsBaseSchema = z
  .object({
    requireStoryApproval: z.boolean(),
    requireImageApproval: z.boolean(),
    requireReferenceApproval: z.boolean(),
    requireContinuityReview: z.boolean(),
    requireQualityReview: z.boolean(),
    chapterBatchSize: z.number().int().min(1).max(25),
    imageBatchSize: z.number().int().min(1).max(64),
    imageCandidateCount: z.number().int().min(1).max(8),
    imageRegenerationLimit: z.number().int().min(0).max(10),
    aiMotionPolicy: productionAiPolicySchema,
    aiPriorityThreshold: productionPriorityThresholdSchema,
    maxAiVideoScenes: z.number().int().min(0).max(10_000),
    allowKenBurnsFallback: z.boolean(),
    renderQualityPreset: z.enum(['FAST_PREVIEW', 'STANDARD', 'HIGH']),
    subtitlePolicy: productionSubtitlePolicySchema,
    musicEnabled: z.boolean(),
    musicVolume: z.number().finite().min(0).max(1),
    automaticTechnicalRetry: z.boolean(),
    maxStageAttempts: z.number().int().min(1).max(10),
    minimumFreeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maxEstimatedGpuSeconds: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    maxGeneratedImages: z.number().int().min(0).max(100_000),
    maxEstimatedCost: z.number().finite().min(0).nullable(),
    costCurrency: z.string().trim().max(12).nullable(),
    requireThumbnail: z.boolean(),
    requireMetadata: z.boolean(),
    generateMetadataDraft: z.boolean(),
  })
  .strict();

export const productionProfileSettingsSchema = boundedSettingsBaseSchema;
export type ProductionProfileSettings = z.infer<typeof productionProfileSettingsSchema>;
export type ProductionProfileSettingsInput = z.input<typeof productionProfileSettingsSchema>;

export const defaultProductionProfileSettings: ProductionProfileSettings = {
  requireStoryApproval: false,
  requireImageApproval: true,
  requireReferenceApproval: true,
  requireContinuityReview: true,
  requireQualityReview: true,
  chapterBatchSize: 5,
  imageBatchSize: 8,
  imageCandidateCount: 1,
  imageRegenerationLimit: 2,
  aiMotionPolicy: 'HIGH_PRIORITY_ONLY',
  aiPriorityThreshold: 'HIGH',
  maxAiVideoScenes: 12,
  allowKenBurnsFallback: true,
  renderQualityPreset: 'STANDARD',
  subtitlePolicy: 'REQUIRE_CURRENT',
  musicEnabled: true,
  musicVolume: 0.12,
  automaticTechnicalRetry: true,
  maxStageAttempts: 3,
  minimumFreeBytes: 2_000_000_000,
  maxEstimatedGpuSeconds: null,
  maxGeneratedImages: 10_000,
  maxEstimatedCost: null,
  costCurrency: null,
  requireThumbnail: false,
  requireMetadata: true,
  generateMetadataDraft: false,
};

export const productionProfileCreateSchema = z
  .object({
    key: productionProfileKeySchema,
    settings: boundedSettingsBaseSchema.partial().default({}),
  })
  .strict();
export type ProductionProfileCreate = z.infer<typeof productionProfileCreateSchema>;

export const productionProfileUpdateSchema = z
  .object({
    settings: boundedSettingsBaseSchema.partial(),
    expectedRowVersion: z.number().int().positive(),
  })
  .strict();
export type ProductionProfileUpdate = z.infer<typeof productionProfileUpdateSchema>;

export const productionProfileDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    key: productionProfileKeySchema,
    revision: z.number().int().positive(),
    rowVersion: z.number().int().positive(),
    settings: boundedSettingsBaseSchema,
    createdAt: nonEmpty(64),
    updatedAt: nonEmpty(64),
  })
  .strict();
export type ProductionProfileDto = z.infer<typeof productionProfileDtoSchema>;

export const productionRunCreateSchema = z
  .object({
    profileId: idSchema.optional(),
    scope: productionScopeSchema,
  })
  .strict();
export type ProductionRunCreate = z.infer<typeof productionRunCreateSchema>;

export const productionRunCommandSchema = z
  .object({ expectedRowVersion: z.number().int().positive().optional() })
  .strict();
export type ProductionRunCommand = z.infer<typeof productionRunCommandSchema>;

export const productionRunDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    workflowExecutionId: idSchema,
    profileId: idSchema,
    profileRevision: z.number().int().positive(),
    scope: productionScopeSchema,
    fingerprint: nonEmpty(128),
    status: productionRunStatusSchema,
    currentStage: productionStageKeySchema.nullable(),
    rowVersion: z.number().int().positive(),
    progress: z
      .object({ current: z.number().int().min(0), total: z.number().int().min(0) })
      .strict(),
    metrics: z.record(z.string(), z.unknown()),
    error: productionSafeErrorSchema.nullable(),
    createdAt: nonEmpty(64),
    startedAt: nullableSafeText(64),
    pausedAt: nullableSafeText(64),
    completedAt: nullableSafeText(64),
    cancellationRequestedAt: nullableSafeText(64),
    updatedAt: nonEmpty(64),
  })
  .strict();
export type ProductionRunDto = z.infer<typeof productionRunDtoSchema>;

export const productionStageProgressSchema = z
  .object({ current: z.number().int().min(0), total: z.number().int().min(0) })
  .strict();
export type ProductionStageProgress = z.infer<typeof productionStageProgressSchema>;

export const productionStageDtoSchema = z
  .object({
    id: idSchema,
    runId: idSchema,
    key: productionStageKeySchema,
    ordinal: z.number().int().min(0),
    status: productionStageStatusSchema,
    attempt: z.number().int().min(0),
    fingerprint: nonEmpty(128),
    progress: productionStageProgressSchema,
    reusableCount: z.number().int().min(0),
    generatedCount: z.number().int().min(0),
    reviewCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0),
    summary: z.record(z.string(), z.unknown()),
    warnings: z.array(nonEmpty(500)).max(100),
    fallbacks: z.array(nonEmpty(500)).max(100),
    blockers: z.array(nonEmpty(500)).max(100),
    error: productionSafeErrorSchema.nullable(),
    createdAt: nonEmpty(64),
    startedAt: nullableSafeText(64),
    completedAt: nullableSafeText(64),
    updatedAt: nonEmpty(64),
  })
  .strict();
export type ProductionStageDto = z.infer<typeof productionStageDtoSchema>;

export const productionPreflightIssueSchema = z
  .object({
    code: nonEmpty(120),
    severity: productionIssueSeveritySchema,
    stage: productionStageKeySchema.nullable(),
    message: nonEmpty(500),
    action: nonEmpty(500),
  })
  .strict();
export type ProductionPreflightIssue = z.infer<typeof productionPreflightIssueSchema>;

export const productionPreflightResultSchema = z
  .object({
    status: productionPreflightStatusSchema,
    projectId: idSchema,
    scope: productionScopeSchema,
    issues: z.array(productionPreflightIssueSchema).max(200),
    checkedAt: nonEmpty(64),
  })
  .strict();
export type ProductionPreflightResult = z.infer<typeof productionPreflightResultSchema>;

export const productionPlanUnitSchema = z
  .object({
    key: nonEmpty(200),
    stage: productionStageKeySchema,
    classification: productionPlanClassificationSchema,
    entityId: idSchema.optional(),
    message: nonEmpty(500),
    dependencies: z.array(nonEmpty(200)).max(20),
  })
  .strict();
export type ProductionPlanUnit = z.infer<typeof productionPlanUnitSchema>;

export const productionPlanStageSchema = z
  .object({
    key: productionStageKeySchema,
    ordinal: z.number().int().min(0),
    classification: productionPlanClassificationSchema,
    progress: productionStageProgressSchema,
    reusableCount: z.number().int().min(0),
    buildCount: z.number().int().min(0),
    reviewCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0),
    units: z.array(productionPlanUnitSchema).max(100),
    warnings: z.array(nonEmpty(500)).max(100),
    blockers: z.array(nonEmpty(500)).max(100),
    estimate: z
      .object({
        durationMs: z.number().int().min(0).nullable(),
        cost: z.number().finite().min(0).nullable(),
        currency: z.string().trim().max(12).nullable(),
        source: z.enum(['HISTORICAL_MEDIAN', 'HISTORICAL_AVERAGE', 'UNKNOWN']),
      })
      .strict(),
  })
  .strict();
export type ProductionPlanStage = z.infer<typeof productionPlanStageSchema>;

export const productionPlanRequestSchema = z
  .object({
    profileId: idSchema.optional(),
    scope: productionScopeSchema,
  })
  .strict();
export type ProductionPlanRequest = z.infer<typeof productionPlanRequestSchema>;

export const productionPlanResultSchema = z
  .object({
    projectId: idSchema,
    scope: productionScopeSchema,
    profileId: idSchema.nullable(),
    profileRevision: z.number().int().nonnegative(),
    fingerprint: nonEmpty(128),
    stages: z.array(productionPlanStageSchema).length(11),
    warnings: z.array(nonEmpty(500)).max(200),
    blockers: z.array(nonEmpty(500)).max(200),
    estimate: z
      .object({
        durationMs: z.number().int().min(0).nullable(),
        cost: z.number().finite().min(0).nullable(),
        currency: z.string().trim().max(12).nullable(),
        source: z.enum(['HISTORICAL_MEDIAN', 'HISTORICAL_AVERAGE', 'UNKNOWN']),
      })
      .strict(),
    createdAt: nonEmpty(64),
  })
  .strict();
export type ProductionPlanResult = z.infer<typeof productionPlanResultSchema>;

export const productionInterventionSchema = z
  .object({
    id: idSchema,
    runId: idSchema,
    stageId: idSchema.nullable(),
    type: productionInterventionTypeSchema,
    severity: productionIssueSeveritySchema,
    status: productionInterventionStatusSchema,
    affectedEntityType: nonEmpty(80).nullable(),
    affectedEntityId: idSchema.nullable(),
    message: nonEmpty(500),
    actions: z.array(nonEmpty(500)).max(20),
    dedupeKey: nonEmpty(300),
    resolution: z.record(z.string(), z.unknown()).nullable(),
    createdAt: nonEmpty(64),
    resolvedAt: nullableSafeText(64),
    updatedAt: nonEmpty(64),
  })
  .strict();
export type ProductionInterventionDto = z.infer<typeof productionInterventionSchema>;

export const productionInterventionResolutionSchema = z
  .object({
    expectedRowVersion: z.number().int().positive().optional(),
    resolution: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type ProductionInterventionResolution = z.infer<
  typeof productionInterventionResolutionSchema
>;

export const productionStageRetrySchema = z
  .object({
    expectedRowVersion: z.number().int().positive().optional(),
    unitKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type ProductionStageRetry = z.infer<typeof productionStageRetrySchema>;

export const productionAdvancePayloadSchema = z
  .object({
    runId: idSchema,
    reason: nonEmpty(120),
  })
  .strict();
export type ProductionAdvancePayload = z.infer<typeof productionAdvancePayloadSchema>;
