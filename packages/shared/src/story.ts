import { z } from 'zod';

export const storyStableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export type StoryStableId = z.infer<typeof storyStableIdSchema>;

export const storyGenerationModeSchema = z.literal('IDEA_TO_STORY');
export type StoryGenerationMode = z.infer<typeof storyGenerationModeSchema>;

export const storyPacingSchema = z.enum(['SLOW', 'MEDIUM', 'FAST']);
export const storyGenerationSettingsSchema = z
  .object({
    model: z.string().trim().min(1).max(200).nullable().default(null),
    contextBudget: z.number().int().min(500).max(10_000).default(5_000),
    temperature: z.number().min(0).max(1).default(0.7),
    maxOutputTokens: z.number().int().min(256).max(32_000).default(8_000),
    planningWindow: z.number().int().min(10).max(25).default(20),
    continuityChecksEnabled: z.boolean().default(false),
    maxChaptersPerBatch: z.number().int().min(1).max(200).default(25),
    maxEstimatedTokensPerOperation: z.number().int().min(1).max(1_000_000).nullable().default(null),
    maxRetries: z.number().int().min(0).max(10).default(3),
    budgetUsd: z.number().min(0).nullable().default(null),
    budgetCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .default('USD'),
  })
  .strict();
type StoryGenerationSettingsOutput = z.infer<typeof storyGenerationSettingsSchema>;
export type StoryGenerationSettings = Omit<
  StoryGenerationSettingsOutput,
  | 'planningWindow'
  | 'continuityChecksEnabled'
  | 'maxChaptersPerBatch'
  | 'maxEstimatedTokensPerOperation'
  | 'maxRetries'
  | 'budgetUsd'
  | 'budgetCurrency'
> &
  Partial<
    Pick<
      StoryGenerationSettingsOutput,
      | 'planningWindow'
      | 'continuityChecksEnabled'
      | 'maxChaptersPerBatch'
      | 'maxEstimatedTokensPerOperation'
      | 'maxRetries'
      | 'budgetUsd'
      | 'budgetCurrency'
    >
  >;

export const storySettingsSchema = z
  .object({
    mode: storyGenerationModeSchema.default('IDEA_TO_STORY'),
    idea: z.string().trim().min(1).max(20_000),
    language: z.string().trim().min(2).max(20).default('vi-VN'),
    genre: z.string().trim().min(1).max(120),
    tone: z.string().trim().min(1).max(120),
    audience: z.string().trim().min(1).max(120),
    targetChapterCount: z.number().int().min(1).max(200),
    chapterLength: z.number().int().min(100).max(20_000),
    pacing: storyPacingSchema,
    contentBoundaries: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    characterNotes: z.string().max(20_000).default(''),
    worldNotes: z.string().max(20_000).default(''),
    plotRequirements: z.string().max(20_000).default(''),
    generation: storyGenerationSettingsSchema.default({}),
  })
  .strict();
type StorySettingsSchemaOutput = z.infer<typeof storySettingsSchema>;
export type StorySettings = Omit<StorySettingsSchemaOutput, 'generation'> & {
  generation: StoryGenerationSettings;
};

const boundedString = (max: number) => z.string().max(max);
const boundedStringArray = (maxItems: number, maxLength: number) =>
  z.array(boundedString(maxLength)).max(maxItems);

export const characterRelationshipSchema = z
  .object({ characterId: storyStableIdSchema, relationship: boundedString(500) })
  .strict();
export type CharacterRelationship = z.infer<typeof characterRelationshipSchema>;

export const storyCharacterSchema = z
  .object({
    id: storyStableIdSchema,
    name: z.string().trim().min(1).max(200),
    role: boundedString(500),
    ageRange: boundedString(120),
    appearance: boundedString(2_000),
    personality: boundedString(2_000),
    wants: boundedString(2_000),
    fears: boundedString(2_000),
    traits: boundedStringArray(30, 120),
    relationships: z.array(characterRelationshipSchema).max(50),
    backstory: boundedString(4_000),
    voice: boundedString(1_000),
    arc: boundedString(2_000),
  })
  .strict();
export type StoryCharacter = z.infer<typeof storyCharacterSchema>;

export const storyBlueprintSchema = z
  .object({
    premise: z.string().trim().min(1).max(10_000),
    themes: boundedStringArray(30, 500),
    worldRules: boundedStringArray(50, 1_000),
    continuityConstraints: boundedStringArray(50, 1_000),
    plotDirection: boundedString(10_000),
    characters: z.array(storyCharacterSchema).min(1).max(100),
  })
  .strict();
export type StoryBlueprint = z.infer<typeof storyBlueprintSchema>;

export const chapterPlanItemSchema = z
  .object({
    id: storyStableIdSchema,
    chapterNumber: z.number().int().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    purpose: boundedString(2_000),
    summary: boundedString(5_000),
    setting: boundedString(1_000),
    characterIds: z.array(storyStableIdSchema).max(100),
    conflict: boundedString(2_000),
    turningPoints: boundedStringArray(30, 1_000),
    resolution: boundedString(2_000),
    emotionalArc: boundedString(1_000),
    estimatedWordCount: z.number().int().min(100).max(50_000),
    threadIds: z.array(storyStableIdSchema).max(100),
  })
  .strict();
export type ChapterPlanItem = z.infer<typeof chapterPlanItemSchema>;

export const chapterPlanSchema = z
  .object({ items: z.array(chapterPlanItemSchema).min(1).max(200) })
  .strict();
export type ChapterPlan = z.infer<typeof chapterPlanSchema>;

export const storyThreadTypeSchema = z.enum([
  'MYSTERY',
  'GOAL',
  'PROMISE',
  'REVENGE',
  'ROMANCE',
  'CONFLICT',
  'QUEST',
  'SECRET',
  'FORESHADOWING',
]);
export const storyThreadStatusSchema = z.enum(['OPEN', 'PROGRESSING', 'RESOLVED', 'ABANDONED']);
export const storyThreadImportanceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const storyThreadSchema = z
  .object({
    id: storyStableIdSchema,
    title: boundedString(200).optional(),
    description: boundedString(2_000),
    type: storyThreadTypeSchema.optional(),
    status: storyThreadStatusSchema,
    importance: storyThreadImportanceSchema.optional(),
    characterIds: z.array(storyStableIdSchema).max(100),
    introducedChapter: z.number().int().min(1).max(200).nullable(),
    lastTouchedChapter: z.number().int().min(1).max(200).nullable().optional(),
    expectedResolutionStart: z.number().int().min(1).max(200).nullable().optional(),
    expectedResolutionEnd: z.number().int().min(1).max(200).nullable().optional(),
    resolvedChapter: z.number().int().min(1).max(200).nullable(),
    abandonedChapter: z.number().int().min(1).max(200).nullable().optional(),
  })
  .strict();
export type StoryThread = z.infer<typeof storyThreadSchema>;

export const characterStateChangeSchema = z
  .object({ characterId: storyStableIdSchema, change: boundedString(2_000) })
  .strict();
export const storyEventSchema = z
  .object({
    description: boundedString(2_000),
    importance: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    characterIds: z.array(storyStableIdSchema).max(100),
  })
  .strict();
export type StoryEvent = z.infer<typeof storyEventSchema>;
export const threadTransitionSchema = z
  .object({
    threadId: storyStableIdSchema,
    status: storyThreadStatusSchema,
    note: boundedString(2_000),
  })
  .strict();
export type ThreadTransition = z.infer<typeof threadTransitionSchema>;

export const chapterSummarySchema = z
  .object({
    recap: z.string().trim().min(1).max(10_000),
    keyFacts: boundedStringArray(50, 1_000),
    characterStateChanges: z.array(characterStateChangeSchema).max(100),
    newInformation: boundedStringArray(50, 1_000),
    openThreadIds: z.array(storyStableIdSchema).max(100),
    resolvedThreadIds: z.array(storyStableIdSchema).max(100),
  })
  .strict();
export type ChapterSummary = z.infer<typeof chapterSummarySchema>;

export const generationOperationSchema = z.enum([
  'BLUEPRINT',
  'CHAPTER_PLANS',
  'CHAPTER',
  'CHAPTER_SUMMARY',
  'ARC_PLANNING',
  'CHAPTER_PLAN_WINDOW',
  'CHAPTER_GENERATION_V2',
  'STATE_ANALYSIS',
  'CONTINUITY_CHECK',
  'SUMMARY_COMPACTION',
]);
export type GenerationOperation = z.infer<typeof generationOperationSchema>;
export const storyGenerationRequestSchema = z
  .object({
    expectedChapterRevision: z.number().int().positive().optional(),
    expectedPlanRevision: z.number().int().positive().optional(),
  })
  .strict();
export type StoryGenerationRequest = z.infer<typeof storyGenerationRequestSchema>;

export const generationMetadataSchema = z
  .object({
    operation: generationOperationSchema,
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    provider: boundedString(120).nullable(),
    model: boundedString(200).nullable(),
    promptVersion: z.string().min(1).max(80),
    schemaVersion: z.string().min(1).max(80),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().min(0).nullable(),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    costUsd: z.number().min(0).nullable(),
    costCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    finishReason: boundedString(80).nullable().optional(),
    attempt: z.number().int().min(1),
    contextHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    omittedContext: boundedStringArray(100, 200).default([]),
    contextDiagnostics: z.unknown().optional(),
    sourceRevisions: boundedStringArray(50, 120).optional(),
  })
  .strict();
export type GenerationMetadata = z.infer<typeof generationMetadataSchema>;

export const chapterGenerationEnvelopeSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(2_000_000),
    summary: chapterSummarySchema,
    events: z.array(storyEventSchema).max(200),
    characterStateChanges: z.array(characterStateChangeSchema).max(100),
    threadTransitions: z.array(threadTransitionSchema).max(100),
    usedCharacterIds: z.array(storyStableIdSchema).max(100),
    introducedCharacterIds: z.array(storyStableIdSchema).max(100),
    unresolvedThreadIds: z.array(storyStableIdSchema).max(100),
    continuityWarnings: boundedStringArray(50, 2_000),
  })
  .strict();
export type ChapterGenerationEnvelope = z.infer<typeof chapterGenerationEnvelopeSchema>;

export const storyGenerationResultSchema = z
  .object({
    operation: generationOperationSchema,
    data: z.unknown(),
    metadata: generationMetadataSchema,
  })
  .strict();
export type StoryGenerationResult = z.infer<typeof storyGenerationResultSchema>;

export function parseStoryOperationOutput(operation: GenerationOperation, text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Story model output must be JSON');
  }
  if (operation === 'BLUEPRINT') return storyBlueprintSchema.parse(value);
  if (operation === 'CHAPTER_PLANS') return chapterPlanSchema.parse(value);
  if (operation === 'CHAPTER') return chapterGenerationEnvelopeSchema.parse(value);
  if (operation === 'CHAPTER_SUMMARY') return chapterSummarySchema.parse(value);
  if (operation === 'ARC_PLANNING') return storyArcPlanSchema.parse(value);
  if (operation === 'CHAPTER_PLAN_WINDOW') return storyPlanWindowResultSchema.parse(value);
  if (operation === 'CHAPTER_GENERATION_V2') return chapterGenerationV2EnvelopeSchema.parse(value);
  if (operation === 'STATE_ANALYSIS') return manualChapterAnalysisSchema.parse(value);
  if (operation === 'CONTINUITY_CHECK') return continuityCheckResultSchema.parse(value);
  return z.string().min(1).parse(value);
}
export const ompProtocolVersionSchema = z.literal(1);
export const ompProtocolRequestSchema = z
  .object({
    kind: z.literal('request'),
    version: ompProtocolVersionSchema,
    correlationId: z.string().uuid(),
    operation: generationOperationSchema,
    model: boundedString(200).nullable(),
    promptVersion: z.string().min(1).max(80),
    schemaVersion: z.string().min(1).max(80),
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    systemPrompt: z.string().min(1).max(200_000),
    userPrompt: z.string().min(1).max(2_000_000),
    deadlineMs: z.number().int().min(1_000).max(600_000),
  })
  .strict();
export type OmpProtocolRequest = z.infer<typeof ompProtocolRequestSchema>;

export const ompProtocolProgressSchema = z
  .object({
    kind: z.literal('progress'),
    version: ompProtocolVersionSchema,
    correlationId: z.string().uuid(),
    stage: z.enum(['STARTING', 'AUTHENTICATING', 'GENERATING', 'PARSING']),
    message: z.string().max(500),
  })
  .strict();
export type OmpProtocolProgress = z.infer<typeof ompProtocolProgressSchema>;

export const ompProtocolResultSchema = z
  .object({
    kind: z.literal('result'),
    version: ompProtocolVersionSchema,
    correlationId: z.string().uuid(),
    operation: generationOperationSchema,
    text: z.string().min(1).max(2_000_000),
    provider: z.string().max(120).nullable(),
    model: z.string().max(200).nullable(),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    costUsd: z.number().min(0).nullable(),
    costCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    finishReason: boundedString(80).nullable().optional(),
    durationMs: z.number().int().min(0),
  })
  .strict();
export type OmpProtocolResult = z.infer<typeof ompProtocolResultSchema>;

export const ompProtocolErrorSchema = z
  .object({
    kind: z.literal('error'),
    version: ompProtocolVersionSchema,
    correlationId: z.string().uuid(),
    code: z.enum([
      'CONFIGURATION_ERROR',
      'AUTHENTICATION_ERROR',
      'MODEL_ERROR',
      'PROVIDER_ERROR',
      'VALIDATION_ERROR',
      'STRUCTURED_OUTPUT_ERROR',
      'CONTEXT_ERROR',
      'CONTINUITY_ERROR',
      'BUDGET_ERROR',
      'TIMEOUT',
      'CANCELLED',
      'PROTOCOL_ERROR',
      'HOST_ERROR',
    ]),
    message: z.string().max(500),
    retryable: z.boolean(),
  })
  .strict();

export const ompProtocolEventSchema = z.discriminatedUnion('kind', [
  ompProtocolProgressSchema,
  ompProtocolResultSchema,
  ompProtocolErrorSchema,
]);
export type OmpProtocolEvent = z.infer<typeof ompProtocolEventSchema>;
export function parseOmpProtocolLine(line: string): OmpProtocolEvent {
  return ompProtocolEventSchema.parse(JSON.parse(line));
}
export const ompReadinessSchema = z
  .object({
    ready: z.boolean(),
    runtime: z.string().max(80),
    model: z.string().max(300).nullable(),
    message: z.string().max(500),
  })
  .strict();
export type OmpReadiness = z.infer<typeof ompReadinessSchema>;

export type StorySettingsDto = StorySettings & {
  id: string;
  projectId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type StoryBlueprintDto = {
  id: string;
  projectId: string;
  revision: number;
  settingsRevision: number;
  blueprint: StoryBlueprint;
  metadata: GenerationMetadata | null;
  createdAt: string;
};
export type StoryPlanDto = {
  id: string;
  projectId: string;
  revision: number;
  blueprintRevision: number;
  plan: ChapterPlan;
  metadata: GenerationMetadata | null;
  createdAt: string;
};
export type StorySummaryDto = {
  id: string;
  chapterId: string;
  chapterRevision: number;
  revision: number;
  summary: ChapterSummary;
  events: StoryEvent[];
  threadTransitions: ThreadTransition[];
  threads: StoryThread[];
  warnings: string[];
  metadata: GenerationMetadata | null;
  createdAt: string;
};
export type StoryLongStoryCounts = {
  targetChapterCount: number;
  arcCount: number;
  plannedChapterCount: number;
  generatedChapterCount: number;
  continuityWarningCount: number;
  staleChapterCount: number;
  currentBlockingChapter: number | null;
};
export type StoryUsageSummary = {
  operations: number;
  knownInputTokens: number;
  knownOutputTokens: number;
  knownCostUsd: number;
  unavailableCount: number;
};
export type StorySnapshotDto = {
  settings: StorySettingsDto | null;
  blueprint: StoryBlueprintDto | null;
  plan: StoryPlanDto | null;
  summaries: StorySummaryDto[];
  threads: StoryThread[];
  arcs: StoryArc[];
  planWindows: StoryPlanWindowSummary[];
  state: StoryState | null;
  longStoryCounts: StoryLongStoryCounts;
  batches: StoryGenerationBatch[];
  usageSummary: StoryUsageSummary;
  recentUsage: AiUsage[];
  contextDiagnostics: StoryContextDiagnostic[];
  continuityChecks: Array<{
    id: string;
    chapterId: string;
    chapterRevision: number;
    result: ContinuityCheckResult;
    stateDelta: StoryStateDelta | null;
    summary: ChapterSummary | null;
    acceptedAt: string | null;
  }>;
  jobs: Array<{
    id: string;
    type: string;
    entityId: string;
    status: string;
    progress: number;
    error: string | null;
    attempts: number;
  }>;
  omp: { ready: boolean; model: string | null; message: string };
};

export const storyCharacterStateSchema = z
  .object({
    characterId: storyStableIdSchema,
    location: boundedString(500).nullable().default(null),
    currentGoal: boundedString(1_000).nullable().default(null),
    powerLevel: boundedString(120).nullable().default(null),
    injuries: boundedStringArray(30, 300).default([]),
    possessions: boundedStringArray(50, 300).default([]),
    relationships: z.array(characterRelationshipSchema).max(50).default([]),
    knowledge: boundedStringArray(100, 300).default([]),
    lastUpdatedChapter: z.number().int().min(1).max(200).nullable().default(null),
  })
  .strict();
export type StoryCharacterState = z.infer<typeof storyCharacterStateSchema>;

export const storyArcStatusSchema = z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'STALE']);
export const storyArcSchema = z
  .object({
    id: storyStableIdSchema,
    ordinalIndex: z.number().int().min(1).max(200),
    startChapter: z.number().int().min(1).max(200),
    endChapter: z.number().int().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    goal: boundedString(2_000),
    conflict: boundedString(2_000),
    importantCharacterIds: z.array(storyStableIdSchema).max(100),
    importantThreadIds: z.array(storyStableIdSchema).max(100),
    plannedOutcome: boundedString(2_000),
    status: storyArcStatusSchema.default('PLANNED'),
    sourceBlueprintRevision: z.number().int().positive(),
    inputFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endChapter < value.startChapter)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endChapter'],
        message: 'Arc end chapter must not precede its start chapter',
      });
  });
export type StoryArc = z.infer<typeof storyArcSchema>;

export const storyArcPlanSchema = z
  .object({ arcs: z.array(storyArcSchema).min(1).max(50) })
  .strict();
export type StoryArcPlan = z.infer<typeof storyArcPlanSchema>;

export const storyPlanWindowSchema = z
  .object({
    id: storyStableIdSchema,
    startChapter: z.number().int().min(1).max(200),
    endChapter: z.number().int().min(1).max(200),
    arcId: storyStableIdSchema,
    sourceBlueprintRevision: z.number().int().positive(),
    priorWindowSummary: boundedString(4_000).nullable().default(null),
    inputFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    status: z.enum(['PLANNED', 'CURRENT', 'STALE', 'INVALIDATED']).default('PLANNED'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endChapter < value.startChapter)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endChapter'],
        message: 'Plan window end chapter must not precede its start chapter',
      });
    if (value.endChapter - value.startChapter + 1 > 25)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endChapter'],
        message: 'Plan windows must contain at most 25 chapters',
      });
  });
export type StoryPlanWindow = z.infer<typeof storyPlanWindowSchema>;

export const storyPlanWindowResultSchema = z
  .object({
    window: storyPlanWindowSchema,
    items: z.array(chapterPlanItemSchema).min(1).max(25),
  })
  .strict();
export type StoryPlanWindowResult = z.infer<typeof storyPlanWindowResultSchema>;
export type StoryPlanWindowSummary = {
  window: StoryPlanWindow;
  itemCount: number;
};

export const storyImportantFactSchema = z
  .object({
    id: storyStableIdSchema,
    text: boundedString(1_000),
    importance: storyThreadImportanceSchema,
    introducedChapter: z.number().int().min(1).max(200),
    lastConfirmedChapter: z.number().int().min(1).max(200),
    status: z.enum(['ACTIVE', 'SUPERSEDED']).default('ACTIVE'),
  })
  .strict();
export type StoryImportantFact = z.infer<typeof storyImportantFactSchema>;

export const storyImportantEventSchema = z
  .object({
    id: storyStableIdSchema,
    chapterNumber: z.number().int().min(1).max(200),
    type: boundedString(120),
    description: boundedString(2_000),
    importance: storyThreadImportanceSchema,
    characterIds: z.array(storyStableIdSchema).max(100),
    threadIds: z.array(storyStableIdSchema).max(100),
  })
  .strict();
export type StoryImportantEvent = z.infer<typeof storyImportantEventSchema>;

export const storyCharacterStateUpdateSchema = storyCharacterStateSchema
  .omit({ lastUpdatedChapter: true })
  .extend({
    characterId: storyStableIdSchema,
    location: boundedString(500).nullable().optional(),
    currentGoal: boundedString(1_000).nullable().optional(),
    powerLevel: boundedString(120).nullable().optional(),
    injuries: boundedStringArray(30, 300).optional(),
    possessions: boundedStringArray(50, 300).optional(),
    relationships: z.array(characterRelationshipSchema).max(50).optional(),
    knowledge: boundedStringArray(100, 300).optional(),
  })
  .strict();
export type StoryCharacterStateUpdate = z.infer<typeof storyCharacterStateUpdateSchema>;

export const storyThreadUpdateSchema = z
  .object({
    threadId: storyStableIdSchema,
    status: storyThreadStatusSchema.optional(),
    title: boundedString(200).optional(),
    description: boundedString(2_000).optional(),
    type: storyThreadTypeSchema.optional(),
    importance: storyThreadImportanceSchema.optional(),
    characterIds: z.array(storyStableIdSchema).max(100).optional(),
    expectedResolutionStart: z.number().int().min(1).max(200).nullable().optional(),
    expectedResolutionEnd: z.number().int().min(1).max(200).nullable().optional(),
    note: boundedString(2_000).optional(),
  })
  .strict();
export type StoryThreadUpdate = z.infer<typeof storyThreadUpdateSchema>;

export const storyNewThreadSchema = z
  .object({
    id: storyStableIdSchema,
    title: boundedString(200),
    description: boundedString(2_000),
    type: storyThreadTypeSchema,
    status: storyThreadStatusSchema.default('OPEN'),
    importance: storyThreadImportanceSchema.default('MEDIUM'),
    characterIds: z.array(storyStableIdSchema).max(100),
    expectedResolutionStart: z.number().int().min(1).max(200).nullable().default(null),
    expectedResolutionEnd: z.number().int().min(1).max(200).nullable().default(null),
  })
  .strict();
export type StoryNewThread = z.infer<typeof storyNewThreadSchema>;

export const storyArcProgressSchema = z
  .object({
    arcId: storyStableIdSchema,
    status: storyArcStatusSchema.optional(),
    note: boundedString(1_000).optional(),
  })
  .strict();
export type StoryArcProgress = z.infer<typeof storyArcProgressSchema>;

export const storyGapMarkerSchema = z
  .object({
    chapterNumber: z.number().int().min(1).max(200),
    reason: boundedString(500),
  })
  .strict();
export type StoryGapMarker = z.infer<typeof storyGapMarkerSchema>;

export const storyStateDeltaSchema = z
  .object({
    characterUpdates: z.array(storyCharacterStateUpdateSchema).max(100).default([]),
    threadUpdates: z.array(storyThreadUpdateSchema).max(100).default([]),
    newThreads: z.array(storyNewThreadSchema).max(50).default([]),
    facts: z.array(storyImportantFactSchema).max(50).default([]),
    events: z.array(storyImportantEventSchema).max(100).default([]),
    arcProgress: z.array(storyArcProgressSchema).max(50).default([]),
    gapMarkers: z.array(storyGapMarkerSchema).max(50).default([]),
  })
  .strict();
export type StoryStateDelta = z.infer<typeof storyStateDeltaSchema>;

export const storyStateSchema = z
  .object({
    projectId: z.string().trim().min(1).max(80),
    revision: z.number().int().positive(),
    currentChapter: z.number().int().min(0).max(200),
    rollingProgressSummary: boundedString(4_000),
    currentArcId: storyStableIdSchema.nullable(),
    currentPhase: boundedString(200),
    characterStates: z.array(storyCharacterStateSchema).max(100),
    threads: z.array(storyThreadSchema).max(200),
    importantFacts: z.array(storyImportantFactSchema).max(200),
    recentEvents: z.array(storyImportantEventSchema).max(100),
    gapMarkers: z.array(storyGapMarkerSchema).max(50),
    sourceChapterId: z.string().trim().min(1).max(80).nullable(),
    sourceChapterRevision: z.number().int().positive().nullable(),
    previousRevision: z.number().int().positive().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type StoryState = z.infer<typeof storyStateSchema>;
export const continuityStatusSchema = z.enum(['CURRENT', 'CONTINUITY_STALE', 'NOT_ANALYZED']);
export type ContinuityStatus = z.infer<typeof continuityStatusSchema>;
export const continuityCheckStatusSchema = z.enum(['PASS', 'WARN', 'FAIL']);
export type ContinuityCheckStatus = z.infer<typeof continuityCheckStatusSchema>;
export const continuityIssueSchema = z
  .object({
    type: boundedString(80),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    message: boundedString(1_000),
    characterIds: z.array(storyStableIdSchema).max(20).default([]),
    threadIds: z.array(storyStableIdSchema).max(20).default([]),
  })
  .strict();
export type ContinuityIssue = z.infer<typeof continuityIssueSchema>;
export const continuityCheckResultSchema = z
  .object({
    status: continuityCheckStatusSchema,
    issues: z.array(continuityIssueSchema).max(50),
  })
  .strict();
export type ContinuityCheckResult = z.infer<typeof continuityCheckResultSchema>;

export const chapterGenerationV2EnvelopeSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(2_000_000),
    summary: chapterSummarySchema,
    stateDelta: storyStateDeltaSchema,
    usedCharacterIds: z.array(storyStableIdSchema).max(100),
    introducedCharacterIds: z.array(storyStableIdSchema).max(100),
    unresolvedThreadIds: z.array(storyStableIdSchema).max(100),
    continuityWarnings: boundedStringArray(50, 2_000),
  })
  .strict();
export type ChapterGenerationV2Envelope = z.infer<typeof chapterGenerationV2EnvelopeSchema>;

export const manualChapterAnalysisSchema = z
  .object({
    summary: chapterSummarySchema,
    stateDelta: storyStateDeltaSchema,
    continuity: continuityCheckResultSchema,
  })
  .strict();
export type ManualChapterAnalysis = z.infer<typeof manualChapterAnalysisSchema>;

export const storyGenerationBatchModeSchema = z.enum(['NEXT', 'RANGE', 'UNTIL_END']);
export type StoryGenerationBatchMode = z.infer<typeof storyGenerationBatchModeSchema>;
export const storyGenerationBatchStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
]);
export type StoryGenerationBatchStatus = z.infer<typeof storyGenerationBatchStatusSchema>;
export const storyGenerationBatchItemOutcomeSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);
export type StoryGenerationBatchItemOutcome = z.infer<typeof storyGenerationBatchItemOutcomeSchema>;
export const storyGenerationBatchRequestSchema = z
  .object({
    mode: storyGenerationBatchModeSchema,
    count: z.number().int().min(1).max(200).optional(),
    startChapter: z.number().int().min(1).max(200).optional(),
    endChapter: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'RANGE') {
      if (value.startChapter === undefined || value.endChapter === undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['startChapter'],
          message: 'RANGE batches require startChapter and endChapter',
        });
      if (value.count !== undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['count'],
          message: 'RANGE batches do not accept count',
        });
    } else if (value.mode === 'NEXT' && value.count === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['count'],
        message: 'NEXT batches require count',
      });
    } else if (value.mode === 'UNTIL_END' && value.count !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['count'],
        message: 'UNTIL_END batches do not accept count',
      });
    }
    if (
      value.mode !== 'RANGE' &&
      (value.startChapter !== undefined || value.endChapter !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startChapter'],
        message: 'Only RANGE batches accept explicit chapter bounds',
      });
    }
    if (
      value.startChapter !== undefined &&
      value.endChapter !== undefined &&
      value.startChapter > value.endChapter
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endChapter'],
        message: 'endChapter must be greater than or equal to startChapter',
      });
  });
export type StoryGenerationBatchRequest = z.infer<typeof storyGenerationBatchRequestSchema>;

export const storyContinuityRebuildRequestSchema = z
  .object({ fromChapter: z.number().int().min(1).max(200) })
  .strict();
export type StoryContinuityRebuildRequest = z.infer<typeof storyContinuityRebuildRequestSchema>;
export const storyPlanWindowRequestSchema = z
  .object({
    arcId: storyStableIdSchema,
    startChapter: z.number().int().min(1).max(200),
    endChapter: z.number().int().min(1).max(200),
  })
  .strict()
  .refine((value) => value.startChapter <= value.endChapter, {
    path: ['endChapter'],
    message: 'endChapter must be greater than or equal to startChapter',
  });
export type StoryPlanWindowRequest = z.infer<typeof storyPlanWindowRequestSchema>;
export const storyGenerationBatchSkipRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type StoryGenerationBatchSkipRequest = z.infer<typeof storyGenerationBatchSkipRequestSchema>;
export const storyGenerationBatchSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().trim().min(1).max(80),
    startChapter: z.number().int().min(1).max(200),
    endChapter: z.number().int().min(1).max(200),
    mode: storyGenerationBatchModeSchema,
    status: storyGenerationBatchStatusSchema,
    total: z.number().int().min(0).max(200),
    completed: z.number().int().min(0).max(200),
    failed: z.number().int().min(0).max(200),
    skipped: z.number().int().min(0).max(200),
    error: z.string().max(2_000).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type StoryGenerationBatch = z.infer<typeof storyGenerationBatchSchema>;

export const storyGenerationBatchItemSchema = z
  .object({
    id: z.string().uuid(),
    batchId: z.string().uuid(),
    projectId: z.string().trim().min(1).max(80),
    chapterNumber: z.number().int().min(1).max(200),
    planItemId: storyStableIdSchema,
    workflowStepId: z.string().uuid(),
    outcome: storyGenerationBatchItemOutcomeSchema,
    inputFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    error: z.string().max(2_000).nullable(),
    skipReason: z.string().max(500).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type StoryGenerationBatchItem = z.infer<typeof storyGenerationBatchItemSchema>;
export const aiUsageSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().trim().min(1).max(80),
    operation: generationOperationSchema,
    entityId: z.string().max(120),
    attempt: z.number().int().min(1),
    provider: boundedString(120).nullable(),
    model: boundedString(200).nullable(),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    durationMs: z.number().int().min(0).nullable(),
    costUsd: z.number().min(0).nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']),
    createdAt: z.string().datetime(),
  })
  .strict();
export type AiUsage = z.infer<typeof aiUsageSchema>;

export const generationContextDiagnosticsSchema = z
  .object({
    estimatedTokens: z.number().int().min(0),
    budget: z.number().int().min(500).max(10_000),
    selectedCharacterCount: z.number().int().min(0).max(100),
    selectedThreadCount: z.number().int().min(0).max(200),
    recentSummariesIncluded: z.number().int().min(0).max(200),
    selectedSections: boundedStringArray(100, 120),
    omittedSections: boundedStringArray(100, 200),
    truncationReasons: boundedStringArray(100, 200),
    sourceRevisions: boundedStringArray(50, 120),
    selectionReasons: z.record(z.string().max(200)).default({}),
  })
  .strict();
export type GenerationContextDiagnostics = z.infer<typeof generationContextDiagnosticsSchema>;
export type StoryContextDiagnostic = {
  id: string;
  projectId: string;
  operation: GenerationOperation;
  targetId: string;
  status: string;
  contextDiagnostics: GenerationContextDiagnostics | null;
  sourceRevisions: string[];
  createdAt: string;
};
