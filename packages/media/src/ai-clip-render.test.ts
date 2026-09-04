import { describe, expect, it } from 'vitest';
import { AI_CLIP_CROSSFADE_MAX_MS } from '@studio/shared';
import { buildAiSceneClipArguments } from './ai-clip-render.js';

const baseInput = {
  rawClipPath: 'staging/a/raw.mp4',
  rawClipDurationMs: 5_000,
  sourceImagePath: 'projects/p/images/scenes/s/current.png',
  sourceWidth: 1_920,
  sourceHeight: 1_080,
  outputPath: 'staging/a/out.mp4',
  sceneDurationMs: 37_000,
  crossfadeMs: 500,
  profile: { width: 1_920, height: 1_080, fps: 30, qualityPreset: 'STANDARD' as const },
  fitMode: 'COVER' as const,
  continuationMotion: {
    motionType: 'SLOW_PUSH_IN' as const,
    startScale: 1,
    endScale: 1.1,
    startPosition: { x: 0.5, y: 0.5 },
    endPosition: { x: 0.5, y: 0.5 },
    easing: 'EASE_IN_OUT' as const,
  },
};

describe('buildAiSceneClipArguments', () => {
  it('trims and normalizes a clip longer than the scene', () => {
    const argv = buildAiSceneClipArguments({ ...baseInput, rawClipDurationMs: 40_000 });
    const t = argv.indexOf('-t');
    expect(t).toBeGreaterThan(0);
    expect(argv[t + 1]).toBe('37');
    expect(argv.join(' ')).not.toContain('xfade');
    expect(argv).not.toContain('-loop');
    expect(argv).toContain('-an');
  });

  it('composes AI_THEN_KEN_BURNS with a crossfade for short clips', () => {
    const argv = buildAiSceneClipArguments(baseInput);
    const joined = argv.join(' ');
    expect(joined).toContain('xfade=transition=fade');
    expect(joined).toContain('duration=0.5');
    expect(joined).toContain('offset=4.5');
    expect(argv.indexOf('-i')).toBeGreaterThan(-1);
    // still image continuation input is looped
    expect(argv).toContain('-loop');
    expect(joined).toContain('trunc(');
  });

  it('rejects crossfades beyond the policy ceiling', () => {
    expect(() =>
      buildAiSceneClipArguments({ ...baseInput, crossfadeMs: AI_CLIP_CROSSFADE_MAX_MS + 1 }),
    ).toThrowError(/crossfadeMs/);
  });

  it('rejects traversal output paths before invocation', () => {
    expect(() =>
      buildAiSceneClipArguments({ ...baseInput, outputPath: '../escape.mp4' }),
    ).toThrow();
    expect(() =>
      buildAiSceneClipArguments({ ...baseInput, outputPath: 'staging/x/../escape.mp4' }),
    ).toThrow();
  });

  it('rejects non-positive durations', () => {
    expect(() => buildAiSceneClipArguments({ ...baseInput, sceneDurationMs: 0 })).toThrowError(
      /sceneDurationMs/,
    );
  });
});
