import {
  AppError,
  type ChapterPlanItem,
  type Id,
  type LocationDto,
  type SceneCountRange,
  type SceneDensity,
  type SceneDto,
  type StoryArc,
  type StoryBlueprint,
  type StoryState,
  type VisualStyleSettingsDto,
} from '@studio/shared';
import { ChapterRepository, SceneRepository, StoryRepository } from '@studio/database';

export const SCENE_CONTEXT_MAX_CHARS = 96_000;
export const SCENE_CONTEXT_MAX_TOKENS = 24_000;

type ContextOmission = {
  id: string;
  reason: 'BUDGET' | 'NOT_AVAILABLE' | 'UNRESOLVED';
};

type ContextSelection = {
  selected: string[];
  omitted: ContextOmission[];
  estimatedTokens: number;
};

export type SceneGenerationContext = {
  chapter: {
    id: Id;
    number: number;
    title: string;
    revision: number;
    text: string;
  };
  density: SceneDensity;
  targetRange: SceneCountRange | null;
  planItem: ChapterPlanItem | null;
  blueprint: Pick<
    StoryBlueprint,
    'premise' | 'themes' | 'worldRules' | 'continuityConstraints' | 'plotDirection'
  > | null;
  characters: StoryBlueprint['characters'];
  summary: {
    chapterRevision: number;
    recap: string;
    keyFacts: string[];
    characterStateChanges: Array<{ characterId: string; change: string }>;
    newInformation: string[];
    openThreadIds: string[];
    resolvedThreadIds: string[];
  } | null;
  arc: Pick<
    StoryArc,
    'id' | 'title' | 'startChapter' | 'endChapter' | 'goal' | 'conflict' | 'plannedOutcome'
  > | null;
  characterStates: StoryState['characterStates'];
  activeThreads: StoryState['threads'];
  importantFacts: StoryState['importantFacts'];
  recentEvents: StoryState['recentEvents'];
  priorSummaries: Array<{ chapterNumber: number; revision: number; summary: unknown }>;
  state: StoryState | null;
  style: VisualStyleSettingsDto | null;
  location: LocationDto | null;
  selectedContext: string[];
  omittedContext: ContextOmission[];
  estimatedTokens: number;
  instructions: string[];
  currentScene?: SceneDto;
  neighboringScenes?: SceneDto[];
};

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function selectSection(
  id: string,
  value: unknown,
  budgetTokens: number,
  state: ContextSelection,
): boolean {
  if (value === null || value === undefined) {
    state.omitted.push({ id, reason: 'NOT_AVAILABLE' });
    return false;
  }
  const tokens = estimateTokens(value);
  if (state.estimatedTokens + tokens > budgetTokens) {
    state.omitted.push({ id, reason: 'BUDGET' });
    return false;
  }
  state.selected.push(id);
  state.estimatedTokens += tokens;
  return true;
}

function compactBlueprint(blueprint: StoryBlueprint | null): SceneGenerationContext['blueprint'] {
  if (!blueprint) return null;
  return {
    premise: blueprint.premise,
    themes: blueprint.themes,
    worldRules: blueprint.worldRules,
    continuityConstraints: blueprint.continuityConstraints,
    plotDirection: blueprint.plotDirection,
  };
}

function compactArc(arc: StoryArc | null): SceneGenerationContext['arc'] {
  if (!arc) return null;
  return {
    id: arc.id,
    title: arc.title,
    startChapter: arc.startChapter,
    endChapter: arc.endChapter,
    goal: arc.goal,
    conflict: arc.conflict,
    plannedOutcome: arc.plannedOutcome,
  };
}

function compactState(
  state: StoryState,
  characterIds: Set<string>,
  threadIds: Set<string>,
  chapterNumber: number,
): StoryState {
  return {
    ...state,
    characterStates: state.characterStates.filter((item) => characterIds.has(item.characterId)),
    threads: state.threads.filter(
      (thread) =>
        threadIds.has(thread.id) ||
        (thread.status !== 'RESOLVED' &&
          (thread.lastTouchedChapter ?? thread.introducedChapter ?? 0) >= chapterNumber - 6),
    ),
    importantFacts: state.importantFacts
      .filter((fact) => fact.status === 'ACTIVE')
      .sort((left, right) => {
        const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
        return rank[right.importance] - rank[left.importance];
      })
      .slice(0, 50),
    recentEvents: state.recentEvents
      .filter((event) => event.chapterNumber < chapterNumber)
      .slice(-20),
  };
}

export function buildSceneGenerationContext(input: {
  story: StoryRepository;
  chapters: ChapterRepository;
  scenes: SceneRepository;
  projectId: Id;
  chapterId: Id;
  density: SceneDensity;
  targetRange: SceneCountRange | null;
  style: VisualStyleSettingsDto | null;
  location?: LocationDto | null;
  instructions?: string[];
}): SceneGenerationContext {
  const chapter = input.chapters.get(input.chapterId);
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  if (chapter.content.length > SCENE_CONTEXT_MAX_CHARS)
    throw new AppError(
      'SCENE_CONTEXT_TOO_LARGE',
      'Chapter text exceeds the safe Scene Engine context limit',
      422,
      false,
      `chapterChars=${chapter.content.length};maxChars=${SCENE_CONTEXT_MAX_CHARS}`,
    );
  const chapterTokens = estimateTokens(chapter.content);
  if (chapterTokens > SCENE_CONTEXT_MAX_TOKENS)
    throw new AppError(
      'SCENE_CONTEXT_TOO_LARGE',
      'Chapter text exceeds the safe Scene Engine token limit',
      422,
      false,
      `chapterTokens=${chapterTokens};maxTokens=${SCENE_CONTEXT_MAX_TOKENS}`,
    );

  const settings = input.story.getSettings(input.projectId);
  const budgetTokens = Math.min(
    SCENE_CONTEXT_MAX_TOKENS,
    Math.max(12_000, (settings?.generation.contextBudget ?? 5_000) * 4),
  );
  const selection: ContextSelection = {
    selected: ['chapter:text'],
    omitted: [],
    estimatedTokens: chapterTokens,
  };
  const planItemRecord = chapter.storyPlanItemId
    ? input.story.getPlanItem(input.projectId, chapter.storyPlanItemId)
    : input.story.getPlanItemForChapter(input.projectId, chapter.number);
  const planItem = planItemRecord?.item ?? null;
  const blueprintRecord = input.story.getBlueprint(input.projectId);
  const blueprint = compactBlueprint(blueprintRecord?.blueprint ?? null);
  const currentSummaryRecord = input.story.getSummary(chapter.id);
  const summary =
    currentSummaryRecord?.chapterRevision === chapter.revision
      ? { chapterRevision: currentSummaryRecord.chapterRevision, ...currentSummaryRecord.summary }
      : null;
  const rawState = input.story.getStoryState(input.projectId);
  const arcRecord =
    (rawState.currentArcId ? input.story.getArc(input.projectId, rawState.currentArcId) : null) ??
    input.story
      .getArcs(input.projectId)
      .find(
        (candidate) =>
          candidate.status !== 'STALE' &&
          candidate.startChapter <= chapter.number &&
          candidate.endChapter >= chapter.number,
      ) ??
    null;
  const arc = compactArc(arcRecord);
  const relevantCharacterIds = new Set([
    ...(planItem?.characterIds ?? []),
    ...(summary?.characterStateChanges.map((change) => change.characterId) ?? []),
    ...rawState.recentEvents.flatMap((event) => event.characterIds),
  ]);
  if (blueprintRecord) {
    const chapterText = chapter.content.toLocaleLowerCase('en-US');
    for (const character of blueprintRecord.blueprint.characters) {
      if (chapterText.includes(character.name.toLocaleLowerCase('en-US')))
        relevantCharacterIds.add(character.id);
    }
  }
  const characters =
    blueprintRecord?.blueprint.characters.filter((character) =>
      relevantCharacterIds.has(character.id),
    ) ?? [];
  const relevantThreadIds = new Set([
    ...(planItem?.threadIds ?? []),
    ...(summary?.openThreadIds ?? []),
    ...(summary?.resolvedThreadIds ?? []),
    ...(arcRecord?.importantThreadIds ?? []),
    ...rawState.recentEvents.flatMap((event) => event.threadIds),
  ]);
  const compactedState = compactState(
    rawState,
    relevantCharacterIds,
    relevantThreadIds,
    chapter.number,
  );
  const characterStates = compactedState.characterStates;
  const activeThreads = compactedState.threads;
  const importantFacts = compactedState.importantFacts;
  const recentEvents = compactedState.recentEvents;

  if (chapterTokens > budgetTokens)
    throw new AppError(
      'SCENE_CONTEXT_TOO_LARGE',
      'Chapter text leaves no safe room for required Scene Engine context',
      422,
      false,
      `chapterTokens=${chapterTokens};budgetTokens=${budgetTokens}`,
    );
  const characterContext = characters.map((character) => ({
    character,
    state: characterStates.find((state) => state.characterId === character.id) ?? null,
  }));
  const stateSelected = selectSection('story:state', compactedState, budgetTokens, selection);
  selectSection('chapter:summary', summary, budgetTokens, selection);
  selectSection('chapter:plan-item', planItem, budgetTokens, selection);
  selectSection('story:arc', arc, budgetTokens, selection);
  selectSection('story:blueprint', blueprint, budgetTokens, selection);
  if (characterContext.length)
    selectSection('story:characters', characterContext, budgetTokens, selection);
  else if (blueprintRecord?.blueprint.characters.length)
    selection.omitted.push({ id: 'story:characters', reason: 'UNRESOLVED' });
  selectSection('story:threads', activeThreads, budgetTokens, selection);
  selectSection('story:important-facts', importantFacts, budgetTokens, selection);
  selectSection('story:recent-events', recentEvents, budgetTokens, selection);
  const priorSummaries: SceneGenerationContext['priorSummaries'] = [];
  for (const prior of input.story.getSummaryContext(input.projectId, chapter.number, 6)) {
    const bounded = {
      chapterNumber: prior.chapterNumber,
      revision: prior.revision,
      summary: prior.summary,
    };
    if (selectSection(`summary:chapter-${prior.chapterNumber}`, bounded, budgetTokens, selection))
      priorSummaries.push(bounded);
  }
  selectSection('visual-style:current', input.style, budgetTokens, selection);
  selectSection('location:current', input.location ?? null, budgetTokens, selection);
  const instructions = input.instructions ?? [];
  if (instructions.length)
    selectSection('trusted:instructions', instructions, budgetTokens, selection);

  const selectedInstructions = selection.selected.includes('trusted:instructions')
    ? instructions
    : [];
  return {
    chapter: {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      revision: chapter.revision,
      text: chapter.content,
    },
    density: input.density,
    targetRange: input.targetRange,
    planItem: selection.selected.includes('chapter:plan-item') ? planItem : null,
    blueprint: selection.selected.includes('story:blueprint') ? blueprint : null,
    characters: selection.selected.includes('story:characters') ? characters : [],
    summary: selection.selected.includes('chapter:summary') ? summary : null,
    arc: selection.selected.includes('story:arc') ? arc : null,
    characterStates: stateSelected ? characterStates : [],
    activeThreads: selection.selected.includes('story:threads') ? activeThreads : [],
    importantFacts: selection.selected.includes('story:important-facts') ? importantFacts : [],
    recentEvents: selection.selected.includes('story:recent-events') ? recentEvents : [],
    priorSummaries,
    state: stateSelected ? compactedState : null,
    style: selection.selected.includes('visual-style:current') ? input.style : null,
    location: selection.selected.includes('location:current') ? (input.location ?? null) : null,
    selectedContext: selection.selected,
    omittedContext: selection.omitted,
    estimatedTokens: selection.estimatedTokens,
    instructions: selectedInstructions,
  };
}

export function buildSceneRegenerationContext(input: {
  story: StoryRepository;
  chapters: ChapterRepository;
  scenes: SceneRepository;
  projectId: Id;
  sceneId: Id;
  style: VisualStyleSettingsDto | null;
  instructions?: string[];
}): SceneGenerationContext {
  const scene = input.scenes.getScene(input.sceneId, true);
  if (!scene) throw new AppError('NOT_FOUND', 'Scene not found', 404);
  const location = scene.locationId
    ? input.scenes.getLocation(scene.projectId, scene.locationId)
    : null;
  const plan = input.scenes.getScenePlan(scene.chapterId);
  const context = buildSceneGenerationContext({
    story: input.story,
    chapters: input.chapters,
    scenes: input.scenes,
    projectId: input.projectId,
    chapterId: scene.chapterId,
    density: plan?.density ?? 'MEDIUM',
    targetRange: plan?.targetRange ?? null,
    style: input.style,
    location,
    instructions: input.instructions,
  });
  const neighbors = input.scenes
    .listScenes(scene.chapterId, 200, 0, false)
    .filter(
      (candidate) =>
        candidate.id !== scene.id && Math.abs(candidate.sceneNumber - scene.sceneNumber) <= 2,
    )
    .slice(0, 4);
  const neighborTokens = estimateTokens(neighbors);
  if (context.estimatedTokens + estimateTokens(scene) + neighborTokens > SCENE_CONTEXT_MAX_TOKENS)
    throw new AppError(
      'SCENE_CONTEXT_TOO_LARGE',
      'Scene regeneration context exceeds the safe context limit',
      422,
      false,
      `sceneTokens=${estimateTokens(scene)};neighborTokens=${neighborTokens}`,
    );
  return {
    ...context,
    currentScene: scene,
    neighboringScenes: neighbors,
    selectedContext: [...context.selectedContext, 'scene:current', 'scene:neighbors'],
    estimatedTokens: context.estimatedTokens + estimateTokens(scene) + neighborTokens,
  };
}
