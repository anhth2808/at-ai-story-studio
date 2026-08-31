import {
  AppError,
  storyCharacterStateSchema,
  storyImportantEventSchema,
  storyImportantFactSchema,
  storyStateDeltaSchema,
  storyStateSchema,
  storyThreadSchema,
  type ChapterSummary,
  type StoryArc,
  type StoryBlueprint,
  type StoryImportantEvent,
  type StoryImportantFact,
  type StoryState,
  type StoryStateDelta,
  type StoryThread,
} from '@studio/shared';

export type StoryStateReductionInput = {
  projectId: string;
  chapterNumber: number;
  sourceChapterId?: string | null;
  sourceChapterRevision?: number | null;
  blueprint: StoryBlueprint;
  arcs?: StoryArc[];
  chapterSummary?: ChapterSummary;
  maxRecentEvents?: number;
};

export type StoryStateReduction = {
  state: StoryState;
  threads: StoryThread[];
  facts: StoryImportantFact[];
  events: StoryImportantEvent[];
};

const importanceRank: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};
const threadStatusRank: Record<'OPEN' | 'PROGRESSING' | 'RESOLVED' | 'ABANDONED', number> = {
  OPEN: 1,
  PROGRESSING: 2,
  RESOLVED: 3,
  ABANDONED: 3,
};

function validationError(message: string): AppError {
  return new AppError('STRUCTURED_OUTPUT_ERROR', message, 422, true);
}

function canonicalValue(value: unknown): string {
  return JSON.stringify(value);
}

function nextThreadStatus(
  current: StoryThread['status'],
  requested: StoryThread['status'],
): StoryThread['status'] {
  const currentRank = threadStatusRank[current];
  const requestedRank = threadStatusRank[requested];
  if (currentRank >= 3 && requestedRank < 3) return current;
  return requestedRank > currentRank ? requested : current;
}

function normalizeThread(thread: StoryThread, chapterNumber: number): StoryThread {
  return storyThreadSchema.parse({
    ...thread,
    title: thread.title ?? thread.id,
    type: thread.type ?? 'GOAL',
    importance: thread.importance ?? 'MEDIUM',
    lastTouchedChapter: thread.lastTouchedChapter ?? chapterNumber,
    expectedResolutionStart: thread.expectedResolutionStart ?? null,
    expectedResolutionEnd: thread.expectedResolutionEnd ?? null,
    abandonedChapter:
      thread.abandonedChapter ?? (thread.status === 'ABANDONED' ? chapterNumber : null),
  });
}

function compactSummary(
  prior: string,
  chapterRecap: string,
  facts: StoryImportantFact[],
  events: StoryImportantEvent[],
  maxLength = 4_000,
): string {
  const highFacts = facts
    .filter((fact) => fact.importance === 'HIGH' && fact.status === 'ACTIVE')
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 12)
    .map((fact) => `Fact ${fact.id}: ${fact.text}`);
  const recentEvents = [...events]
    .sort(
      (left, right) => right.chapterNumber - left.chapterNumber || left.id.localeCompare(right.id),
    )
    .slice(0, 12)
    .map((event) => `Event ${event.id}: ${event.description}`);
  return [prior.trim(), `Latest: ${chapterRecap.trim()}`, ...highFacts, ...recentEvents]
    .filter(Boolean)
    .join('\n')
    .slice(0, maxLength);
}

export function reduceStoryState(
  previousInput: StoryState,
  deltaInput: StoryStateDelta,
  input: StoryStateReductionInput,
): StoryStateReduction {
  const previous = storyStateSchema.parse(previousInput);
  const delta = storyStateDeltaSchema.parse(deltaInput);
  const blueprintCharacterIds = new Set(
    input.blueprint.characters.map((character) => character.id),
  );
  const characters = new Map(
    previous.characterStates.map((character) => [character.characterId, character]),
  );
  const threads = new Map(
    previous.threads.map((thread) => [thread.id, normalizeThread(thread, previous.currentChapter)]),
  );
  const facts = new Map(previous.importantFacts.map((fact) => [fact.id, fact]));
  const events = new Map(previous.recentEvents.map((event) => [event.id, event]));

  for (const update of [...delta.characterUpdates].sort((left, right) =>
    left.characterId.localeCompare(right.characterId),
  )) {
    if (!blueprintCharacterIds.has(update.characterId))
      throw validationError(`Unknown character reference: ${update.characterId}`);
    const current =
      characters.get(update.characterId) ??
      storyCharacterStateSchema.parse({ characterId: update.characterId });
    characters.set(
      update.characterId,
      storyCharacterStateSchema.parse({
        ...current,
        ...update,
        lastUpdatedChapter: input.chapterNumber,
      }),
    );
  }

  const threadUpdates = [...delta.threadUpdates].sort(
    (left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      canonicalValue(left).localeCompare(canonicalValue(right)),
  );
  for (const update of threadUpdates) {
    const current = threads.get(update.threadId);
    if (!current) throw validationError(`Unknown thread reference: ${update.threadId}`);
    const nextStatus = nextThreadStatus(current.status, update.status ?? current.status);
    const characterIds = update.characterIds ?? current.characterIds;
    if (characterIds.some((id) => !blueprintCharacterIds.has(id)))
      throw validationError(`Thread ${update.threadId} references an unknown character`);
    const threadFields = {
      title: update.title ?? current.title,
      description: update.description ?? current.description,
      type: update.type ?? current.type,
      importance: update.importance ?? current.importance,
      expectedResolutionStart:
        update.expectedResolutionStart === undefined
          ? current.expectedResolutionStart
          : update.expectedResolutionStart,
      expectedResolutionEnd:
        update.expectedResolutionEnd === undefined
          ? current.expectedResolutionEnd
          : update.expectedResolutionEnd,
    };
    threads.set(
      update.threadId,
      normalizeThread(
        {
          ...current,
          ...threadFields,
          status: nextStatus,
          characterIds,
          resolvedChapter:
            nextStatus === 'RESOLVED' ? input.chapterNumber : current.resolvedChapter,
          abandonedChapter:
            nextStatus === 'ABANDONED' ? input.chapterNumber : current.abandonedChapter,
          lastTouchedChapter: input.chapterNumber,
        },
        input.chapterNumber,
      ),
    );
  }

  for (const threadInput of [...delta.newThreads].sort(
    (left, right) =>
      left.id.localeCompare(right.id) || canonicalValue(left).localeCompare(canonicalValue(right)),
  )) {
    if (threads.has(threadInput.id))
      throw validationError(`New thread duplicates an existing thread: ${threadInput.id}`);
    if (threadInput.characterIds.some((id) => !blueprintCharacterIds.has(id)))
      throw validationError(`New thread ${threadInput.id} references an unknown character`);
    threads.set(
      threadInput.id,
      normalizeThread(
        {
          ...threadInput,
          introducedChapter: input.chapterNumber,
          resolvedChapter: threadInput.status === 'RESOLVED' ? input.chapterNumber : null,
          lastTouchedChapter: input.chapterNumber,
          abandonedChapter: threadInput.status === 'ABANDONED' ? input.chapterNumber : null,
        },
        input.chapterNumber,
      ),
    );
  }

  for (const factInput of [...delta.facts].sort(
    (left, right) =>
      left.id.localeCompare(right.id) || canonicalValue(left).localeCompare(canonicalValue(right)),
  )) {
    const fact = storyImportantFactSchema.parse(factInput);
    const existing = facts.get(fact.id);
    if (
      !existing ||
      fact.lastConfirmedChapter > existing.lastConfirmedChapter ||
      (fact.lastConfirmedChapter === existing.lastConfirmedChapter &&
        canonicalValue(fact).localeCompare(canonicalValue(existing)) > 0)
    )
      facts.set(fact.id, fact);
  }

  for (const eventInput of [...delta.events].sort(
    (left, right) =>
      left.id.localeCompare(right.id) || canonicalValue(left).localeCompare(canonicalValue(right)),
  )) {
    if (eventInput.characterIds.some((id) => !blueprintCharacterIds.has(id)))
      throw validationError(`Event ${eventInput.id} references an unknown character`);
    if (eventInput.threadIds.some((id) => !threads.has(id)))
      throw validationError(`Event ${eventInput.id} references an unknown thread`);
    const event = storyImportantEventSchema.parse(eventInput);
    const existing = events.get(event.id);
    if (
      !existing ||
      event.chapterNumber > existing.chapterNumber ||
      (event.chapterNumber === existing.chapterNumber &&
        canonicalValue(event).localeCompare(canonicalValue(existing)) > 0)
    )
      events.set(event.id, event);
  }
  const arcById = new Map((input.arcs ?? []).map((arc) => [arc.id, arc]));
  for (const progress of delta.arcProgress)
    if (input.arcs && !arcById.has(progress.arcId))
      throw validationError(`Unknown arc reference: ${progress.arcId}`);
  const arcProgress = [...delta.arcProgress].sort((left, right) => {
    const leftArc = arcById.get(left.arcId);
    const rightArc = arcById.get(right.arcId);
    return (
      (leftArc?.ordinalIndex ?? Number.MAX_SAFE_INTEGER) -
        (rightArc?.ordinalIndex ?? Number.MAX_SAFE_INTEGER) ||
      (leftArc?.startChapter ?? Number.MAX_SAFE_INTEGER) -
        (rightArc?.startChapter ?? Number.MAX_SAFE_INTEGER) ||
      left.arcId.localeCompare(right.arcId)
    );
  });
  const currentArc = arcProgress.at(-1);
  const recentEvents = [...events.values()]
    .sort(
      (left, right) =>
        right.chapterNumber - left.chapterNumber ||
        importanceRank[right.importance] - importanceRank[left.importance] ||
        left.id.localeCompare(right.id),
    )
    .slice(0, Math.min(100, Math.max(0, input.maxRecentEvents ?? 100)));
  const normalizedFacts = [...facts.values()].sort(
    (left, right) =>
      right.lastConfirmedChapter - left.lastConfirmedChapter || left.id.localeCompare(right.id),
  );
  const normalizedThreads = [...threads.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const characterStates = [...characters.values()].sort((left, right) =>
    left.characterId.localeCompare(right.characterId),
  );
  const gapMarkers = [
    ...new Map(
      [...previous.gapMarkers, ...delta.gapMarkers].map((marker) => [marker.chapterNumber, marker]),
    ).values(),
  ].sort((left, right) => left.chapterNumber - right.chapterNumber);
  const chapterRecap =
    input.chapterSummary?.recap ??
    delta.events[0]?.description ??
    `Chapter ${input.chapterNumber} accepted`;
  const state = storyStateSchema.parse({
    ...previous,
    revision: previous.revision + 1,
    currentChapter: Math.max(previous.currentChapter, input.chapterNumber),
    currentArcId: currentArc?.arcId ?? previous.currentArcId,
    currentPhase: currentArc?.status ?? previous.currentPhase,
    characterStates,
    threads: normalizedThreads,
    importantFacts: normalizedFacts,
    recentEvents,
    gapMarkers,
    sourceChapterId: input.sourceChapterId ?? null,
    sourceChapterRevision: input.sourceChapterRevision ?? null,
    previousRevision: previous.revision,
    rollingProgressSummary: compactSummary(
      previous.rollingProgressSummary,
      chapterRecap,
      normalizedFacts,
      recentEvents,
    ),
    updatedAt: new Date().toISOString(),
  });
  return { state, threads: normalizedThreads, facts: normalizedFacts, events: recentEvents };
}
