import { describe, expect, it } from 'vitest';
import { buildSceneTiming, validateManualSceneTiming } from './scene-timing.js';

describe('SceneTiming', () => {
  const scenes = [
    { sceneId: 'scene-1', sceneRevision: 1, sourceRange: { start: 0, end: 25 } },
    { sceneId: 'scene-2', sceneRevision: 1, sourceRange: { start: 25, end: 50 } },
    { sceneId: 'scene-3', sceneRevision: 1, sourceRange: { start: 50, end: 75 } },
    { sceneId: 'scene-4', sceneRevision: 1, sourceRange: { start: 75, end: 100 } },
  ];

  it('maps segment edges to cumulative measured audio time', () => {
    const result = buildSceneTiming({
      scenes,
      segments: [
        { sourceStartOffset: 0, sourceEndOffset: 50, durationMs: 1_000 },
        { sourceStartOffset: 50, sourceEndOffset: 100, durationMs: 1_000 },
      ],
      chapterLength: 100,
      audioDurationMs: 2_000,
      minimumSceneDurationMs: 1,
    });
    expect(
      result.items.map(({ startMs, endMs, rawStartMs, rawEndMs }) => ({
        startMs,
        endMs,
        rawStartMs,
        rawEndMs,
      })),
    ).toEqual([
      { startMs: 0, endMs: 500, rawStartMs: 0, rawEndMs: 500 },
      { startMs: 500, endMs: 1_000, rawStartMs: 500, rawEndMs: 1_000 },
      { startMs: 1_000, endMs: 1_500, rawStartMs: 1_000, rawEndMs: 1_500 },
      { startMs: 1_500, endMs: 2_000, rawStartMs: 1_500, rawEndMs: 2_000 },
    ]);
  });

  it('interpolates a boundary inside a TTS segment', () => {
    const result = buildSceneTiming({
      scenes: [{ sceneId: 'scene-1', sceneRevision: 1, sourceRange: { start: 10, end: 30 } }],
      segments: [{ sourceStartOffset: 0, sourceEndOffset: 100, durationMs: 1_000 }],
      chapterLength: 100,
      audioDurationMs: 1_000,
      minimumSceneDurationMs: 1,
    });
    expect(result.items[0]).toMatchObject({
      rawStartMs: 100,
      rawEndMs: 300,
      startMs: 0,
      endMs: 1_000,
    });
  });

  it('closes source gaps without leaving visual timeline gaps', () => {
    const result = buildSceneTiming({
      scenes: [
        { sceneId: 'scene-1', sceneRevision: 1, sourceRange: { start: 0, end: 20 } },
        { sceneId: 'scene-2', sceneRevision: 1, sourceRange: { start: 30, end: 100 } },
      ],
      segments: [{ sourceStartOffset: 0, sourceEndOffset: 100, durationMs: 1_000 }],
      chapterLength: 100,
      audioDurationMs: 1_000,
      minimumSceneDurationMs: 1,
    });
    expect(result.items.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 250],
      [250, 1_000],
    ]);
  });

  it('rejects invalid manual coverage and preserves scene order', () => {
    expect(() =>
      validateManualSceneTiming(
        scenes.slice(0, 2),
        [
          { sceneId: 'scene-1', startMs: 0, endMs: 400 },
          { sceneId: 'scene-2', startMs: 450, endMs: 1_000 },
        ],
        1_000,
      ),
    ).toThrow('gap or overlap');
    expect(() =>
      validateManualSceneTiming(
        scenes.slice(0, 2),
        [
          { sceneId: 'scene-2', startMs: 0, endMs: 500 },
          { sceneId: 'scene-1', startMs: 500, endMs: 1_000 },
        ],
        1_000,
      ),
    ).toThrow('preserve Scene order');
  });
});
