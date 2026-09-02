import { describe, expect, it } from 'vitest';
import type { MotionPlan } from '@studio/shared';
import {
  buildChapterVideoArguments,
  buildProjectVideoArguments,
  buildSceneClipArguments,
  type MediaProfile,
} from './index.js';

const profile: MediaProfile = {
  width: 320,
  height: 180,
  fps: 30,
  qualityPreset: 'FAST_PREVIEW',
};

const motion: Pick<
  MotionPlan,
  'motionType' | 'startScale' | 'endScale' | 'startPosition' | 'endPosition' | 'easing'
> = {
  motionType: 'SLOW_PUSH_IN',
  startScale: 1,
  endScale: 1.08,
  startPosition: { x: 0.2, y: 0.4 },
  endPosition: { x: 0.8, y: 0.6 },
  easing: 'EASE_IN_OUT',
};

const clips = [
  { path: 'projects/p1/video/scenes/scene-1.mp4', durationMs: 1_000 },
  { path: 'projects/p1/video/scenes/scene-2.mp4', durationMs: 1_500 },
];

describe('hierarchical media compilers', () => {
  it('compiles bounded Scene Clip motion without caller-supplied filters', () => {
    const args = buildSceneClipArguments({
      sourcePath: 'projects/p1/images/scenes/scene-1.png',
      outputPath: 'projects/p1/video/scenes/scene-1.mp4',
      durationMs: 2_000,
      sourceWidth: 1_920,
      sourceHeight: 1_080,
      profile,
      fitMode: 'COVER',
      motionPlan: motion,
    });
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args[args.indexOf('-t') + 1]).toBe('2');
    expect(args[args.indexOf('-vf') + 1]).toContain('crop=320:180');
    expect(args.join(' ')).not.toContain('filter_complex=');
  });

  it.each(['CUT', 'CROSSFADE', 'FADE'] as const)(
    'compiles %s Chapter Video assembly',
    (transition) => {
      const args = buildChapterVideoArguments({
        clips,
        narrationPath: 'projects/p1/audio/chapter-1.m4a',
        subtitlePath: 'projects/p1/subtitles/chapter-1.srt',
        outputPath: 'projects/p1/video/chapters/chapter-1.mp4',
        durationMs: transition === 'CUT' ? 2_500 : 2_300,
        profile,
        transition,
        transitionDurationMs: transition === 'CUT' ? 0 : 300,
        subtitleStyle: { position: 'BOTTOM', fontSize: 24, outlineWidth: 2 },
        narrationVolume: 1,
      });
      const filter = args[args.indexOf('-filter_complex') + 1];
      expect(filter).toContain(
        transition === 'CUT' ? 'concat=' : transition === 'CROSSFADE' ? 'xfade=' : 'fade=',
      );
      expect(filter).toContain('subtitles=');
      expect(args).toContain('aac');
    },
  );

  it('adds music once at Project level and keeps copy assembly music-free', () => {
    const common = {
      chapters: [
        { chapterId: 'chapter-1', path: 'projects/p1/video/scenes/scene-1.mp4', durationMs: 1_000 },
        { chapterId: 'chapter-2', path: 'projects/p1/video/scenes/scene-2.mp4', durationMs: 1_500 },
      ],
      chapterListPath: 'projects/p1/video/chapters/concat.txt',
      outputPath: 'projects/p1/video/projects/project-1.mp4',
      durationMs: 2_500,
      profile,
      loopMusic: true,
      narrationVolume: 1,
      musicVolume: 0.15,
    };
    const withoutMusic = buildProjectVideoArguments({ ...common, musicEnabled: false });
    expect(withoutMusic).toContain('copy');
    expect(withoutMusic).not.toContain('music.mp3');

    const withMusic = buildProjectVideoArguments({
      ...common,
      musicEnabled: true,
      musicPath: 'projects/p1/music/theme.mp3',
    });
    expect(withMusic.join(' ')).toContain('theme.mp3');
    expect(withMusic.join(' ')).toContain('amix=inputs=2:duration=first');
  });

  it('rejects unsafe paths and invalid transition settings before invocation', () => {
    expect(() =>
      buildSceneClipArguments({
        sourcePath: '../outside.png',
        outputPath: 'projects/p1/video/scenes/scene.mp4',
        durationMs: 1_000,
        sourceWidth: 1_920,
        sourceHeight: 1_080,
        profile,
        fitMode: 'COVER',
        motionPlan: motion,
      }),
    ).toThrow('managed media path');
    expect(() =>
      buildChapterVideoArguments({
        clips,
        narrationPath: 'projects/p1/audio/chapter-1.m4a',
        outputPath: 'projects/p1/video/chapters/chapter-1.mp4',
        durationMs: 2_500,
        profile,
        transition: 'CUT',
        transitionDurationMs: 300,
        narrationVolume: 1,
      }),
    ).toThrow('zero duration');
  });
});
