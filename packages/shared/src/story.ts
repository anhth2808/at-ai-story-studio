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
  })
  .strict();
export type StoryGenerationSettings = z.infer<typeof storyGenerationSettingsSchema>;

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
export type StorySettings = z.infer<typeof storySettingsSchema>;

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

export const storyThreadSchema = z
  .object({
    id: storyStableIdSchema,
    description: boundedString(2_000),
    status: z.enum(['OPEN', 'RESOLVED']),
    characterIds: z.array(storyStableIdSchema).max(100),
    introducedChapter: z.number().int().min(1).max(200).nullable(),
    resolvedChapter: z.number().int().min(1).max(200).nullable(),
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
    status: z.enum(['OPEN', 'RESOLVED']),
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
    attempt: z.number().int().min(1),
    contextHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    omittedContext: boundedStringArray(100, 200).default([]),
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

export function parseStoryOperationOutput(
  operation: GenerationOperation,
  text: string,
): StoryBlueprint | ChapterPlan | ChapterGenerationEnvelope | ChapterSummary {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Story model output must be JSON');
  }
  if (operation === 'BLUEPRINT') return storyBlueprintSchema.parse(value);
  if (operation === 'CHAPTER_PLANS') return chapterPlanSchema.parse(value);
  if (operation === 'CHAPTER') return chapterGenerationEnvelopeSchema.parse(value);
  return chapterSummarySchema.parse(value);
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
      'TIMEOUT',
      'CANCELLED',
      'PROTOCOL_ERROR',
      'HOST_ERROR',
    ]),
    message: z.string().max(500),
    retryable: z.boolean(),
  })
  .strict();
export type OmpProtocolError = z.infer<typeof ompProtocolErrorSchema>;

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
export type StorySnapshotDto = {
  settings: StorySettingsDto | null;
  blueprint: StoryBlueprintDto | null;
  plan: StoryPlanDto | null;
  summaries: StorySummaryDto[];
  threads: StoryThread[];
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
