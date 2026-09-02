import { describe, expect, it } from 'vitest';
import {
  cleanNarrationText,
  parseSrt,
  segmentNarrationText,
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
  it('maps cleaned narration segments back to UTF-16 source ranges', () => {
    const input = '  Một câu.\r\n\r\nCâu hai.\u0000 ';
    const segments = segmentNarrationText(input);
    expect(
      segments.map(({ text, sourceStartOffset, sourceEndOffset }) => ({
        text,
        source: input.slice(sourceStartOffset, sourceEndOffset),
      })),
    ).toEqual([
      { text: 'Một câu.', source: 'Một câu.' },
      { text: 'Câu hai.', source: 'Câu hai.' },
    ]);
    expect(segments.every((segment) => segment.sourceEndOffset > segment.sourceStartOffset)).toBe(
      true,
    );
  });
  it('round-trips measured SRT cues', () => {
    const cues = subtitlesFromSegments([
      { text: 'Một', durationMs: 1250 },
      { text: 'Hai', durationMs: 900 },
    ]);
    expect(parseSrt(serializeSrt(cues))).toEqual(cues);
  });
});
