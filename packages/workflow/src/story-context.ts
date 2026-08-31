import { createHash } from 'node:crypto';
import {
  AppError,
  generationContextDiagnosticsSchema,
  storyCharacterStateSchema,
  type ChapterPlanItem,
  type ChapterSummary,
  type GenerationContextDiagnostics,
  type StoryArc,
  type StoryBlueprint,
  type StoryCharacterState,
  type StoryImportantEvent,
  type StoryImportantFact,
  type StoryState,
  type StoryThread,
} from '@studio/shared';

export type SummaryContextItem = {
  chapterNumber: number;
  revision: number;
  summary: ChapterSummary;
};

export type GenerationContextInput = {
  blueprint: StoryBlueprint | null;
  selectedCharacterIds?: string[];
  planItem?: ChapterPlanItem | null;
  priorSummaries?: SummaryContextItem[];
  relevantFacts?: string[];
  openThreads?: StoryThread[];
  instructions?: string[];
  missingContext?: string[];
  budget?: number;
};

export type BoundedGenerationContext = {
  budget: number;
  estimatedTokens: number;
  sections: Array<{ name: string; content: string }>;
  omittedContext: string[];
  inputFingerprint: string;
  diagnostics?: GenerationContextDiagnostics;
  sourceRevisions?: string[];
};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableValue(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

const importanceRank: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const threadImportanceRank: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 10,
  MEDIUM: 50,
  HIGH: 100,
};

function boundedContent(
  value: unknown,
  maxTokens: number,
): { content: string; truncated: boolean } {
  const serialized = stableValue(value);
  const maxChars = Math.max(0, maxTokens * 4);
  if (serialized.length <= maxChars) return { content: serialized, truncated: false };
  if (maxChars < 16) return { content: '', truncated: true };
  return { content: `${serialized.slice(0, maxChars - 15)}...[truncated]`, truncated: true };
}

function selectedCharacters(blueprint: StoryBlueprint | null, ids: string[]): unknown[] {
  if (!blueprint) return [];
  const selected = new Set(ids);
  return blueprint.characters
    .filter((character) => selected.size === 0 || selected.has(character.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function compileGenerationContext(input: GenerationContextInput): BoundedGenerationContext {
  const budget = input.budget ?? 5_000;
  if (!Number.isInteger(budget) || budget < 500 || budget > 10_000)
    throw new Error('Generation context budget must be between 500 and 10000 tokens');
  const omittedContext: string[] = [
    ...new Set((input.missingContext ?? []).map((item) => `missing:${item}`)),
  ];
  const sections: Array<{ name: string; content: string }> = [];
  let remaining = budget;
  const add = (name: string, value: unknown, required = false): void => {
    if (remaining <= 0) {
      omittedContext.push(name);
      return;
    }
    const bounded = boundedContent(value, remaining);
    if (!bounded.content && !required) {
      omittedContext.push(name);
      return;
    }
    sections.push({ name, content: bounded.content });
    remaining = Math.max(0, remaining - estimateTokens(bounded.content));
    if (bounded.truncated) omittedContext.push(`${name}:truncated`);
  };

  const blueprint = input.blueprint
    ? {
        premise: input.blueprint.premise,
        themes: [...input.blueprint.themes].sort(),
        worldRules: [...input.blueprint.worldRules].sort(),
        continuityConstraints: [...input.blueprint.continuityConstraints].sort(),
        plotDirection: input.blueprint.plotDirection,
      }
    : null;
  add('blueprint', blueprint, true);
  add(
    'selected-characters',
    selectedCharacters(input.blueprint, [...(input.selectedCharacterIds ?? [])]),
  );
  add('plan-item', input.planItem ?? null, Boolean(input.planItem));
  add(
    'open-threads',
    [...(input.openThreads ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
  );
  add(
    'prior-summaries',
    [...(input.priorSummaries ?? [])].sort(
      (left, right) => left.chapterNumber - right.chapterNumber,
    ),
  );
  add('relevant-facts', [...(input.relevantFacts ?? [])].sort());
  add('instructions', [...(input.instructions ?? [])]);

  const withoutFingerprint = { budget, sections, omittedContext };
  return {
    ...withoutFingerprint,
    estimatedTokens: sections.reduce(
      (total, section) => total + estimateTokens(section.content),
      0,
    ),
    inputFingerprint: createHash('sha256').update(stableValue(withoutFingerprint)).digest('hex'),
  };
}

export type GenerationContextV2Input = {
  blueprint: StoryBlueprint;
  state: StoryState;
  planItem: ChapterPlanItem;
  arc?: StoryArc | null;
  priorSummaries?: SummaryContextItem[];
  characterStates?: StoryCharacterState[];
  threads?: StoryThread[];
  facts?: StoryImportantFact[];
  events?: StoryImportantEvent[];
  instructions?: string[];
  budget: number;
  sourceRevisions?: string[];
};

type ContextCandidate = {
  name: string;
  value: unknown;
  priority: number;
  required: boolean;
  reason: string;
  sourceRevision?: string;
};

function compactBlueprint(blueprint: StoryBlueprint): unknown {
  return {
    premise: blueprint.premise,
    themes: [...blueprint.themes].sort(),
    worldRules: [...blueprint.worldRules].sort(),
    continuityConstraints: [...blueprint.continuityConstraints].sort(),
    plotDirection: blueprint.plotDirection,
  };
}

function activeThread(thread: StoryThread): boolean {
  return thread.status === 'OPEN' || thread.status === 'PROGRESSING';
}

function threadScore(
  thread: StoryThread,
  planItem: ChapterPlanItem,
  chapterNumber: number,
): number {
  const explicit = planItem.threadIds.includes(thread.id) ? 1_000 : 0;
  const activity = activeThread(thread) ? 300 : 0;
  const importance = threadImportanceRank[thread.importance ?? 'MEDIUM'];
  const proximity =
    thread.expectedResolutionEnd === undefined || thread.expectedResolutionEnd === null
      ? 0
      : Math.max(0, 100 - Math.abs(thread.expectedResolutionEnd - chapterNumber));
  return explicit + activity + importance + proximity + (thread.lastTouchedChapter ?? 0) / 1_000;
}

function candidateTokens(value: unknown): number {
  return estimateTokens(stableValue(value));
}
function transformForBudget(value: unknown, stringLimit: number, arrayLimit: number): unknown {
  if (typeof value === 'string')
    return value.length > stringLimit ? value.slice(0, stringLimit) : value;
  if (Array.isArray(value))
    return value
      .slice(0, arrayLimit)
      .map((item) => transformForBudget(item, stringLimit, arrayLimit));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        transformForBudget(nested, stringLimit, arrayLimit),
      ]),
    );
  return value;
}

function maxLeafStringLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return Math.max(0, ...value.map(maxLeafStringLength));
  if (value && typeof value === 'object')
    return Math.max(0, ...Object.values(value as Record<string, unknown>).map(maxLeafStringLength));
  return 0;
}

function maxArrayLength(value: unknown): number {
  if (Array.isArray(value)) return Math.max(value.length, ...value.map(maxArrayLength));
  if (value && typeof value === 'object')
    return Math.max(0, ...Object.values(value as Record<string, unknown>).map(maxArrayLength));
  return 0;
}

function boundedStructuredContent(
  value: unknown,
  maxTokens: number,
): { content: string; truncated: boolean } {
  const original = stableValue(value);
  const maxChars = maxTokens * 4;
  if (original.length <= maxChars) return { content: original, truncated: false };
  if (maxChars < 2) return { content: '', truncated: true };
  const parsed = JSON.parse(original) as unknown;
  const highestString = maxLeafStringLength(parsed);
  const highestArray = maxArrayLength(parsed);
  const serialize = (stringLimit: number, arrayLimit: number): string =>
    stableValue(transformForBudget(parsed, stringLimit, arrayLimit));
  const fits = (stringLimit: number, arrayLimit: number): string | null => {
    const serialized = serialize(stringLimit, arrayLimit);
    return serialized.length <= maxChars ? serialized : null;
  };
  let compacted: string | null = fits(highestString, highestArray);
  if (!compacted) {
    compacted = fits(0, highestArray);
    if (compacted) {
      let low = 0;
      let high = highestString;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(middle, highestArray)) low = middle;
        else high = middle - 1;
      }
      compacted = fits(low, highestArray);
    }
  }
  if (!compacted) {
    let low = 0;
    let high = highestArray;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(0, middle)) low = middle;
      else high = middle - 1;
    }
    compacted = fits(0, low);
  }
  if (!compacted) {
    const marker = '{"truncated":true}';
    compacted = marker.length <= maxChars ? marker : '{}';
  }
  return { content: compacted, truncated: true };
}

export function compileGenerationContextV2(
  input: GenerationContextV2Input,
): BoundedGenerationContext {
  if (!Number.isInteger(input.budget) || input.budget < 500 || input.budget > 10_000)
    throw new AppError(
      'CONTEXT_ERROR',
      'Generation context budget must be between 500 and 10000 tokens',
      422,
    );
  const previousSummaries = [...(input.priorSummaries ?? [])]
    .filter((summary) => summary.chapterNumber < input.planItem.chapterNumber)
    .sort(
      (left, right) => right.chapterNumber - left.chapterNumber || right.revision - left.revision,
    );
  const previousSummary = previousSummaries[0];
  const recentSummaries = previousSummaries
    .slice(1, 6)
    .sort((left, right) => left.chapterNumber - right.chapterNumber);
  const stateCharacters = new Map(
    (input.characterStates ?? input.state.characterStates).map((character) => [
      character.characterId,
      character,
    ]),
  );
  const stateThreads = input.threads ?? input.state.threads;
  const stateFacts = input.facts ?? input.state.importantFacts;
  const stateEvents = input.events ?? input.state.recentEvents;
  const recentParticipantIds = new Set<string>();
  for (const summary of previousSummaries.slice(0, 6)) {
    for (const change of summary.summary.characterStateChanges)
      recentParticipantIds.add(change.characterId);
  }
  for (const event of stateEvents.slice(0, 12))
    for (const characterId of event.characterIds) recentParticipantIds.add(characterId);
  const selectedCharacterIds = new Set([
    ...input.planItem.characterIds,
    ...recentParticipantIds,
    ...stateThreads
      .filter((thread) => activeThread(thread) || input.planItem.threadIds.includes(thread.id))
      .flatMap((thread) => thread.characterIds),
  ]);
  const blueprintCharacters = input.blueprint.characters.filter((character) =>
    selectedCharacterIds.has(character.id),
  );
  const candidates: ContextCandidate[] = [
    {
      name: 'plan-item',
      value: input.planItem,
      priority: 10_000,
      required: true,
      reason: 'current chapter plan',
      sourceRevision: `plan-item:${input.planItem.id}`,
    },
    {
      name: 'blueprint',
      value: compactBlueprint(input.blueprint),
      priority: 9_900,
      required: true,
      reason: 'global blueprint essentials',
      sourceRevision: 'blueprint',
    },
    {
      name: 'rolling-state',
      value: {
        currentChapter: input.state.currentChapter,
        currentArcId: input.state.currentArcId,
        currentPhase: input.state.currentPhase,
        rollingProgressSummary: input.state.rollingProgressSummary,
        gapMarkers: input.state.gapMarkers,
      },
      priority: 9_800,
      required: true,
      reason: 'canonical checkpoint and visible gaps',
      sourceRevision: `state:${input.state.revision}`,
    },
  ];
  if (previousSummary)
    candidates.push({
      name: 'previous-summary',
      value: previousSummary,
      priority: 9_700,
      required: true,
      reason: 'immediately previous accepted chapter',
      sourceRevision: `summary:${previousSummary.chapterNumber}:${previousSummary.revision}`,
    });
  const selectedThreads = [...stateThreads]
    .filter(
      (thread) =>
        activeThread(thread) ||
        input.planItem.threadIds.includes(thread.id) ||
        (thread.status === 'RESOLVED' && input.planItem.threadIds.includes(thread.id)),
    )
    .sort(
      (left, right) =>
        threadScore(right, input.planItem, input.planItem.chapterNumber) -
          threadScore(left, input.planItem, input.planItem.chapterNumber) ||
        left.id.localeCompare(right.id),
    );
  if (selectedThreads.length)
    candidates.push({
      name: 'relevant-threads',
      value: selectedThreads,
      priority: 9_600,
      required: true,
      reason: 'active or explicitly planned thread',
      sourceRevision: `threads:${input.state.revision}`,
    });
  const selectedStates = blueprintCharacters
    .map(
      (character) =>
        stateCharacters.get(character.id) ??
        storyCharacterStateSchema.parse({ characterId: character.id }),
    )
    .sort((left, right) => left.characterId.localeCompare(right.characterId));
  if (blueprintCharacters.length)
    candidates.push({
      name: 'relevant-characters',
      value: blueprintCharacters,
      priority: 9_500,
      required: true,
      reason: 'planned or recently participating character definitions',
      sourceRevision: 'blueprint-characters',
    });
  if (selectedStates.length)
    candidates.push({
      name: 'character-state',
      value: selectedStates,
      priority: 9_400,
      required: true,
      reason: 'current dynamic character state',
      sourceRevision: `character-state:${input.state.revision}`,
    });
  if (input.arc)
    candidates.push({
      name: 'current-arc',
      value: input.arc,
      priority: 9_300,
      required: true,
      reason: 'current arc direction and outcome',
      sourceRevision: `arc:${input.arc.id}`,
    });
  if (recentSummaries.length)
    candidates.push({
      name: 'recent-summaries',
      value: recentSummaries,
      priority: 8_000,
      required: false,
      reason: 'recent chapter participation window',
      sourceRevision: `summaries:${input.state.revision}`,
    });
  const relevantFacts = [...stateFacts]
    .sort(
      (left, right) =>
        importanceRank[right.importance] - importanceRank[left.importance] ||
        right.lastConfirmedChapter - left.lastConfirmedChapter ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 50);
  if (relevantFacts.length)
    candidates.push({
      name: 'important-facts',
      value: relevantFacts,
      priority: 7_000,
      required: false,
      reason: 'high-importance canonical facts',
      sourceRevision: `facts:${input.state.revision}`,
    });
  if (stateEvents.length)
    candidates.push({
      name: 'recent-events',
      value: [...stateEvents].sort(
        (left, right) =>
          right.chapterNumber - left.chapterNumber || left.id.localeCompare(right.id),
      ),
      priority: 6_000,
      required: false,
      reason: 'recent canonical events',
      sourceRevision: `events:${input.state.revision}`,
    });
  if ((input.instructions ?? []).length)
    candidates.push({
      name: 'instructions',
      value: input.instructions,
      priority: 5_000,
      required: false,
      reason: 'explicit user instructions',
    });
  candidates.sort(
    (left, right) => right.priority - left.priority || left.name.localeCompare(right.name),
  );
  const sections: Array<{ name: string; content: string }> = [];
  const omittedContext: string[] = [];
  const truncationReasons: string[] = [];
  const selectionReasons: Record<string, string> = {};
  const sourceRevisions = [
    ...new Set([
      ...(input.sourceRevisions ?? []),
      ...candidates.flatMap((candidate) =>
        candidate.sourceRevision ? [candidate.sourceRevision] : [],
      ),
    ]),
  ].sort();
  let remaining = input.budget;
  let requiredRemaining = candidates.filter((candidate) => candidate.required).length;
  let selectedCharacterCount = 0;
  let selectedThreadCount = 0;
  let recentSummariesIncluded = 0;
  for (const candidate of candidates) {
    const content = stableValue(candidate.value);
    const tokens = candidateTokens(candidate.value);
    const reserveForRequired = candidate.required ? Math.max(0, requiredRemaining - 1) * 16 : 0;
    const available = candidate.required ? Math.max(0, remaining - reserveForRequired) : remaining;
    if (candidate.required) {
      requiredRemaining -= 1;
      if (available <= 0)
        throw new AppError(
          'CONTEXT_ERROR',
          `Required context section does not fit: ${candidate.name}`,
          422,
        );
    } else if (available <= 0 || tokens > available) {
      omittedContext.push(candidate.name);
      truncationReasons.push(`${candidate.name}:budget`);
      selectionReasons[candidate.name] = `omitted: ${candidate.reason}; budget`;
      continue;
    }
    const bounded =
      candidate.required && tokens > available
        ? boundedStructuredContent(candidate.value, available)
        : { content, truncated: false };
    if (!bounded.content) {
      if (candidate.required)
        throw new AppError(
          'CONTEXT_ERROR',
          `Required context section does not fit: ${candidate.name}`,
          422,
        );
      omittedContext.push(candidate.name);
      truncationReasons.push(`${candidate.name}:budget`);
      selectionReasons[candidate.name] = `omitted: ${candidate.reason}; budget`;
      continue;
    }
    sections.push({ name: candidate.name, content: bounded.content });
    selectionReasons[candidate.name] = `selected: ${candidate.reason}`;
    remaining = Math.max(0, remaining - estimateTokens(bounded.content));
    if (bounded.truncated) {
      omittedContext.push(`${candidate.name}:truncated`);
      truncationReasons.push(`${candidate.name}:required-context-compression`);
    }
    if (candidate.name === 'relevant-characters')
      selectedCharacterCount = blueprintCharacters.length;
    if (candidate.name === 'relevant-threads') selectedThreadCount = selectedThreads.length;
    if (candidate.name === 'recent-summaries') recentSummariesIncluded = recentSummaries.length;
  }
  const diagnostics = generationContextDiagnosticsSchema.parse({
    estimatedTokens: input.budget - remaining,
    budget: input.budget,
    selectedCharacterCount,
    selectedThreadCount,
    recentSummariesIncluded,
    selectedSections: sections.map((section) => section.name),
    omittedSections: omittedContext,
    truncationReasons,
    sourceRevisions,
    selectionReasons,
  });
  const withoutFingerprint = { budget: input.budget, sections, omittedContext, diagnostics };
  return {
    ...withoutFingerprint,
    estimatedTokens: diagnostics.estimatedTokens,
    inputFingerprint: createHash('sha256').update(stableValue(withoutFingerprint)).digest('hex'),
    diagnostics,
    sourceRevisions,
  };
}
