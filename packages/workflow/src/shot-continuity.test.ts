import { describe, expect, it } from 'vitest';
import type { Shot, ShotPhysicalState } from '@studio/shared';
import { continuationEligibility, resolveShotContinuity } from './shot-continuity.js';

const character = {
  characterId: 'mai',
  visible: true,
  screenRegion: 'left',
  worldPosition: 'doorway',
  facing: 'right',
  bodyOrientation: 'three-quarter',
  pose: 'standing',
  heldObjectIds: ['letter'],
  faceVisibility: 'PROFILE',
} satisfies ShotPhysicalState['characters'][number];
const state: ShotPhysicalState = {
  characters: [character],
  objects: [{ objectId: 'letter', position: 'in hand', holderCharacterId: 'mai' }],
  cameraAxis: 'north-south',
  locationId: 'courtyard',
  sourceShotId: 'shot-1',
  fingerprint: 'a'.repeat(64),
};

function shot(id: string): Shot {
  return {
    id,
    beatId: `beat-${id}`,
    ordinal: id === 'shot-1' ? 1 : 2,
    sourceRange: { startOffset: 0, endOffset: 10 },
    primaryBeat: 'ACTION',
    eventKinds: ['ACTION'],
    eventCount: 1,
    importance: 'MEDIUM',
    hero: false,
    identitySensitive: true,
    dialogueMode: 'NONE',
    dialogueText: '',
    speakerCharacterId: null,
    visualCarrier: '',
    offscreenRationale: '',
    visibleCharacterIds: ['mai'],
    offscreenCharacterIds: [],
    staticIntent: {
      subject: 'Mai',
      action: 'reads',
      pose: 'standing',
      expression: 'concerned',
      relationship: '',
      importantObjectIds: ['letter'],
      framing: id === 'shot-1' ? 'MEDIUM' : 'CLOSE_UP',
      angle: 'eye level',
      composition: '',
      lighting: '',
      colorMood: '',
      atmosphere: '',
    },
    dynamicIntent: {
      subjectMotion: 'subtle breathing',
      cameraMotion: id === 'shot-1' ? 'STATIC' : 'PUSH_IN',
      cameraSpeed: 'SLOW',
      environmentMotion: '',
      emotionalTiming: '',
      speakingMotion: '',
      stabilityConstraints: [],
    },
    initialState: state,
    finalState: state,
    continuation: {
      mode: 'NEW_KEYFRAME',
      eligible: false,
      reason: 'pending',
      version: 'continuation-v1',
    },
    plannedDurationMs: 2_000,
    variationIntent: 'NORMAL',
  };
}

describe('Shot continuity', () => {
  it('seeds structured physical state and reports silent object drops', () => {
    const result = resolveShotContinuity(state, {
      characters: [{ ...character, heldObjectIds: [] }],
      objects: state.objects,
      cameraAxis: '',
      locationId: null,
      sourceShotId: 'shot-1',
    });
    expect(result.state.cameraAxis).toBe('north-south');
    expect(result.state.locationId).toBe('courtyard');
    expect(result.state.fingerprint).toHaveLength(64);
    expect(result.conflicts).toEqual([expect.stringContaining('drops a held object')]);
  });

  it('accepts only retained inward continuations with a supported face basis', () => {
    const previous = shot('shot-1');
    const current = shot('shot-2');
    expect(continuationEligibility(previous, current)).toMatchObject({
      eligible: true,
      mode: 'CONTINUE_PREVIOUS',
    });
    expect(
      continuationEligibility(previous, {
        ...current,
        initialState: { ...state, locationId: 'street' },
      }),
    ).toMatchObject({ eligible: false, reason: 'Location changed' });
    expect(
      continuationEligibility(
        {
          ...previous,
          finalState: { ...state, characters: [{ ...character, faceVisibility: 'BACK' }] },
        },
        {
          ...current,
          initialState: { ...state, characters: [{ ...character, faceVisibility: 'FRONTAL' }] },
        },
      ),
    ).toMatchObject({ eligible: false, reason: 'Source frame lacks a supported face basis' });
    expect(
      continuationEligibility(previous, {
        ...current,
        dynamicIntent: { ...current.dynamicIntent, cameraMotion: 'PAN_LEFT' },
      }),
    ).toMatchObject({ eligible: false });
  });
});
