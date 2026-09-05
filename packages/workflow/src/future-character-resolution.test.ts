import { describe, expect, it } from 'vitest';
import { storyBlueprintSchema } from '@studio/shared';
import { resolveFutureCharacterIdentity } from './future-character-resolution.js';

const blueprint = storyBlueprintSchema.parse({
  premise: 'A detective follows a hidden identity.',
  themes: ['identity'],
  worldRules: ['Names can be concealed.'],
  continuityConstraints: ['Keep one canonical identity.'],
  plotDirection: 'Reveal the stranger later.',
  characters: [
    {
      id: 'john',
      name: 'John Smith',
      aliases: ['the mysterious man'],
      voiceId: 'voice-john',
      role: 'Detective',
      ageRange: 'adult',
      appearance: 'Dark coat',
      personality: 'Calm',
      wants: 'Truth',
      fears: 'Failure',
      traits: ['observant'],
      relationships: [],
      backstory: 'Unknown',
      voice: 'Low',
      arc: 'Reveals himself',
    },
  ],
});

describe('future character identity resolution', () => {
  it('resolves a later reveal to the blueprint identity and lineage', () => {
    const result = resolveFutureCharacterIdentity({
      alias: 'the mysterious man',
      blueprint,
      context: [
        {
          source: 'FUTURE_CHAPTER',
          reference: 'chapter:future:1',
          text: 'The mysterious man is John Smith, finally revealing his identity.',
          characterIds: ['john'],
        },
      ],
      references: { john: { voiceId: 'voice-john', referenceAssetIds: ['ref-john'] } },
    });

    expect(result).toMatchObject({
      status: 'RESOLVED',
      characterId: 'john',
      voiceId: 'voice-john',
      referenceAssetIds: ['ref-john'],
    });
    expect(result.evidence[0]?.source).toBe('BLUEPRINT_ALIAS');
  });

  it('leaves ambiguous and future-only identities unresolved', () => {
    const ambiguousBlueprint = storyBlueprintSchema.parse({
      ...blueprint,
      characters: [
        blueprint.characters[0],
        { ...blueprint.characters[0], id: 'jane', name: 'Jane Smith' },
      ],
    });
    const ambiguous = resolveFutureCharacterIdentity({
      alias: 'the stranger',
      blueprint: ambiguousBlueprint,
      context: [
        {
          source: 'PLAN_WINDOW',
          reference: 'window:1',
          text: 'The stranger is revealed as John Smith or Jane Smith.',
          characterIds: ['john', 'jane'],
        },
      ],
    });
    expect(ambiguous).toMatchObject({ status: 'AMBIGUOUS', characterId: null });

    const futureOnly = resolveFutureCharacterIdentity({
      alias: 'the stranger',
      blueprint,
      context: [
        {
          source: 'CHAPTER_SUMMARY',
          reference: 'summary:future:1',
          text: 'The stranger is revealed as an entirely new person.',
        },
      ],
    });
    expect(futureOnly).toMatchObject({ status: 'UNRESOLVED', characterId: null });
  });
});
