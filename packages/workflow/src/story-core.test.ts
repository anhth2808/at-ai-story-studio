import { describe, expect, it } from 'vitest';
import {
  chapterGenerationEnvelopeSchema,
  parseStoryOperationOutput,
  type ChapterPlanItem,
  type StoryBlueprint,
  type StorySettings,
  type StoryState,
} from '@studio/shared';
import { compileGenerationContext, compileGenerationContextV2 } from './story-context.js';
import {
  renderBlueprintPrompt,
  renderChapterPlansPrompt,
  renderChapterPrompt,
  renderSummaryPrompt,
} from './story-prompts.js';

const settings: StorySettings = {
  mode: 'IDEA_TO_STORY',
  idea: 'A courier carries a promise through a city that forgets.',
  language: 'vi-VN',
  genre: 'fantasy',
  tone: 'reflective',
  audience: 'general',
  targetChapterCount: 3,
  chapterLength: 800,
  pacing: 'MEDIUM',
  contentBoundaries: [],
  characterNotes: '',
  worldNotes: '',
  plotRequirements: '',
  generation: {
    model: null,
    contextBudget: 5_000,
    temperature: 0.7,
    maxOutputTokens: 8_000,
  },
};

const blueprint: StoryBlueprint = {
  premise: 'The courier must keep the promise.',
  themes: ['duty'],
  worldRules: ['Memories have a price.'],
  continuityConstraints: ['The courier never abandons a delivery.'],
  plotDirection: 'The promise changes the city.',
  characters: [],
};
const v2Character = {
  id: 'hero',
  name: 'Hero',
  role: 'courier',
  ageRange: 'adult',
  appearance: 'dark coat',
  personality: 'careful',
  wants: 'keep the promise',
  fears: 'being forgotten',
  traits: ['observant'],
  relationships: [],
  backstory: 'Inherited a dangerous route.',
  voice: 'quiet',
  arc: 'from duty to choice',
};
const v2Blueprint: StoryBlueprint = { ...blueprint, characters: [v2Character] };
const v2PlanItem: ChapterPlanItem = {
  id: 'chapter-2',
  chapterNumber: 2,
  title: 'The Second Door',
  purpose: 'Advance the promise.',
  summary: 'The courier follows a new clue.',
  setting: 'old city',
  characterIds: ['hero'],
  conflict: 'The clue is a trap.',
  turningPoints: ['The seal opens.'],
  resolution: 'The courier continues.',
  emotionalArc: 'doubt to resolve',
  estimatedWordCount: 800,
  threadIds: ['thread-main'],
};
const v2State: StoryState = {
  projectId: 'project',
  revision: 2,
  currentChapter: 1,
  rollingProgressSummary: 'The courier is following the promise.',
  currentArcId: 'arc-1',
  currentPhase: 'IN_PROGRESS',
  characterStates: [],
  threads: [
    {
      id: 'thread-main',
      title: 'The promise',
      description: 'A promise must be kept.',
      type: 'PROMISE',
      status: 'OPEN',
      importance: 'HIGH',
      characterIds: ['hero'],
      introducedChapter: 1,
      lastTouchedChapter: 1,
      expectedResolutionStart: null,
      expectedResolutionEnd: 10,
      resolvedChapter: null,
      abandonedChapter: null,
    },
  ],
  importantFacts: [],
  recentEvents: [],
  gapMarkers: [],
  sourceChapterId: null,
  sourceChapterRevision: null,
  previousRevision: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Story Core prompt contracts', () => {
  it('renders deterministic versioned prompts with separated data sections', () => {
    const first = renderBlueprintPrompt(settings);
    const second = renderBlueprintPrompt({ ...settings, generation: { ...settings.generation } });
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    expect(first.promptVersion).toBe('story-blueprint-v1');
    expect(first.systemPrompt).toContain('JSON object only');
    expect(first.systemPrompt).toContain('premise string');
    expect(first.userPrompt).toContain('[TRUSTED_INSTRUCTIONS]');
    expect(first.userPrompt).toContain('[UNTRUSTED_STORY_DATA]');
    expect(renderChapterPlansPrompt(settings, blueprint).inputFingerprint).not.toBe(
      first.inputFingerprint,
    );
  });

  it('changes chapter and summary fingerprints when the configured model changes', () => {
    const context = compileGenerationContext({ blueprint, budget: 5_000 });
    const item = {
      id: 'chapter-1',
      chapterNumber: 1,
      title: 'The Door',
      purpose: 'Introduce the promise.',
      summary: 'A courier receives a letter.',
      setting: 'old city gate',
      characterIds: [],
      conflict: 'The recipient has vanished.',
      turningPoints: [],
      resolution: 'The courier accepts the route.',
      emotionalArc: 'doubt to resolve',
      estimatedWordCount: 800,
      threadIds: [],
    };
    expect(renderChapterPrompt(context, item, 'model-a').inputFingerprint).not.toBe(
      renderChapterPrompt(context, item, 'model-b').inputFingerprint,
    );
    const chapter = { title: 'The Door', content: 'A courier receives a letter.', revision: 1 };
    expect(renderSummaryPrompt(context, chapter, 'model-a').inputFingerprint).not.toBe(
      renderSummaryPrompt(context, chapter, 'model-b').inputFingerprint,
    );
  });
  it('orders selected characters and open threads by stable id', () => {
    const character = (id: string) => ({
      id,
      name: id,
      role: 'support',
      ageRange: 'adult',
      appearance: 'plain',
      personality: 'steady',
      wants: 'help',
      fears: 'loss',
      traits: ['patient'],
      relationships: [],
      backstory: 'Known to the courier.',
      voice: 'quiet',
      arc: 'from doubt to trust',
    });
    const context = compileGenerationContext({
      blueprint: { ...blueprint, characters: [character('z-character'), character('a-character')] },
      selectedCharacterIds: ['z-character', 'a-character'],
      openThreads: [
        {
          id: 'z-thread',
          description: 'z',
          status: 'OPEN',
          characterIds: [],
          introducedChapter: 1,
          resolvedChapter: null,
        },
        {
          id: 'a-thread',
          description: 'a',
          status: 'OPEN',
          characterIds: [],
          introducedChapter: 1,
          resolvedChapter: null,
        },
      ],
      budget: 5_000,
    });
    const selectedCharacters =
      context.sections.find((section) => section.name === 'selected-characters')?.content ?? '';
    const openThreads =
      context.sections.find((section) => section.name === 'open-threads')?.content ?? '';
    expect(selectedCharacters.indexOf('a-character')).toBeLessThan(
      selectedCharacters.indexOf('z-character'),
    );
    expect(openThreads.indexOf('a-thread')).toBeLessThan(openThreads.indexOf('z-thread'));
  });

  it('keeps context construction bounded for 10, 50, 100, and 200 chapters', () => {
    for (const chapterCount of [10, 50, 100, 200]) {
      const context = compileGenerationContext({
        blueprint,
        priorSummaries: Array.from({ length: chapterCount }, (_, index) => ({
          chapterNumber: index + 1,
          revision: 1,
          summary: {
            recap: `Chapter ${index + 1} recap ${'x'.repeat(180)}`,
            keyFacts: [`fact-${index + 1}`],
            characterStateChanges: [],
            newInformation: [`information-${index + 1}`],
            openThreadIds: [],
            resolvedThreadIds: [],
          },
        })),
        budget: 5_000,
      });
      expect(context.estimatedTokens).toBeLessThanOrEqual(5_000);
      expect(
        context.sections.find((section) => section.name === 'prior-summaries')?.content.length,
      ).toBeLessThanOrEqual(20_000);
    }
  });

  it('keeps V2 context bounded for 10, 50, 100, and 200 chapters', () => {
    const measurements: Array<{
      chapter: number;
      estimatedTokens: number;
      selectedRecords: {
        characters: number;
        threads: number;
        summaries: number;
      };
      omittedSections: string[];
    }> = [];
    for (const chapterCount of [10, 50, 100, 200]) {
      const context = compileGenerationContextV2({
        blueprint: v2Blueprint,
        state: v2State,
        planItem: v2PlanItem,
        priorSummaries: Array.from({ length: chapterCount }, (_, index) => ({
          chapterNumber: index + 1,
          revision: 1,
          summary: {
            recap: `Chapter ${index + 1} recap ${'x'.repeat(180)}`,
            keyFacts: [`fact-${index + 1}`],
            characterStateChanges: [],
            newInformation: [`information-${index + 1}`],
            openThreadIds: ['thread-main'],
            resolvedThreadIds: [],
          },
        })),
        budget: 5_000,
        facts: Array.from({ length: 40 }, (_, index) => ({
          id: `fact-${index}`,
          text: `Canonical fact ${index} ${'x'.repeat(900)}`,
          importance: index === 0 ? ('HIGH' as const) : ('LOW' as const),
          introducedChapter: 1,
          lastConfirmedChapter: 1,
          status: 'ACTIVE' as const,
        })),
      });
      const diagnostics = context.diagnostics;
      if (!diagnostics) throw new Error('V2 context diagnostics are required');
      measurements.push({
        chapter: chapterCount,
        estimatedTokens: diagnostics.estimatedTokens,
        selectedRecords: {
          characters: diagnostics.selectedCharacterCount,
          threads: diagnostics.selectedThreadCount,
          summaries: diagnostics.recentSummariesIncluded,
        },
        omittedSections: diagnostics.omittedSections,
      });
      expect(context.estimatedTokens).toBeLessThanOrEqual(5_000);
      const recentSummaries = context.sections.find(
        (section) => section.name === 'recent-summaries',
      );
      if (recentSummaries) expect(recentSummaries.content.length).toBeLessThanOrEqual(20_000);
    }
    expect(measurements.map((item) => item.chapter)).toEqual([10, 50, 100, 200]);
    expect(measurements.every((item) => item.estimatedTokens <= 5_000)).toBe(true);
    expect(measurements.every((item) => item.selectedRecords.characters >= 0)).toBe(true);
    expect(measurements.every((item) => item.selectedRecords.threads >= 0)).toBe(true);
    expect(measurements.every((item) => item.selectedRecords.summaries >= 0)).toBe(true);
    expect(measurements.some((item) => item.omittedSections.length > 0)).toBe(true);
  });
  it('compresses required V2 sections without exceeding a small context budget', () => {
    const context = compileGenerationContextV2({
      blueprint: { ...v2Blueprint, premise: 'A'.repeat(5_000) },
      state: v2State,
      planItem: v2PlanItem,
      priorSummaries: Array.from({ length: 20 }, (_, index) => ({
        chapterNumber: index + 1,
        revision: 1,
        summary: {
          recap: `Chapter ${index + 1} recap ${'x'.repeat(180)}`,
          keyFacts: [`fact-${index + 1}`],
          characterStateChanges: [{ characterId: 'hero', change: 'keeps moving' }],
          newInformation: [`information-${index + 1}`],
          openThreadIds: ['thread-main'],
          resolvedThreadIds: [],
        },
      })),
      budget: 500,
    });
    expect(context.estimatedTokens).toBeLessThanOrEqual(500);
    for (const section of context.sections) expect(() => JSON.parse(section.content)).not.toThrow();
    expect(context.omittedContext.some((item) => item.endsWith(':truncated'))).toBe(true);
  });

  it('selects planned active entities and reports deterministic omission reasons', () => {
    const context = compileGenerationContextV2({
      blueprint: v2Blueprint,
      state: v2State,
      planItem: v2PlanItem,
      instructions: [`Keep the promise visible. ${'detail '.repeat(800)}`],
      facts: Array.from({ length: 30 }, (_, index) => ({
        id: `fact-${index}`,
        text: `Important fact ${index}`,
        importance: index === 0 ? 'HIGH' : 'LOW',
        introducedChapter: 1,
        lastConfirmedChapter: 1,
        status: 'ACTIVE',
      })),
      budget: 2_000,
    });
    expect(context.diagnostics?.selectedSections).toContain('relevant-threads');
    expect(context.diagnostics?.selectedSections).toContain('relevant-characters');
    expect(context.diagnostics?.selectionReasons['important-facts']).toContain('selected');
    expect(context.diagnostics?.selectionReasons.instructions).toContain('omitted');
    expect(context.omittedContext).toContain('instructions');
  });

  it('bounds context deterministically and reports omitted sections', () => {
    const context = compileGenerationContext({
      blueprint: {
        ...blueprint,
        worldRules: Array.from({ length: 50 }, (_, index) => `rule-${index}-${'x'.repeat(200)}`),
      },
      relevantFacts: Array.from({ length: 100 }, (_, index) => `fact-${index}-${'y'.repeat(200)}`),
      budget: 500,
    });
    expect(context.estimatedTokens).toBeLessThanOrEqual(500);
    expect(context.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(context.omittedContext.length).toBeGreaterThan(0);
    expect(context.sections.map((section) => section.name)).toEqual(['blueprint']);
  });

  it('records missing summary diagnostics without assembling chapter prose', () => {
    const context = compileGenerationContext({
      blueprint,
      missingContext: ['summary:chapter-2'],
      priorSummaries: [],
      budget: 5_000,
    });
    expect(context.omittedContext).toContain('missing:summary:chapter-2');
    expect(context.sections.some((section) => section.content.includes('chapter-2'))).toBe(false);
  });

  it('rejects free-form chapter output before persistence', () => {
    expect(() => parseStoryOperationOutput('CHAPTER', 'not-json')).toThrow();
    expect(() =>
      parseStoryOperationOutput(
        'CHAPTER',
        JSON.stringify({ title: 'Only a title', content: 'text' }),
      ),
    ).toThrow();
    expect(() =>
      chapterGenerationEnvelopeSchema.parse({
        title: 'Chapter',
        content: 'Content',
        summary: {},
        events: [],
        characterStateChanges: [],
        threadTransitions: [],
        usedCharacterIds: [],
        introducedCharacterIds: [],
        unresolvedThreadIds: [],
        continuityWarnings: [],
      }),
    ).toThrow();
  });
});
