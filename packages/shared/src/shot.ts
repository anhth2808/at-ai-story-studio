import { z } from 'zod';

const idSchema = z.string().uuid();
const stableIdSchema = z.string().trim().min(1).max(120);
const bounded = (max: number) => z.string().trim().max(max);
const uniqueStrings = (maxItems: number, maxLength: number) =>
  z
    .array(z.string().trim().min(1).max(maxLength))
    .max(maxItems)
    .refine((values) => new Set(values).size === values.length, 'Values must be unique');

export const shotPlanStatusSchema = z.enum(['CURRENT', 'STALE', 'FAILED']);
export type ShotPlanStatus = z.infer<typeof shotPlanStatusSchema>;

export const narrativeBeatKindSchema = z.enum([
  'ACTION',
  'DIALOGUE',
  'REACTION',
  'REVEAL',
  'ENVIRONMENT',
  'OBJECT',
  'SPATIAL_RELATIONSHIP',
]);
export type NarrativeBeatKind = z.infer<typeof narrativeBeatKindSchema>;

export const shotImportanceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type ShotImportance = z.infer<typeof shotImportanceSchema>;

export const shotDialogueModeSchema = z.enum([
  'NONE',
  'SPOKEN',
  'OFFSCREEN_SPOKEN',
  'INTERNAL_MONOLOGUE',
  'NARRATION',
  'VOICE_OVER',
]);
export type ShotDialogueMode = z.infer<typeof shotDialogueModeSchema>;

export const shotFramingSchema = z.enum([
  'EXTREME_CLOSE_UP',
  'CLOSE_UP',
  'MEDIUM',
  'WIDE',
  'EXTREME_WIDE',
]);
export type ShotFraming = z.infer<typeof shotFramingSchema>;

export const shotCameraMotionSchema = z.enum([
  'STATIC',
  'PUSH_IN',
  'PULL_OUT',
  'PAN_LEFT',
  'PAN_RIGHT',
  'ORBIT_SUBTLE',
  'HANDHELD_SUBTLE',
]);
export type ShotCameraMotion = z.infer<typeof shotCameraMotionSchema>;

export const shotValidationIssueCodeSchema = z.enum([
  'SHOT_OVERLOADED',
  'TURNING_POINT_NOT_ISOLATED',
  'SHOT_FILLER',
  'DIALOGUE_CARRIER_MISSING',
  'MONOLOGUE_LIP_MOVEMENT',
  'PROMPT_RESPONSIBILITY_MIXED',
  'SHOT_DURATION_EXCEEDED',
  'CONTINUITY_INVALID',
  'CONTINUATION_INELIGIBLE',
  'SHOT_REPETITIVE',
]);
export type ShotValidationIssueCode = z.infer<typeof shotValidationIssueCodeSchema>;

export const shotValidationIssueSchema = z
  .object({
    code: shotValidationIssueCodeSchema,
    severity: z.enum(['WARNING', 'ERROR']),
    shotId: stableIdSchema.nullable().default(null),
    message: z.string().trim().min(1).max(500),
  })
  .strict();
export type ShotValidationIssue = z.infer<typeof shotValidationIssueSchema>;

export const shotSourceRangeSchema = z
  .object({ startOffset: z.number().int().min(0), endOffset: z.number().int().positive() })
  .strict()
  .refine((value) => value.endOffset > value.startOffset, {
    message: 'Shot source end must be after start',
    path: ['endOffset'],
  });
export type ShotSourceRange = z.infer<typeof shotSourceRangeSchema>;

export const narrativeBeatSchema = z
  .object({
    id: stableIdSchema,
    ordinal: z.number().int().positive(),
    sourceRange: shotSourceRangeSchema,
    kind: narrativeBeatKindSchema,
    meaning: z.string().trim().min(1).max(1_000),
    importance: shotImportanceSchema,
    turningPoint: z.boolean().default(false),
    timingGroupKey: stableIdSchema,
  })
  .strict();
export type NarrativeBeat = z.infer<typeof narrativeBeatSchema>;

export const shotStaticIntentSchema = z
  .object({
    subject: z.string().trim().min(1).max(1_000),
    action: bounded(1_000).default(''),
    pose: bounded(500).default(''),
    expression: bounded(500).default(''),
    relationship: bounded(500).default(''),
    importantObjectIds: uniqueStrings(20, 120).default([]),
    framing: shotFramingSchema,
    angle: bounded(240).default(''),
    composition: bounded(1_000).default(''),
    lighting: bounded(1_000).default(''),
    colorMood: bounded(500).default(''),
    atmosphere: bounded(500).default(''),
  })
  .strict();
export type ShotStaticIntent = z.infer<typeof shotStaticIntentSchema>;

export const shotDynamicIntentSchema = z
  .object({
    subjectMotion: bounded(1_000).default(''),
    cameraMotion: shotCameraMotionSchema.default('STATIC'),
    cameraSpeed: z.enum(['NONE', 'SLOW', 'MODERATE']).default('NONE'),
    environmentMotion: bounded(500).default(''),
    emotionalTiming: bounded(500).default(''),
    speakingMotion: bounded(500).default(''),
    stabilityConstraints: uniqueStrings(20, 300).default([]),
  })
  .strict();
export type ShotDynamicIntent = z.infer<typeof shotDynamicIntentSchema>;

export const shotCharacterContinuitySchema = z
  .object({
    characterId: stableIdSchema,
    appearanceStageId: stableIdSchema.optional(),
    visible: z.boolean(),
    screenRegion: bounded(120).default(''),
    worldPosition: bounded(300).default(''),
    facing: bounded(120).default(''),
    bodyOrientation: bounded(120).default(''),
    pose: bounded(300).default(''),
    heldObjectIds: uniqueStrings(12, 120).default([]),
    faceVisibility: z.enum(['FRONTAL', 'PROFILE', 'PARTIAL', 'OCCLUDED', 'BACK', 'NONE']),
  })
  .strict();
export type ShotCharacterContinuity = z.infer<typeof shotCharacterContinuitySchema>;

export const shotObjectContinuitySchema = z
  .object({
    objectId: stableIdSchema,
    position: bounded(300),
    holderCharacterId: stableIdSchema.nullable().default(null),
  })
  .strict();
export type ShotObjectContinuity = z.infer<typeof shotObjectContinuitySchema>;

export const shotPhysicalStateSchema = z
  .object({
    characters: z.array(shotCharacterContinuitySchema).max(20).default([]),
    objects: z.array(shotObjectContinuitySchema).max(20).default([]),
    cameraAxis: bounded(240).default(''),
    locationId: stableIdSchema.nullable().default(null),
    sourceShotId: stableIdSchema.nullable().default(null),
    fingerprint: z.string().trim().min(1).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values] of [
      ['characters', value.characters.map((entry) => entry.characterId)],
      ['objects', value.objects.map((entry) => entry.objectId)],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: 'IDs must be unique',
        });
      }
    }
  });
export type ShotPhysicalState = z.infer<typeof shotPhysicalStateSchema>;

export const shotContinuationModeSchema = z.enum(['NEW_KEYFRAME', 'CONTINUE_PREVIOUS']);
export type ShotContinuationMode = z.infer<typeof shotContinuationModeSchema>;

export const shotContinuationDecisionSchema = z
  .object({
    mode: shotContinuationModeSchema,
    eligible: z.boolean(),
    reason: z.string().trim().min(1).max(1_000),
    version: z.string().trim().min(1).max(80),
  })
  .strict()
  .refine((value) => value.eligible === (value.mode === 'CONTINUE_PREVIOUS'), {
    message: 'Continuation mode and eligibility must agree',
  });
export type ShotContinuationDecision = z.infer<typeof shotContinuationDecisionSchema>;

export const shotSchema = z
  .object({
    id: stableIdSchema,
    beatId: stableIdSchema,
    ordinal: z.number().int().positive(),
    sourceRange: shotSourceRangeSchema,
    primaryBeat: narrativeBeatKindSchema,
    eventKinds: z.array(narrativeBeatKindSchema).min(1).max(8),
    eventCount: z.number().int().min(1).max(8),
    importance: shotImportanceSchema,
    hero: z.boolean().default(false),
    identitySensitive: z.boolean().default(false),
    dialogueMode: shotDialogueModeSchema,
    dialogueText: bounded(2_000).default(''),
    speakerCharacterId: stableIdSchema.nullable().default(null),
    visualCarrier: bounded(1_000).default(''),
    offscreenRationale: bounded(500).default(''),
    visibleCharacterIds: uniqueStrings(20, 120).default([]),
    offscreenCharacterIds: uniqueStrings(20, 120).default([]),
    staticIntent: shotStaticIntentSchema,
    dynamicIntent: shotDynamicIntentSchema,
    initialState: shotPhysicalStateSchema,
    finalState: shotPhysicalStateSchema,
    continuation: shotContinuationDecisionSchema,
    plannedDurationMs: z.number().int().min(250).max(60_000),
    variationIntent: z.enum(['NORMAL', 'MATCHED', 'INTENTIONAL_REPEAT']).default('NORMAL'),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.eventKinds).size !== value.eventKinds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eventKinds'],
        message: 'Event kinds must be unique',
      });
    }
    if (!value.eventKinds.includes(value.primaryBeat)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryBeat'],
        message: 'Primary beat must be present in event kinds',
      });
    }
    const overlap = value.visibleCharacterIds.filter((id) =>
      value.offscreenCharacterIds.includes(id),
    );
    if (overlap.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offscreenCharacterIds'],
        message: 'A Character cannot be both visible and off-screen',
      });
    }
  });
export type Shot = z.infer<typeof shotSchema>;

export const shotPlanCandidateSchema = z
  .object({
    beats: z.array(narrativeBeatSchema).min(1).max(200),
    shots: z.array(shotSchema).min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    const beatIds = new Set(value.beats.map((beat) => beat.id));
    const beatOrdinals = value.beats.map((beat) => beat.ordinal);
    const shotOrdinals = value.shots.map((shot) => shot.ordinal);
    if (beatIds.size !== value.beats.length || new Set(beatOrdinals).size !== beatOrdinals.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats'],
        message: 'Beat IDs and ordinals must be unique',
      });
    }
    if (new Set(shotOrdinals).size !== shotOrdinals.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots'],
        message: 'Shot ordinals must be unique',
      });
    }
    value.shots.forEach((shot, index) => {
      if (!beatIds.has(shot.beatId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'beatId'],
          message: 'Shot beat does not exist',
        });
      }
    });
  });
export type ShotPlanCandidate = z.infer<typeof shotPlanCandidateSchema>;

export const shotPlanReviewStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export const shotPlanReviewRequestSchema = z
  .object({
    status: shotPlanReviewStatusSchema.exclude(['PENDING']),
    notes: z.string().trim().max(2_000).default(''),
    expectedRowVersion: z.number().int().positive(),
  })
  .strict();
export type ShotPlanReviewRequest = z.infer<typeof shotPlanReviewRequestSchema>;
export const shotPlanDtoSchema = z
  .object({
    id: idSchema,
    stableId: stableIdSchema,
    projectId: idSchema,
    chapterId: idSchema,
    sceneId: stableIdSchema,
    sceneRevisionId: idSchema,
    revision: z.number().int().positive(),
    status: shotPlanStatusSchema,
    isCurrent: z.boolean(),
    templateVersion: z.string().trim().min(1).max(80),
    schemaVersion: z.string().trim().min(1).max(80),
    inputFingerprint: z.string().trim().min(1).max(128),
    generationId: idSchema.nullable(),
    candidate: shotPlanCandidateSchema,
    reviewStatus: shotPlanReviewStatusSchema.default('PENDING'),
    reviewNotes: z.string().max(2_000).default(''),
    rowVersion: z.number().int().positive().default(1),
    issues: z.array(shotValidationIssueSchema).max(100).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ShotPlanDto = z.infer<typeof shotPlanDtoSchema>;

export const shotPlanningRequestSchema = z
  .object({ expectedSceneRevision: z.number().int().positive().optional() })
  .strict();
export type ShotPlanningRequest = z.infer<typeof shotPlanningRequestSchema>;
