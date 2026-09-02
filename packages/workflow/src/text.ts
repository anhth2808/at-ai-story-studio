import { createHash } from 'node:crypto';

export type CleanText = { text: string; warnings: string[] };
export type TextSegment = { index: number; text: string; textHash: string };
export type SourceTextSegment = TextSegment & {
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceText: string;
};

type SourceCharacter = { value: string; start: number; end: number };

const isUnsupportedSourceCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return (
    (code >= 0 && code <= 8) ||
    code === 11 ||
    code === 12 ||
    (code >= 14 && code <= 31) ||
    code === 127 ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0xfeff
  );
};

const sourceCharacters = (input: string): SourceCharacter[] => {
  const characters: SourceCharacter[] = [];
  let offset = 0;
  while (offset < input.length) {
    const start = offset;
    const codePoint = input.codePointAt(offset);
    if (codePoint === undefined) break;
    let value = String.fromCodePoint(codePoint);
    offset += value.length;
    if (value === '\r') {
      if (input[offset] === '\n') offset += 1;
      value = '\n';
    }
    if (isUnsupportedSourceCharacter(value)) continue;
    characters.push({ value: value.normalize('NFC'), start, end: offset });
  }
  return characters;
};

export function cleanNarrationText(input: string): CleanText {
  const warnings: string[] = [];
  const normalized = input.normalize('NFC').replace(/\r\n?/g, '\n');
  let text = '';
  for (const character of normalized) {
    const code = character.charCodeAt(0);
    const unsupported =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127 ||
      (code >= 0x200b && code <= 0x200d) ||
      code === 0xfeff;
    if (unsupported) {
      warnings.push('Removed unsupported control character');
      continue;
    }
    text += character;
  }
  const compact = text
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (compact !== text) warnings.push('Normalized whitespace');
  return { text: compact, warnings: [...new Set(warnings)] };
}

export function segmentText(input: string, maxCharacters = 450): TextSegment[] {
  if (maxCharacters < 20) throw new Error('maxCharacters must be at least 20');
  const units = input
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const unit of units) {
    if (unit.length <= maxCharacters) {
      pieces.push(unit);
      continue;
    }
    let remaining = unit;
    while (remaining.length > maxCharacters) {
      const candidate = remaining.slice(0, maxCharacters + 1);
      const boundary = Math.max(
        candidate.lastIndexOf(' '),
        candidate.lastIndexOf(','),
        candidate.lastIndexOf(';'),
        candidate.lastIndexOf('、'),
      );
      const cut = boundary >= 20 ? boundary : maxCharacters;
      pieces.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) pieces.push(remaining);
  }
  return pieces.map((text, index) => ({
    index,
    text,
    textHash: createHash('sha256').update(text).digest('hex'),
  }));
}
export function segmentNarrationText(input: string, maxCharacters = 450): SourceTextSegment[] {
  const cleaned = cleanNarrationText(input).text;
  const segments = segmentText(cleaned, maxCharacters);
  const source = sourceCharacters(input);
  let cursor = 0;

  return segments.map((segment) => {
    const target = Array.from(segment.text.normalize('NFC'));
    let sourceStartOffset: number | undefined;
    let sourceEndOffset: number | undefined;

    for (const character of target) {
      if (/\s/u.test(character)) continue;
      while (cursor < source.length && /\s/u.test(source[cursor]!.value)) cursor += 1;
      const matched = source[cursor];
      if (!matched || matched.value !== character) {
        throw new Error(`Unable to map narration segment ${segment.index} to chapter source`);
      }
      sourceStartOffset ??= matched.start;
      sourceEndOffset = matched.end;
      cursor += 1;
    }

    if (sourceStartOffset === undefined || sourceEndOffset === undefined) {
      throw new Error(`Narration segment ${segment.index} has no source characters`);
    }

    return {
      ...segment,
      sourceStartOffset,
      sourceEndOffset,
      sourceText: input.slice(sourceStartOffset, sourceEndOffset),
    };
  });
}
export type SubtitleCue = { index: number; startMs: number; endMs: number; text: string };
const timestamp = (ms: number): string => {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};

export function validateSubtitleCues(cues: SubtitleCue[], durationMs?: number): void {
  let previousEnd = 0;
  const indices = new Set<number>();
  for (const cue of cues) {
    if (
      !Number.isInteger(cue.index) ||
      cue.index < 1 ||
      indices.has(cue.index) ||
      cue.startMs < 0 ||
      cue.endMs <= cue.startMs ||
      cue.startMs < previousEnd ||
      !cue.text.trim()
    )
      throw new Error('Invalid or non-monotonic subtitle cue');
    if (durationMs !== undefined && cue.endMs > durationMs)
      throw new Error('Subtitle cue exceeds chapter audio duration');
    indices.add(cue.index);
    previousEnd = cue.endMs;
  }
}

export function subtitlesFromSegments(
  segments: Array<{ text: string; durationMs: number }>,
): SubtitleCue[] {
  let cursor = 0;
  const cues = segments.map((segment, index) => {
    if (!Number.isFinite(segment.durationMs) || segment.durationMs <= 0)
      throw new Error('Subtitle segment duration must be positive');
    const startMs = cursor;
    const endMs = cursor + Math.max(1, Math.round(segment.durationMs));
    cursor = endMs;
    return { index: index + 1, startMs, endMs, text: segment.text };
  });
  validateSubtitleCues(cues);
  return cues;
}

export function serializeSrt(cues: SubtitleCue[]): string {
  validateSubtitleCues(cues);
  return `${cues
    .map(
      (cue) => `${cue.index}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${cue.text}\n`,
    )
    .join('\n')}`;
}

export function parseSrt(input: string): SubtitleCue[] {
  const blocks = input
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines[1]?.match(
      /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/,
    );
    if (!timing || !lines[0]) throw new Error('Invalid SRT cue');
    const toMs = (h: string, m: string, s: string, ms: string): number =>
      Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms);
    const startMs = toMs(timing[1]!, timing[2]!, timing[3]!, timing[4]!);
    const endMs = toMs(timing[5]!, timing[6]!, timing[7]!, timing[8]!);
    cues.push({ index: Number(lines[0]), startMs, endMs, text: lines.slice(2).join('\n') });
  }
  validateSubtitleCues(cues);
  return cues;
}
