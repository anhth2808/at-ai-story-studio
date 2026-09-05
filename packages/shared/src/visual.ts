import { z } from 'zod';
import {
  sceneCameraSchema,
  sceneCharacterVisualStateSchema,
  sceneCompositionSchema,
  storyStableIdSchema,
  visualStyleSettingsSchema,
  visualStyleUpdateSchema,
  type SceneCamera,
  type SceneCharacterVisualState,
  type SceneComposition,
  type VisualStyleSettings,
  type VisualStyleSettingsDto,
} from './story.js';
import {
  shotDynamicIntentSchema,
  shotPhysicalStateSchema,
  shotStaticIntentSchema,
} from './shot.js';

const idSchema = z.string().trim().min(1).max(120);
export const visualObjectKeySchema = z.string().trim().min(1).max(120);
const boundedString = (max: number) => z.string().max(max);
const boundedStringArray = (maxItems: number, maxLength: number) =>
  z.array(boundedString(maxLength)).max(maxItems);

export const visualProfileStatusSchema = z.enum(['DRAFT', 'APPROVED', 'STALE']);
export type VisualProfileStatus = z.infer<typeof visualProfileStatusSchema>;

export const visualPromptPackageStatusSchema = z.enum(['CURRENT', 'STALE', 'FAILED']);
export type VisualPromptPackageStatus = z.infer<typeof visualPromptPackageStatusSchema>;

export const visualConsistencyStatusSchema = z.enum(['PASS', 'WARN', 'FAIL']);
export type VisualConsistencyStatus = z.infer<typeof visualConsistencyStatusSchema>;

export const visualConsistencyIssueTypeSchema = z.enum([
  'MISSING_PROFILE',
  'CHARACTER_APPEARANCE_CONFLICT',
  'LOCATION_CONFLICT',
  'OBJECT_CONFLICT',
  'STYLE_CONFLICT',
  'UNRESOLVED_REFERENCE',
  'STALE_DEPENDENCY',
]);
export type VisualConsistencyIssueType = z.infer<typeof visualConsistencyIssueTypeSchema>;

export const visualConsistencyIssueSchema = z
  .object({
    type: visualConsistencyIssueTypeSchema,
    message: boundedString(1_000),
    reference: boundedString(240).default(''),
    severity: z.enum(['WARN', 'FAIL']).default('WARN'),
  })
  .strict();
export type VisualConsistencyIssue = z.infer<typeof visualConsistencyIssueSchema>;

export const visualReferenceAssetIdsSchema = z.array(idSchema).max(12).default([]);

export const visualReferenceRoleSchema = z.enum([
  'PRIMARY_CHARACTER',
  'CHARACTER',
  'LOCATION',
  'OBJECT',
]);
export type VisualReferenceRole = z.infer<typeof visualReferenceRoleSchema>;

export const referenceBindingSchema = z
  .object({
    ordinal: z.number().int().positive().max(12),
    role: visualReferenceRoleSchema,
    assetId: idSchema,
    entityId: idSchema,
    stageId: idSchema.nullable().default(null),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    revision: z.number().int().positive(),
    fingerprint: z.string().trim().min(1).max(128),
  })
  .strict();
export type ReferenceBinding = z.infer<typeof referenceBindingSchema>;

export const referenceBindingsSchema = z
  .array(referenceBindingSchema)
  .max(12)
  .superRefine((bindings, context) => {
    const ordinals = bindings.map((binding) => binding.ordinal);
    if (new Set(ordinals).size !== ordinals.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reference binding ordinals must be unique',
      });
    }
  });

export const characterAppearanceStagePayloadSchema = z
  .object({
    clothing: boundedStringArray(20, 500).default([]),
    accessories: boundedStringArray(20, 300).default([]),
    equipment: boundedStringArray(20, 300).default([]),
  })
  .strict()
  .refine(
    (value) =>
      value.clothing.length > 0 || value.accessories.length > 0 || value.equipment.length > 0,
    'An appearance stage must change clothing, accessories, or equipment',
  );
export type CharacterAppearanceStagePayload = z.infer<typeof characterAppearanceStagePayloadSchema>;

export const appearanceStageProvenanceSchema = z
  .object({
    mode: z.enum(['EXPLICIT', 'INFERRED']),
    chapterId: idSchema.nullable().default(null),
    sceneId: idSchema.nullable().default(null),
    evidence: boundedString(2_000),
    confidence: z.number().min(0).max(1),
    reason: boundedString(1_000),
  })
  .strict();
export type AppearanceStageProvenance = z.infer<typeof appearanceStageProvenanceSchema>;

export const characterAppearanceStageSchema = z
  .object({
    id: idSchema,
    stableId: idSchema,
    projectId: idSchema,
    characterId: idSchema,
    profileId: idSchema,
    profileRevision: z.number().int().positive(),
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    payload: characterAppearanceStagePayloadSchema,
    provenance: appearanceStageProvenanceSchema,
    reviewStatus: z.enum(['DRAFT', 'APPROVED', 'REJECTED']),
    referenceAssetId: idSchema.nullable(),
    referenceSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    inputFingerprint: z.string().trim().min(1).max(128),
    isCurrent: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type CharacterAppearanceStage = z.infer<typeof characterAppearanceStageSchema>;
export const appearanceStageCreateSchema = z
  .object({
    stableId: z.string().trim().min(1).max(120),
    profileId: idSchema,
    profileRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(240),
    payload: characterAppearanceStagePayloadSchema,
    provenance: appearanceStageProvenanceSchema,
    reviewStatus: z.enum(['DRAFT', 'APPROVED', 'REJECTED']).default('DRAFT'),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

export const locationHardGeometrySchema = z
  .object({
    environmentType: boundedString(240).default(''),
    architecture: boundedString(2_000).default(''),
    spatialLayout: boundedString(2_000).default(''),
    walls: boundedString(1_000).default(''),
    windows: boundedString(1_000).default(''),
    doors: boundedString(1_000).default(''),
    fixedFurniture: boundedStringArray(30, 300).default([]),
    terrain: boundedString(1_000).default(''),
    permanentLandmarks: boundedStringArray(30, 500).default([]),
  })
  .strict();
export type LocationHardGeometry = z.infer<typeof locationHardGeometrySchema>;

export const sceneTransientEnvironmentSchema = z
  .object({
    timeOfDay: boundedString(120).default(''),
    weather: boundedString(120).default(''),
    lighting: boundedString(1_000).default(''),
    atmosphere: boundedString(1_000).default(''),
    temporaryObjects: boundedStringArray(30, 300).default([]),
    temporaryDamage: boundedStringArray(20, 500).default([]),
  })
  .strict();
export type SceneTransientEnvironment = z.infer<typeof sceneTransientEnvironmentSchema>;

export const visualReferenceTargetKindSchema = z.enum([
  'CHARACTER_PROTOTYPE',
  'CHARACTER_STAGE',
  'LOCATION',
]);
export type VisualReferenceTargetKind = z.infer<typeof visualReferenceTargetKindSchema>;

export const visualReferenceGenerationStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type VisualReferenceGenerationStatus = z.infer<typeof visualReferenceGenerationStatusSchema>;

export const visualReferenceGenerationSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    targetKind: visualReferenceTargetKindSchema,
    targetEntityId: z.string().trim().min(1).max(120),
    targetRevision: z.number().int().positive(),
    sourcePrototypeAssetId: idSchema.nullable().default(null),
    sourcePrototypeSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable()
      .default(null),
    prompt: boundedString(8_000),
    workflowTemplate: z.string().trim().min(1).max(120),
    provider: z.string().trim().min(1).max(120),
    settings: z.record(z.unknown()),
    seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    inputFingerprint: z.string().trim().min(1).max(128),
    status: visualReferenceGenerationStatusSchema,
    approval: z.enum(['CANDIDATE', 'APPROVED', 'REJECTED']),
    assetId: idSchema.nullable(),
    assetSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    attempt: z.number().int().nonnegative(),
    error: boundedString(2_000).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.targetKind === 'CHARACTER_STAGE' &&
      (value.sourcePrototypeAssetId === null || value.sourcePrototypeSha256 === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourcePrototypeAssetId'],
        message: 'Character stage references require exact prototype lineage',
      });
    }
  });
export type VisualReferenceGeneration = z.infer<typeof visualReferenceGenerationSchema>;
export const visualReferenceScheduleSchema = z
  .object({
    targetKind: visualReferenceTargetKindSchema,
    targetEntityId: z.string().trim().min(1).max(120),
  })
  .strict();
export const visualReferenceReviewSchema = z
  .object({ approval: z.enum(['APPROVED', 'REJECTED']) })
  .strict();

export const characterVisualVariantSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    revision: z.number().int().positive().default(1),
    description: boundedString(1_000).default(''),
    promptOverrides: boundedStringArray(20, 500).default([]),
  })
  .strict();
export type CharacterVisualVariant = z.infer<typeof characterVisualVariantSchema>;

export const characterVisualProfilePayloadSchema = z
  .object({
    ageAppearance: boundedString(240).default(''),
    genderPresentation: boundedString(240).default(''),
    bodyType: boundedString(240).default(''),
    heightDescription: boundedString(240).default(''),
    faceShape: boundedString(240).default(''),
    skinTone: boundedString(240).default(''),
    hairStyle: boundedString(240).default(''),
    hairColor: boundedString(240).default(''),
    eyeDescription: boundedString(240).default(''),
    distinctiveFeatures: boundedStringArray(20, 500).default([]),
    defaultExpression: boundedString(240).default(''),
    defaultClothing: boundedString(500).default(''),
    clothingDetails: boundedStringArray(20, 500).default([]),
    accessories: boundedStringArray(20, 300).default([]),
    colorIdentity: boundedStringArray(8, 120).default([]),
    visualKeywords: boundedStringArray(30, 120).default([]),
    negativeTraits: boundedStringArray(20, 240).default([]),
    styleNotes: boundedString(1_000).default(''),
    variants: z.array(characterVisualVariantSchema).max(20).default([]),
    referenceAssetIds: visualReferenceAssetIdsSchema,
  })
  .strict();
export type CharacterVisualProfilePayload = z.infer<typeof characterVisualProfilePayloadSchema>;
export type CharacterVisualProfilePayloadInput = z.input<
  typeof characterVisualProfilePayloadSchema
>;

export const locationVisualProfilePayloadSchema = z
  .object({
    environmentType: boundedString(240).default(''),
    overallDescription: boundedString(2_000).default(''),
    architecture: boundedString(2_000).default(''),
    terrain: boundedString(1_000).default(''),
    vegetation: boundedString(1_000).default(''),
    weatherDefaults: boundedString(500).default(''),
    lightingDefaults: boundedString(1_000).default(''),
    colorPalette: boundedStringArray(20, 240).default([]),
    importantLandmarks: boundedStringArray(30, 500).default([]),
    recurringObjects: boundedStringArray(30, 300).default([]),
    atmosphere: boundedString(1_000).default(''),
    visualKeywords: boundedStringArray(30, 120).default([]),
    negativeTraits: boundedStringArray(20, 240).default([]),
    styleNotes: boundedString(1_000).default(''),
    referenceAssetIds: visualReferenceAssetIdsSchema,
  })
  .strict();
export type LocationVisualProfilePayload = z.infer<typeof locationVisualProfilePayloadSchema>;
export type LocationVisualProfilePayloadInput = z.input<typeof locationVisualProfilePayloadSchema>;

export const visualObjectProfilePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    description: boundedString(1_500).default(''),
    shape: boundedString(500).default(''),
    materials: boundedStringArray(12, 300).default([]),
    colors: boundedStringArray(12, 160).default([]),
    distinctiveFeatures: boundedStringArray(20, 500).default([]),
    condition: boundedString(500).default(''),
    visualKeywords: boundedStringArray(30, 120).default([]),
    negativeTraits: boundedStringArray(20, 240).default([]),
    styleNotes: boundedString(1_000).default(''),
    referenceAssetIds: visualReferenceAssetIdsSchema,
  })
  .strict();
export type VisualObjectProfilePayload = z.infer<typeof visualObjectProfilePayloadSchema>;
export type VisualObjectProfilePayloadInput = z.input<typeof visualObjectProfilePayloadSchema>;

export const characterVisualProfileCandidateSchema = characterVisualProfilePayloadSchema;
export const locationVisualProfileCandidateSchema = locationVisualProfilePayloadSchema;
export const visualObjectProfileCandidateSchema = visualObjectProfilePayloadSchema;

export const characterVisualProfileEnvelopeSchema = z
  .object({ profile: characterVisualProfileCandidateSchema })
  .strict();
export const locationVisualProfileEnvelopeSchema = z
  .object({ profile: locationVisualProfileCandidateSchema })
  .strict();
export const visualObjectProfileEnvelopeSchema = z
  .object({ profile: visualObjectProfileCandidateSchema })
  .strict();

export const visualProfileGenerationKindSchema = z.enum(['CHARACTER', 'LOCATION', 'OBJECT']);
export type VisualProfileGenerationKind = z.infer<typeof visualProfileGenerationKindSchema>;

export const visualProfileGenerateRequestSchema = z
  .object({
    instructions: boundedString(2_000).default(''),
  })
  .strict();
export type VisualProfileGenerateRequest = z.infer<typeof visualProfileGenerateRequestSchema>;

export const visualPromptRefinementEnvelopeSchema = z
  .object({
    packageFingerprint: z.string().trim().min(1).max(128),
    fullPrompt: boundedString(8_000),
    negativePrompt: boundedString(3_000).nullable().default(null),
  })
  .strict();
export type VisualPromptRefinementEnvelope = z.infer<typeof visualPromptRefinementEnvelopeSchema>;

export const visualPromptRefinementRequestSchema = z
  .object({
    expectedPackageRevision: z.number().int().positive().optional(),
    instructions: boundedString(2_000).default(''),
  })
  .strict();
export type VisualPromptRefinementRequest = z.infer<typeof visualPromptRefinementRequestSchema>;

export const visualProfileUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive().optional(),
    status: visualProfileStatusSchema.optional(),
    promptFragment: boundedString(2_000).optional(),
    referenceAssetIds: visualReferenceAssetIdsSchema.optional(),
    payload: z.record(z.unknown()).optional(),
  })
  .strict();
export type VisualProfileUpdate = z.infer<typeof visualProfileUpdateSchema>;

export const visualProfileApprovalSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export type VisualProfileApproval = z.infer<typeof visualProfileApprovalSchema>;

export const visualProfileReferenceUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    referenceAssetIds: visualReferenceAssetIdsSchema,
  })
  .strict();
export type VisualProfileReferenceUpdate = z.infer<typeof visualProfileReferenceUpdateSchema>;

export const characterVisualProfileDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    characterId: storyStableIdSchema,
    revision: z.number().int().positive(),
    status: visualProfileStatusSchema,
    payload: characterVisualProfilePayloadSchema,
    promptFragment: boundedString(2_000),
    inputFingerprint: z.string().min(1).max(128),
    generationId: idSchema.nullable(),
    rowVersion: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type CharacterVisualProfileDto = z.infer<typeof characterVisualProfileDtoSchema>;

export const locationVisualProfileDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    locationId: idSchema,
    locationName: z.string().trim().min(1).max(300),
    revision: z.number().int().positive(),
    status: visualProfileStatusSchema,
    payload: locationVisualProfilePayloadSchema,
    promptFragment: boundedString(2_000),
    inputFingerprint: z.string().min(1).max(128),
    generationId: idSchema.nullable(),
    rowVersion: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type LocationVisualProfileDto = z.infer<typeof locationVisualProfileDtoSchema>;

export const visualObjectProfileDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    objectKey: visualObjectKeySchema,
    name: z.string().trim().min(1).max(240),
    revision: z.number().int().positive(),
    status: visualProfileStatusSchema,
    payload: visualObjectProfilePayloadSchema,
    promptFragment: boundedString(2_000),
    inputFingerprint: z.string().min(1).max(128),
    generationId: idSchema.nullable(),
    rowVersion: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type VisualObjectProfileDto = z.infer<typeof visualObjectProfileDtoSchema>;
export const visualObjectResolutionStatusSchema = z.enum(['RESOLVED', 'UNRESOLVED', 'AMBIGUOUS']);
export type VisualObjectResolutionStatus = z.infer<typeof visualObjectResolutionStatusSchema>;

export const sceneObjectResolutionSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    sceneRevisionId: idSchema,
    sourceLabel: z.string().trim().min(1).max(500),
    normalizedKey: z.string().trim().min(1).max(120),
    visualObjectProfileId: idSchema.nullable(),
    resolutionStatus: visualObjectResolutionStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type SceneObjectResolution = z.infer<typeof sceneObjectResolutionSchema>;

export const sceneObjectResolutionUpdateSchema = z
  .object({
    visualObjectProfileId: idSchema.nullable(),
    expectedRowVersion: z.number().int().positive().optional(),
  })
  .strict();
export type SceneObjectResolutionUpdate = z.infer<typeof sceneObjectResolutionUpdateSchema>;

export const visualStylePresetSchema = z.enum([
  'CINEMATIC_REALISTIC',
  'ANIME',
  'CHINESE_FANTASY_PAINTING',
  'STORYBOOK',
  '3D_ANIMATION',
]);
export type VisualStylePreset = z.infer<typeof visualStylePresetSchema>;

export const styleBibleSchema = visualStyleSettingsSchema;
export const styleBibleUpdateSchema = visualStyleUpdateSchema;
export type StyleBible = VisualStyleSettings;
export type StyleBibleDto = VisualStyleSettingsDto;
export type StyleBibleUpdate = z.infer<typeof styleBibleUpdateSchema>;

export const visualPromptDependencyKindSchema = z.enum([
  'STYLE_BIBLE',
  'CHARACTER_PROFILE',
  'LOCATION_PROFILE',
  'OBJECT_PROFILE',
]);
export type VisualPromptDependencyKind = z.infer<typeof visualPromptDependencyKindSchema>;

export const visualPromptDependencySchema = z
  .object({
    kind: visualPromptDependencyKindSchema,
    key: z.string().trim().min(1).max(240),
    revisionId: idSchema,
    revision: z.number().int().positive(),
    fingerprint: z.string().min(1).max(128),
  })
  .strict();
export type VisualPromptDependency = z.infer<typeof visualPromptDependencySchema>;

export const resolvedCharacterVisualSchema = z
  .object({
    characterId: storyStableIdSchema.nullable(),
    displayName: z.string().trim().min(1).max(200),
    profileId: idSchema.nullable(),
    profileRevision: z.number().int().positive().nullable(),
    profileFingerprint: z.string().max(128).nullable(),
    variantKey: z.string().max(120).nullable(),
    variantRevision: z.number().int().positive().nullable(),
    canonicalAppearance: characterVisualProfilePayloadSchema.nullable(),
    sceneVisualState: sceneCharacterVisualStateSchema,
    resolvedPromptFragment: boundedString(3_000),
    resolutionStatus: z.enum(['RESOLVED', 'UNRESOLVED', 'MISSING']),
  })
  .strict();
export type ResolvedCharacterVisual = z.infer<typeof resolvedCharacterVisualSchema>;

export const resolvedLocationVisualSchema = z
  .object({
    locationId: idSchema.nullable(),
    name: z.string().max(300),
    profileId: idSchema.nullable(),
    profileRevision: z.number().int().positive().nullable(),
    profileFingerprint: z.string().max(128).nullable(),
    canonicalAppearance: locationVisualProfilePayloadSchema.nullable(),
    sceneEnvironmentState: z
      .object({
        timeOfDay: boundedString(120),
        weather: boundedString(120),
        lighting: boundedString(1_000),
        visualDescription: boundedString(4_000),
      })
      .strict(),
    resolvedPromptFragment: boundedString(4_000),
    resolutionStatus: z.enum(['RESOLVED', 'UNRESOLVED', 'MISSING']),
  })
  .strict();
export type ResolvedLocationVisual = z.infer<typeof resolvedLocationVisualSchema>;

export const resolvedObjectVisualSchema = z
  .object({
    sourceLabel: z.string().trim().min(1).max(500),
    objectKey: z.string().max(120).nullable(),
    profileId: idSchema.nullable(),
    profileRevision: z.number().int().positive().nullable(),
    profileFingerprint: z.string().max(128).nullable(),
    canonicalAppearance: visualObjectProfilePayloadSchema.nullable(),
    resolvedPromptFragment: boundedString(3_000),
    resolutionStatus: z.enum(['RESOLVED', 'UNRESOLVED', 'MISSING']),
  })
  .strict();
export type ResolvedObjectVisual = z.infer<typeof resolvedObjectVisualSchema>;

export const visualPromptPackagePayloadSchema = z
  .object({
    sceneId: idSchema,
    sceneStableId: z.string().trim().min(1).max(120),
    sceneRevision: z.number().int().positive(),
    shotId: idSchema.nullable().default(null),
    shotRevision: z.number().int().positive().nullable().default(null),
    visibleCharacterIds: z.array(storyStableIdSchema).max(20).default([]),
    offscreenCharacterIds: z.array(storyStableIdSchema).max(20).default([]),
    staticIntent: shotStaticIntentSchema.nullable().default(null),
    dynamicIntent: shotDynamicIntentSchema.nullable().default(null),
    continuityState: shotPhysicalStateSchema.nullable().default(null),
    referenceBindings: referenceBindingsSchema.default([]),
    styleRevision: z.number().int().positive().nullable(),
    style: visualStyleSettingsSchema.nullable(),
    characters: z.array(resolvedCharacterVisualSchema).max(100),
    location: resolvedLocationVisualSchema,
    objects: z.array(resolvedObjectVisualSchema).max(50),
    visualDescription: boundedString(4_000),
    subjectAction: boundedString(2_000),
    camera: sceneCameraSchema,
    composition: sceneCompositionSchema,
    lighting: boundedString(1_000),
    mood: boundedString(500),
    fullPrompt: boundedString(8_000),
    negativePrompt: boundedString(3_000).nullable(),
    refinedPrompt: boundedString(8_000).nullable(),
    refinementInputFingerprint: z.string().max(128).nullable().default(null),
    consistencyStatus: visualConsistencyStatusSchema,
    consistencyIssues: z.array(visualConsistencyIssueSchema).max(50),
    dependencies: z.array(visualPromptDependencySchema).max(250),
    inputFingerprint: z.string().min(1).max(128),
    promptTemplateVersion: z.string().trim().min(1).max(80),
  })
  .strict();
export type VisualPromptPackagePayload = z.infer<typeof visualPromptPackagePayloadSchema>;

export const visualPromptPackageDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    sceneRevisionId: idSchema,
    revision: z.number().int().positive(),
    status: visualPromptPackageStatusSchema,
    payload: visualPromptPackagePayloadSchema,
    generationId: idSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type VisualPromptPackageDto = z.infer<typeof visualPromptPackageDtoSchema>;

export type VisualPromptPackageListItem = Pick<
  VisualPromptPackageDto,
  | 'id'
  | 'projectId'
  | 'sceneRevisionId'
  | 'revision'
  | 'status'
  | 'generationId'
  | 'createdAt'
  | 'updatedAt'
> & {
  sceneNumber: number;
  sceneTitle: string;
  consistencyStatus: VisualConsistencyStatus;
  inputFingerprint: string;
};

export type VisualStylePresetValues = Record<VisualStylePreset, StyleBible>;

export const visualStylePresets: VisualStylePresetValues = {
  CINEMATIC_REALISTIC: {
    styleName: 'Cinematic Realistic',
    styleDescription:
      'Cinematic realistic visual language with grounded materials and expressive light.',
    medium: 'cinematic digital illustration',
    realism: 'high realism',
    overallStyle: 'cinematic realistic',
    colorPalette: 'deep shadows, restrained saturation, warm practical highlights',
    cinematicStyle: 'widescreen cinematic composition',
    cinematicLanguage: 'cinematic lens language with grounded depth',
    lightingStyle: 'motivated cinematic lighting',
    textureStyle: 'natural material texture',
    environmentStyle: 'detailed believable environments',
    characterRenderingStyle: 'naturalistic faces and clothing',
    cameraStyle: 'cinematic camera language',
    compositionStyle: 'clear layered composition',
    moodKeywords: ['dramatic', 'immersive'],
    aspectRatio: '16:9',
    promptSuffix: 'cinematic detail, coherent visual continuity',
    positivePromptSuffix: 'cinematic detail, coherent visual continuity',
    negativePrompt: '',
    referenceAssetIds: [],
  },
  ANIME: {
    styleName: 'Anime',
    styleDescription:
      'Clean expressive anime rendering with strong silhouettes and controlled color.',
    medium: 'anime illustration',
    realism: 'stylized',
    overallStyle: 'cinematic anime',
    colorPalette: 'clear saturated accents with controlled shadows',
    cinematicStyle: 'dynamic anime cinematography',
    cinematicLanguage: 'expressive anime framing',
    lightingStyle: 'graphic directional lighting',
    textureStyle: 'clean cel-shaded surfaces',
    environmentStyle: 'stylized detailed environments',
    characterRenderingStyle: 'expressive anime character rendering',
    cameraStyle: 'dynamic anime camera language',
    compositionStyle: 'readable silhouette-driven composition',
    moodKeywords: ['expressive', 'dramatic'],
    aspectRatio: '16:9',
    promptSuffix: 'consistent anime character design',
    positivePromptSuffix: 'consistent anime character design',
    negativePrompt: '',
    referenceAssetIds: [],
  },
  CHINESE_FANTASY_PAINTING: {
    styleName: 'Chinese Fantasy Painting',
    styleDescription:
      'Atmospheric Chinese fantasy painting with ink, mineral color, and cinematic depth.',
    medium: 'Chinese fantasy digital painting',
    realism: 'painterly realism',
    overallStyle: 'Chinese fantasy painting',
    colorPalette: 'ink black, jade green, muted cinnabar, misty blue',
    cinematicStyle: 'poetic wuxia composition',
    cinematicLanguage: 'poetic panoramic framing',
    lightingStyle: 'diffused misty light',
    textureStyle: 'ink wash and mineral pigment texture',
    environmentStyle: 'misty mountains and architectural detail',
    characterRenderingStyle: 'painterly expressive figures',
    cameraStyle: 'measured panoramic camera language',
    compositionStyle: 'balanced scroll-painting composition',
    moodKeywords: ['mythic', 'atmospheric'],
    aspectRatio: '16:9',
    promptSuffix: 'coherent Chinese fantasy visual identity',
    positivePromptSuffix: 'coherent Chinese fantasy visual identity',
    negativePrompt: '',
    referenceAssetIds: [],
  },
  STORYBOOK: {
    styleName: 'Storybook',
    styleDescription:
      'Warm illustrated storybook style with readable shapes and gentle atmosphere.',
    medium: 'storybook illustration',
    realism: 'stylized painterly',
    overallStyle: 'cinematic storybook',
    colorPalette: 'warm paper tones with selective vivid accents',
    cinematicStyle: 'storybook cinematic framing',
    cinematicLanguage: 'clear illustrated framing',
    lightingStyle: 'soft readable light',
    textureStyle: 'paper and brush texture',
    environmentStyle: 'charming simplified environments',
    characterRenderingStyle: 'friendly illustrated characters',
    cameraStyle: 'storybook camera language',
    compositionStyle: 'clear readable shape composition',
    moodKeywords: ['warm', 'evocative'],
    aspectRatio: '16:9',
    promptSuffix: 'consistent storybook illustration',
    positivePromptSuffix: 'consistent storybook illustration',
    negativePrompt: '',
    referenceAssetIds: [],
  },
  '3D_ANIMATION': {
    styleName: '3D Animation',
    styleDescription: 'Polished 3D animated look with appealing forms and cinematic staging.',
    medium: '3D animated film still',
    realism: 'stylized 3D',
    overallStyle: 'cinematic 3D animation',
    colorPalette: 'rich appealing colors with soft contrast',
    cinematicStyle: 'animated feature-film staging',
    cinematicLanguage: 'cinematic animated framing',
    lightingStyle: 'soft studio and practical lighting',
    textureStyle: 'clean tactile 3D materials',
    environmentStyle: 'detailed stylized environments',
    characterRenderingStyle: 'appealing expressive 3D characters',
    cameraStyle: 'animated feature camera language',
    compositionStyle: 'clear cinematic staging',
    moodKeywords: ['appealing', 'cinematic'],
    aspectRatio: '16:9',
    promptSuffix: 'consistent 3D animated character design',
    positivePromptSuffix: 'consistent 3D animated character design',
    negativePrompt: '',
    referenceAssetIds: [],
  },
};

export type { SceneCamera, SceneCharacterVisualState, SceneComposition };
