import { describe, expect, it } from 'vitest';
import { ttsQualityIssues } from './tts-quality.js';

describe('TTS quality policy', () => {
  it('rejects short speech followed by long silence', () => {
    expect(
      ttsQualityIssues({
        durationMs: 30_000,
        activityRatio: 0.08,
        textLength: 12,
        provider: 'EDGE_TTS',
      }),
    ).toEqual(expect.arrayContaining(['TEXT_DURATION_RATIO', 'EXCESSIVE_SILENCE']));
  });

  it('accepts ordinary decoded speech', () => {
    expect(
      ttsQualityIssues({
        durationMs: 5_000,
        activityRatio: 0.82,
        textLength: 60,
        provider: 'EDGE_TTS',
      }),
    ).toEqual([]);
  });
});
