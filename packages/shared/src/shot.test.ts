import { describe, expect, it } from 'vitest';
import {
  shotPlanCandidateSchema,
  shotSourceRangeSchema,
  shotValidationIssueCodeSchema,
} from './shot.js';

const fingerprint = 'a'.repeat(64);

const state = {
  characters: [],
  objects: [],
  cameraAxis: '',
  locationId: null,
  sourceShotId: null,
  fingerprint,
};

const shot = {
  id: 'shot-1',
  beatId: 'beat-1',
  ordinal: 1,
  sourceRange: { startOffset: 0, endOffset: 20 },
  primaryBeat: 'ACTION',
  eventKinds: ['ACTION'],
  eventCount: 1,
  importance: 'MEDIUM',
  dialogueMode: 'NONE',
  visibleCharacterIds: [],
  offscreenCharacterIds: [],
  staticIntent: { subject: 'A woman opens a letter', framing: 'MEDIUM' },
  dynamicIntent: {},
  initialState: state,
  finalState: state,
  continuation: {
    mode: 'NEW_KEYFRAME',
    eligible: false,
    reason: 'First shot',
    version: 'shot-continuation-v1',
  },
  plannedDurationMs: 2_000,
};

const candidate = {
  beats: [
    {
      id: 'beat-1',
      ordinal: 1,
      sourceRange: { startOffset: 0, endOffset: 20 },
      kind: 'ACTION',
      meaning: 'The letter is opened',
      importance: 'MEDIUM',
      timingGroupKey: 'group-1',
    },
  ],
  shots: [shot],
};

describe('Shot contracts', () => {
  it('accepts one bounded source-grounded Shot plan', () => {
    const parsed = shotPlanCandidateSchema.parse(candidate);
    expect(parsed.shots[0]).toMatchObject({
      id: 'shot-1',
      hero: false,
      identitySensitive: false,
      variationIntent: 'NORMAL',
    });
  });

  it('rejects invalid ranges, duplicate ordinals, event mismatches, and oversized plans', () => {
    expect(() => shotSourceRangeSchema.parse({ startOffset: 2, endOffset: 2 })).toThrow();
    expect(() =>
      shotPlanCandidateSchema.parse({
        ...candidate,
        beats: [...candidate.beats, { ...candidate.beats[0], id: 'beat-2' }],
      }),
    ).toThrow();
    expect(() =>
      shotPlanCandidateSchema.parse({
        ...candidate,
        shots: [{ ...shot, primaryBeat: 'REVEAL' }],
      }),
    ).toThrow();
    expect(() =>
      shotPlanCandidateSchema.parse({
        beats: Array.from({ length: 201 }, (_, index) => ({
          ...candidate.beats[0],
          id: `beat-${index}`,
          ordinal: index + 1,
        })),
        shots: candidate.shots,
      }),
    ).toThrow();
  });

  it('keeps validation issue codes closed', () => {
    expect(shotValidationIssueCodeSchema.parse('SHOT_OVERLOADED')).toBe('SHOT_OVERLOADED');
    expect(() => shotValidationIssueCodeSchema.parse('IGNORE_QUALITY')).toThrow();
  });
});
