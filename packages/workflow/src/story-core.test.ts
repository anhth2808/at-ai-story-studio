import { describe, expect, it } from 'vitest';
import {
  chapterGenerationEnvelopeSchema,
  parseStoryOperationOutput,
  type StoryBlueprint,
  type StorySettings,
} from '@studio/shared';
import { compileGenerationContext } from './story-context.js';
import { renderBlueprintPrompt, renderChapterPlansPrompt } from './story-prompts.js';

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

  it('keeps context construction bounded for 50, 100, and 200 chapters', () => {
    for (const chapterCount of [50, 100, 200]) {
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
      expect(context.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
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
