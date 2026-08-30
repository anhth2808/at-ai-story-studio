import { describe, expect, it } from 'vitest';
import {
  cleanNarrationText,
  parseSrt,
  segmentText,
  serializeSrt,
  subtitlesFromSegments,
} from './text.js';

describe('narration text', () => {
  it('cleans conservatively and deterministically', () => {
    const first = cleanNarrationText('  Một câu.\r\n\r\n\r\nCâu hai.\u0000 ');
    const second = cleanNarrationText('  Một câu.\n\n\nCâu hai.\u0000 ');
    expect(first.text).toBe('Một câu.\n\nCâu hai.');
    expect(first).toEqual(second);
  });
  it('segments long text within the configured limit', () => {
    const segments = segmentText('Một câu rất dài '.repeat(40), 80);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.text.length <= 80)).toBe(true);
    expect(segmentText('Một câu rất dài '.repeat(40), 80)).toEqual(segments);
  });
  it('round-trips measured SRT cues', () => {
    const cues = subtitlesFromSegments([
      { text: 'Một', durationMs: 1250 },
      { text: 'Hai', durationMs: 900 },
    ]);
    expect(parseSrt(serializeSrt(cues))).toEqual(cues);
  });
});
