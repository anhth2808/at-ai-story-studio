import { describe, expect, it } from 'vitest';
import {
  storyStateSchema,
  type StoryBlueprint,
  type StoryState,
  type StoryStateDelta,
} from '@studio/shared';
import { reduceStoryState } from './story-state.js';

const blueprint: StoryBlueprint = {
  premise: 'A courier carries a promise through a city that forgets.',
  themes: ['duty'],
  worldRules: ['Memories have a price.'],
  continuityConstraints: ['The courier never abandons a delivery.'],
  plotDirection: 'The promise changes the city.',
  characters: [
    {
      id: 'courier',
      name: 'Courier',
      role: 'protagonist',
      ageRange: 'adult',
      appearance: 'Travel-worn coat',
      personality: 'Persistent',
      wants: 'Deliver the promise',
      fears: 'Forgetting the recipient',
      traits: ['patient'],
      relationships: [],
      backstory: 'A trusted courier.',
      voice: 'quiet',
      arc: 'from doubt to resolve',
    },
  ],
};

const previous: StoryState = storyStateSchema.parse({
  projectId: 'project',
  revision: 1,
  currentChapter: 0,
  rollingProgressSummary: '',
  currentArcId: null,
  currentPhase: 'PRELUDE',
  characterStates: [{ characterId: 'courier' }],
  threads: [
    {
      id: 'promise',
      title: 'The promise',
      type: 'GOAL',
      importance: 'HIGH',
      description: 'Deliver the promise.',
      status: 'OPEN',
      characterIds: ['courier'],
      introducedChapter: 1,
      resolvedChapter: null,
      lastTouchedChapter: 1,
      expectedResolutionStart: null,
      expectedResolutionEnd: null,
      abandonedChapter: null,
    },
  ],
  importantFacts: [],
  recentEvents: [],
  gapMarkers: [],
  sourceChapterId: null,
  sourceChapterRevision: null,
  previousRevision: null,
  updatedAt: new Date().toISOString(),
});

describe('StoryState reducer', () => {
  it('applies terminal thread precedence and deterministic fact/event deduplication', () => {
    const delta: StoryStateDelta = {
      characterUpdates: [],
      threadUpdates: [
        { threadId: 'promise', status: 'OPEN' },
        { threadId: 'promise', status: 'RESOLVED', note: 'Delivered' },
      ],
      newThreads: [],
      facts: [
        {
          id: 'fact-memory',
          text: 'The city forgets names.',
          importance: 'HIGH',
          introducedChapter: 1,
          lastConfirmedChapter: 1,
          status: 'ACTIVE',
        },
        {
          id: 'fact-memory',
          text: 'The city forgets names and promises.',
          importance: 'HIGH',
          introducedChapter: 1,
          lastConfirmedChapter: 1,
          status: 'ACTIVE',
        },
      ],
      events: [
        {
          id: 'event-delivery',
          chapterNumber: 1,
          type: 'DELIVERY',
          description: 'The promise is delivered.',
          importance: 'HIGH',
          characterIds: ['courier'],
          threadIds: ['promise'],
        },
        {
          id: 'event-delivery',
          chapterNumber: 1,
          type: 'DELIVERY',
          description: 'The promise is delivered safely.',
          importance: 'HIGH',
          characterIds: ['courier'],
          threadIds: ['promise'],
        },
      ],
      arcProgress: [],
      gapMarkers: [],
    };
    const result = reduceStoryState(previous, delta, {
      projectId: 'project',
      chapterNumber: 1,
      blueprint,
      chapterSummary: {
        recap: 'The courier delivers the promise.',
        keyFacts: [],
        characterStateChanges: [],
        newInformation: [],
        openThreadIds: [],
        resolvedThreadIds: ['promise'],
      },
    });

    expect(result.state.revision).toBe(2);
    expect(result.state.rollingProgressSummary).toContain('The courier delivers the promise.');
    expect(result.state.threads.find((thread) => thread.id === 'promise')?.status).toBe('RESOLVED');
    expect(result.state.importantFacts).toHaveLength(1);
    expect(result.state.importantFacts[0]?.text).toBeTruthy();
    expect(result.state.recentEvents).toHaveLength(1);
    expect(result.state.recentEvents[0]?.description).toBeTruthy();
  });

  it('rejects unknown character and thread references before persistence', () => {
    expect(() =>
      reduceStoryState(
        previous,
        {
          characterUpdates: [{ characterId: 'unknown', currentGoal: 'Escape' }],
          threadUpdates: [],
          newThreads: [],
          facts: [],
          events: [],
          arcProgress: [],
          gapMarkers: [],
        },
        { projectId: 'project', chapterNumber: 1, blueprint },
      ),
    ).toThrow('Unknown character reference');

    expect(() =>
      reduceStoryState(
        previous,
        {
          characterUpdates: [],
          threadUpdates: [{ threadId: 'missing', status: 'PROGRESSING' }],
          newThreads: [],
          facts: [],
          events: [],
          arcProgress: [],
          gapMarkers: [],
        },
        { projectId: 'project', chapterNumber: 1, blueprint },
      ),
    ).toThrow('Unknown thread reference');
    expect(() =>
      reduceStoryState(
        previous,
        {
          characterUpdates: [],
          threadUpdates: [],
          newThreads: [],
          facts: [],
          events: [],
          arcProgress: [{ arcId: 'missing', status: 'IN_PROGRESS' }],
          gapMarkers: [],
        },
        {
          projectId: 'project',
          chapterNumber: 1,
          blueprint,
          arcs: [],
        },
      ),
    ).toThrow('Unknown arc reference');
  });
});
