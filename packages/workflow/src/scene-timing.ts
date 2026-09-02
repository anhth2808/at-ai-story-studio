import type { SceneTimingItem, TimelineMode, TimelineSourceRange } from '@studio/shared';

export type TimingSceneInput = {
  sceneId: string;
  sceneRevision: number;
  sourceRange: TimelineSourceRange;
};

export type TimingNarrationSegment = {
  sourceStartOffset: number;
  sourceEndOffset: number;
  durationMs: number;
};

export type SceneTimingBuildInput = {
  scenes: TimingSceneInput[];
  segments: TimingNarrationSegment[];
  chapterLength: number;
  audioDurationMs: number;
  minimumSceneDurationMs?: number;
  mode?: TimelineMode;
};

export type SceneTimingBuildResult = {
  items: SceneTimingItem[];
  durationMs: number;
  mode: TimelineMode;
  warnings: string[];
};

const isInteger = (value: number): boolean => Number.isInteger(value) && Number.isFinite(value);
const roundMilliseconds = (value: number): number => Math.max(0, Math.round(value));

function assertSourceRange(range: TimelineSourceRange, chapterLength: number, label: string): void {
  if (
    !isInteger(range.start) ||
    !isInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > chapterLength
  ) {
    throw new Error(`${label} has an invalid source range`);
  }
}

function validateScenes(scenes: TimingSceneInput[], chapterLength: number): void {
  if (scenes.length === 0) throw new Error('Chapter has no Scenes for timing');
  let previousEnd = -1;
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (!scene.sceneId || !Number.isInteger(scene.sceneRevision) || scene.sceneRevision < 1) {
      throw new Error(`Scene ${scene.sceneId || 'unknown'} has invalid revision`);
    }
    if (ids.has(scene.sceneId)) throw new Error(`Scene ${scene.sceneId} is duplicated`);
    ids.add(scene.sceneId);
    assertSourceRange(scene.sourceRange, chapterLength, `Scene ${scene.sceneId}`);
    if (scene.sourceRange.start < previousEnd) {
      throw new Error(`Scene ${scene.sceneId} source range overlaps the previous Scene`);
    }
    previousEnd = scene.sourceRange.end;
  }
}

function buildSegmentClock(
  segments: TimingNarrationSegment[],
  chapterLength: number,
  audioDurationMs: number,
): Array<TimingNarrationSegment & { audioStartMs: number; audioEndMs: number }> {
  if (!isInteger(audioDurationMs) || audioDurationMs <= 0) {
    throw new Error('Chapter audio duration must be positive');
  }
  if (segments.length === 0) throw new Error('Chapter has no TTS timing segments');
  let audioCursor = 0;
  let previousSourceEnd = -1;
  return segments
    .map((segment, index) => {
      if (
        !isInteger(segment.sourceStartOffset) ||
        !isInteger(segment.sourceEndOffset) ||
        segment.sourceStartOffset < 0 ||
        segment.sourceEndOffset <= segment.sourceStartOffset ||
        segment.sourceEndOffset > chapterLength
      ) {
        throw new Error(`TTS segment ${index} has an invalid source range`);
      }
      if (segment.sourceStartOffset < previousSourceEnd) {
        throw new Error(`TTS segment ${index} source range overlaps the previous segment`);
      }
      if (!Number.isFinite(segment.durationMs) || segment.durationMs <= 0) {
        throw new Error(`TTS segment ${index} duration must be positive`);
      }
      const audioStartMs = audioCursor;
      audioCursor += segment.durationMs;
      previousSourceEnd = segment.sourceEndOffset;
      return { ...segment, audioStartMs, audioEndMs: audioCursor };
    })
    .map((segment, index, clock) => {
      if (index === clock.length - 1 && Math.abs(segment.audioEndMs - audioDurationMs) > 1) {
        throw new Error('TTS segment durations do not match chapter audio duration');
      }
      return {
        ...segment,
        audioStartMs: index === 0 ? 0 : clock[index - 1]!.audioEndMs,
        audioEndMs: index === clock.length - 1 ? audioDurationMs : segment.audioEndMs,
      };
    });
}

function mapSourceOffset(
  offset: number,
  clock: Array<TimingNarrationSegment & { audioStartMs: number; audioEndMs: number }>,
): number {
  const first = clock[0]!;
  if (offset <= first.sourceStartOffset) return 0;
  for (let index = 0; index < clock.length; index += 1) {
    const segment = clock[index]!;
    if (offset <= segment.sourceEndOffset) {
      const ratio =
        (offset - segment.sourceStartOffset) /
        (segment.sourceEndOffset - segment.sourceStartOffset);
      return roundMilliseconds(
        segment.audioStartMs +
          (segment.audioEndMs - segment.audioStartMs) * Math.max(0, Math.min(1, ratio)),
      );
    }
    const next = clock[index + 1];
    if (next && offset < next.sourceStartOffset) {
      return roundMilliseconds((segment.audioEndMs + next.audioStartMs) / 2);
    }
  }
  return roundMilliseconds(clock.at(-1)!.audioEndMs);
}

function reconcileBoundaries(
  rawBoundaries: number[],
  durationMs: number,
  minimumSceneDurationMs: number,
): { boundaries: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const sceneCount = rawBoundaries.length - 1;
  if (sceneCount < 1) throw new Error('Chapter has no Scene timing boundaries');
  if (durationMs < sceneCount) {
    throw new Error('Chapter audio duration cannot cover every Scene with positive duration');
  }

  const boundaries = [...rawBoundaries];
  boundaries[0] = 0;
  boundaries[boundaries.length - 1] = durationMs;
  if (durationMs < sceneCount * minimumSceneDurationMs) {
    warnings.push('Minimum Scene duration could not be applied to every Scene');
    for (let index = 1; index < boundaries.length - 1; index += 1) {
      const proportional = Math.round((durationMs * index) / sceneCount);
      boundaries[index] = Math.max(
        index,
        Math.min(durationMs - (sceneCount - index), proportional),
      );
    }
  } else {
    for (let index = 1; index < boundaries.length - 1; index += 1) {
      const lower = boundaries[index - 1]! + minimumSceneDurationMs;
      const upper = durationMs - (sceneCount - index) * minimumSceneDurationMs;
      boundaries[index] = Math.max(lower, Math.min(upper, boundaries[index]!));
    }
  }

  for (let index = 1; index < boundaries.length; index += 1) {
    if (boundaries[index]! <= boundaries[index - 1]!) {
      throw new Error(`Scene timing interval ${index} is not positive`);
    }
  }
  return { boundaries, warnings };
}

export function buildSceneTiming(input: SceneTimingBuildInput): SceneTimingBuildResult {
  const mode = input.mode ?? 'AUTO';
  const minimumSceneDurationMs = input.minimumSceneDurationMs ?? 1_500;
  if (!isInteger(input.chapterLength) || input.chapterLength < 1) {
    throw new Error('Chapter source length must be positive');
  }
  if (!isInteger(minimumSceneDurationMs) || minimumSceneDurationMs < 1) {
    throw new Error('Minimum Scene duration must be positive');
  }
  validateScenes(input.scenes, input.chapterLength);
  const clock = buildSegmentClock(input.segments, input.chapterLength, input.audioDurationMs);
  const mapped = input.scenes.map((scene) => ({
    scene,
    startMs: mapSourceOffset(scene.sourceRange.start, clock),
    endMs: mapSourceOffset(scene.sourceRange.end, clock),
  }));
  const rawBoundaries = [0];
  for (let index = 0; index < mapped.length - 1; index += 1) {
    const current = mapped[index]!;
    const next = mapped[index + 1]!;
    if (current.endMs > next.startMs) {
      throw new Error(
        `Scene timing overlaps between ${current.scene.sceneId} and ${next.scene.sceneId}`,
      );
    }
    rawBoundaries.push(roundMilliseconds((current.endMs + next.startMs) / 2));
  }
  rawBoundaries.push(input.audioDurationMs);
  const { boundaries, warnings } = reconcileBoundaries(
    rawBoundaries,
    input.audioDurationMs,
    minimumSceneDurationMs,
  );
  const items = input.scenes.map((scene, index) => {
    const raw = mapped[index]!;
    const startMs = boundaries[index]!;
    const endMs = boundaries[index + 1]!;
    return {
      sceneId: scene.sceneId,
      sceneRevision: scene.sceneRevision,
      sourceRange: scene.sourceRange,
      rawStartMs: raw.startMs,
      rawEndMs: raw.endMs,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      warning: warnings.length > 0 ? warnings[0]! : null,
    } satisfies SceneTimingItem;
  });
  return { items, durationMs: input.audioDurationMs, mode, warnings };
}

export function validateManualSceneTiming(
  scenes: TimingSceneInput[],
  items: Array<{ sceneId: string; startMs: number; endMs: number }>,
  audioDurationMs: number,
): SceneTimingItem[] {
  validateScenes(scenes, Number.MAX_SAFE_INTEGER);
  if (!isInteger(audioDurationMs) || audioDurationMs <= 0) {
    throw new Error('Chapter audio duration must be positive');
  }
  if (items.length !== scenes.length) throw new Error('Manual timing must include every Scene');
  const expectedIds = scenes.map((scene) => scene.sceneId);
  const actualIds = items.map((item) => item.sceneId);
  if (actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error('Manual timing must preserve Scene order');
  }
  let previousEnd = 0;
  const result = items.map((item, index) => {
    if (
      !isInteger(item.startMs) ||
      !isInteger(item.endMs) ||
      item.startMs < 0 ||
      item.endMs <= item.startMs
    ) {
      throw new Error(`Manual timing for Scene ${item.sceneId} must be positive`);
    }
    if (item.startMs !== previousEnd) {
      throw new Error(`Manual timing leaves a gap or overlap before Scene ${item.sceneId}`);
    }
    if (item.endMs > audioDurationMs)
      throw new Error(`Manual timing exceeds chapter audio duration`);
    previousEnd = item.endMs;
    const scene = scenes[index]!;
    return {
      sceneId: scene.sceneId,
      sceneRevision: scene.sceneRevision,
      sourceRange: scene.sourceRange,
      rawStartMs: item.startMs,
      rawEndMs: item.endMs,
      startMs: item.startMs,
      endMs: item.endMs,
      durationMs: item.endMs - item.startMs,
      warning: null,
    } satisfies SceneTimingItem;
  });
  if (previousEnd !== audioDurationMs)
    throw new Error('Manual timing must cover the full chapter audio duration');
  return result;
}
