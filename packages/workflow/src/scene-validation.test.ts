import { describe, expect, it } from 'vitest';
import {
  scenePlanningEnvelopeSchema,
  storyBlueprintSchema,
  type ScenePlanItem,
} from '@studio/shared';
import {
  resolveSceneCharacters,
  sceneContinuityWarnings,
  validateScenePlanningOutput,
  validateScenePromptOutput,
  validateSceneRegenerationOutput,
} from './scene-validation.js';

function scene(overrides: Partial<ScenePlanItem> = {}): ScenePlanItem {
  return {
    sceneNumber: 1,
    title: 'Cánh cửa',
    summary: 'Một người bước qua cửa.',
    purpose: 'INTRODUCTION',
    sourceRange: { start: 0, end: 3 },
    location: 'Sân trong',
    timeOfDay: 'Sáng',
    weather: 'Trong',
    mood: 'Tò mò',
    characters: [
      {
        characterId: null,
        displayName: 'Mai',
        roleInScene: 'Người quan sát',
        visualState: {
          clothing: 'Áo xanh',
          injuries: [],
          expression: 'Thận trọng',
          pose: 'Đứng',
          action: 'Bước vào',
          position: 'Trung tâm',
          heldObjects: [],
        },
      },
    ],
    importantObjects: ['Cửa'],
    visualDescription: 'Cánh cửa mở vào sân.',
    camera: { framing: 'MEDIUM', angle: null, movementIntent: null },
    composition: {
      subjectFocus: 'Người ở cửa',
      foreground: [],
      midground: [],
      background: [],
      characterPositions: [],
    },
    lighting: 'Sáng dịu',
    colorMood: 'Xanh nhạt',
    imagePrompt: 'A cinematic medium shot of a person entering a courtyard',
    negativePrompt: 'text',
    continuityNotes: '',
    ...overrides,
  };
}

describe('Scene Engine validation', () => {
  it('rejects invalid ordering, overlap, and empty prompts', () => {
    const first = scene({ sceneNumber: 1, sourceRange: { start: 0, end: 4 } });
    const second = scene({ sceneNumber: 3, sourceRange: { start: 3, end: 8 } });
    expect(() =>
      validateScenePlanningOutput(JSON.stringify({ scenes: [first, second] }), 20),
    ).toThrow('contiguous');
    expect(() =>
      validateScenePlanningOutput(
        JSON.stringify({
          scenes: [first, { ...second, sceneNumber: 2 }],
        }),
        20,
      ),
    ).toThrow('overlap');
    expect(() =>
      validateScenePlanningOutput(JSON.stringify({ scenes: [{ ...first, imagePrompt: '' }] }), 20),
    ).toThrow('image prompt');
  });
  it('rejects scene payloads whose source ranges move backwards', () => {
    const first = scene({ sceneNumber: 1, sourceRange: { start: 4, end: 8 } });
    const second = scene({ sceneNumber: 2, sourceRange: { start: 0, end: 3 } });
    expect(() =>
      validateScenePlanningOutput(JSON.stringify({ scenes: [first, second] }), 20),
    ).toThrow('ordered');
  });

  it('keeps regeneration anchored to the current scene range', () => {
    const current = scene();
    const currentDto = {
      ...current,
      characters: current.characters.map((character) => ({
        ...character,
        resolutionStatus: 'UNRESOLVED' as const,
      })),
      id: 'scene-id',
      stableId: 'stable-id',
      scenePlanRevisionId: 'plan-id',
      projectId: 'project-id',
      chapterId: 'chapter-id',
      chapterRevision: 1,
      planRevision: 1,
      revision: 1,
      locationId: null,
      styleRevisionId: null,
      status: 'CURRENT' as const,
      promptStatus: 'CURRENT' as const,
      unresolvedReferences: [],
      generationId: null,
      inputFingerprint: 'fingerprint',
      promptVersion: 'scene-v1',
      schemaVersion: 'scene-v1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(() =>
      validateSceneRegenerationOutput(
        JSON.stringify({ scene: { ...current, sourceRange: { start: 1, end: 3 } } }),
        20,
        currentDto,
      ),
    ).toThrow('anchored source range');
  });

  it('resolves canonical characters and preserves unresolved references', () => {
    const blueprint = storyBlueprintSchema.parse({
      premise: 'Một hành trình.',
      themes: [],
      worldRules: [],
      continuityConstraints: [],
      plotDirection: 'Đi tiếp.',
      characters: [
        {
          id: 'mai',
          name: 'Mai',
          role: 'Nhân vật chính',
          ageRange: '25',
          appearance: 'Áo xanh',
          personality: 'Điềm tĩnh',
          wants: 'Tìm câu trả lời',
          fears: 'Mất phương hướng',
          traits: ['Quan sát'],
          relationships: [],
          backstory: '',
          voice: '',
          arc: '',
        },
      ],
    });
    const resolved = resolveSceneCharacters(
      scene({
        characters: [
          scene().characters[0]!,
          { ...scene().characters[0]!, displayName: 'Người lạ' },
        ],
      }),
      blueprint,
    );
    expect(resolved.characters[0]).toMatchObject({
      characterId: 'mai',
      resolutionStatus: 'RESOLVED',
    });
    expect(resolved.characters[1]).toMatchObject({
      characterId: null,
      resolutionStatus: 'UNRESOLVED',
    });
    expect(resolved.unresolvedReferences).toEqual(['Người lạ']);
  });

  it('validates prompt refresh envelopes and reports continuity warnings', () => {
    expect(
      validateScenePromptOutput(
        JSON.stringify({ imagePrompt: 'new prompt', negativePrompt: null }),
      ),
    ).toEqual({
      imagePrompt: 'new prompt',
      negativePrompt: null,
    });
    const current = scene();
    const next = scene({ location: 'Bến tàu', characters: [] });
    const warnings = sceneContinuityWarnings(next, {
      ...current,
      characters: current.characters.map((character) => ({
        ...character,
        resolutionStatus: 'UNRESOLVED' as const,
      })),
      id: 'scene-id',
      stableId: 'stable-id',
      scenePlanRevisionId: 'plan-id',
      projectId: 'project-id',
      chapterId: 'chapter-id',
      chapterRevision: 1,
      planRevision: 1,
      revision: 1,
      locationId: null,
      styleRevisionId: null,
      status: 'CURRENT',
      promptStatus: 'CURRENT',
      unresolvedReferences: [],
      generationId: null,
      inputFingerprint: 'fingerprint',
      promptVersion: 'scene-v1',
      schemaVersion: 'scene-v1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(warnings).toEqual([
      'Character continuity changed: mai',
      'Location continuity changed; review the regenerated scene',
    ]);
    expect(() => validateScenePromptOutput(JSON.stringify({ imagePrompt: '' }))).toThrow(
      'image prompt',
    );
    expect(scenePlanningEnvelopeSchema.parse({ scenes: [scene()] }).scenes).toHaveLength(1);
  });
});
