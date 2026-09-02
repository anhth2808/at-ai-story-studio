import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FfmpegTools,
  ProcessError,
  ProcessRunner,
  buildChapterVideoArguments,
  buildProjectVideoArguments,
  buildSceneClipArguments,
  validateHierarchicalVideo,
  type MediaProfile,
} from './index.js';

describe('real hierarchical FFmpeg fixture', () => {
  it('renders a Scene Clip, Chapter Video, and Project Video with measured durations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-ffmpeg-'));
    const tools = new FfmpegTools(new ProcessRunner());
    const profile: MediaProfile = {
      width: 320,
      height: 180,
      fps: 30,
      qualityPreset: 'FAST_PREVIEW',
    };
    const image = join(root, 'source.png');
    const narration = join(root, 'narration.m4a');
    const subtitle = join(root, 'chapter.srt');
    const sceneOne = join(root, 'scene-one.mp4');
    const sceneTwo = join(root, 'scene-two.mp4');
    const chapter = join(root, 'chapter-one.mp4');
    const project = join(root, 'project.mp4');
    const list = join(root, 'chapters.txt');

    await tools.run(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360', '-frames:v', '1', image]);
    await tools.run([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '2',
      '-c:a',
      'aac',
      narration,
    ]);
    await writeFile(subtitle, '1\n00:00:00,000 --> 00:00:01,000\nA test line.\n');

    const sceneInput = {
      sourcePath: image,
      durationMs: 1_000,
      sourceWidth: 640,
      sourceHeight: 360,
      profile,
      fitMode: 'COVER' as const,
      motionPlan: {
        motionType: 'SLOW_PUSH_IN' as const,
        startScale: 1,
        endScale: 1.05,
        startPosition: { x: 0.5, y: 0.5 },
        endPosition: { x: 0.55, y: 0.5 },
        easing: 'LINEAR' as const,
      },
    };
    const sceneProgress: number[] = [];
    await tools.runWithProgress(
      buildSceneClipArguments({ ...sceneInput, outputPath: sceneOne }),
      (progress) => {
        if (progress.outTimeMs !== null) sceneProgress.push(progress.outTimeMs);
      },
    );
    expect(sceneProgress.length).toBeGreaterThan(0);
    await tools.run(
      buildSceneClipArguments({
        ...sceneInput,
        outputPath: sceneTwo,
        motionPlan: {
          ...sceneInput.motionPlan,
          motionType: 'STATIC',
          endScale: 1,
          endPosition: { x: 0.5, y: 0.5 },
        },
      }),
    );
    await validateHierarchicalVideo(tools, sceneOne, {
      width: 320,
      height: 180,
      fps: 30,
      expectedDurationMs: 1_000,
      requireAudio: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      container: 'mp4',
    });

    for (const transition of ['CUT', 'CROSSFADE', 'FADE'] as const) {
      const transitionDurationMs = transition === 'CUT' ? 0 : 300;
      const expectedDurationMs = transition === 'CROSSFADE' ? 1_700 : 2_000;
      const chapterPath =
        transition === 'CUT' ? chapter : join(root, `chapter-${transition.toLowerCase()}.mp4`);
      try {
        await tools.run(
          buildChapterVideoArguments({
            clips: [
              { path: sceneOne, durationMs: 1_000 },
              { path: sceneTwo, durationMs: 1_000 },
            ],
            narrationPath: narration,
            subtitlePath: subtitle,
            outputPath: chapterPath,
            durationMs: expectedDurationMs,
            profile,
            transition,
            transitionDurationMs,
            subtitleStyle: { position: 'BOTTOM', fontSize: 18, outlineWidth: 2 },
            narrationVolume: 1,
          }),
        );
      } catch (error) {
        if (error instanceof ProcessError) throw new Error(`${transition}: ${error.result.stderr}`);
        throw error;
      }
      await validateHierarchicalVideo(tools, chapterPath, {
        ...profile,
        expectedDurationMs,
        requireAudio: true,
        videoCodec: 'h264',
        pixelFormat: 'yuv420p',
        audioSampleRate: 48_000,
        container: 'mp4',
      });
    }

    await writeFile(list, "file 'chapter-one.mp4'\n");
    await tools.run(
      buildProjectVideoArguments({
        chapters: [{ chapterId: 'chapter-1', path: chapter, durationMs: 2_000 }],
        chapterListPath: list,
        outputPath: project,
        durationMs: 2_000,
        profile,
        musicEnabled: false,
        loopMusic: false,
        narrationVolume: 1,
        musicVolume: 0.15,
      }),
      { cwd: root },
    );
    const projectProbe = await validateHierarchicalVideo(tools, project, {
      ...profile,
      expectedDurationMs: 2_000,
      requireAudio: true,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioSampleRate: 48_000,
      container: 'mp4',
    });
    expect(projectProbe).toHaveProperty('streams');
  }, 120_000);
  it('renders an explicit BLACK fallback at the target profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-ffmpeg-black-'));
    const tools = new FfmpegTools(new ProcessRunner());
    const output = join(root, 'black.mp4');
    await tools.run(
      buildSceneClipArguments({
        sourcePath: null,
        outputPath: output,
        durationMs: 500,
        sourceWidth: null,
        sourceHeight: null,
        profile: { width: 320, height: 180, fps: 30, qualityPreset: 'FAST_PREVIEW' },
        fitMode: 'COVER',
        fallback: 'BLACK',
        motionPlan: {
          motionType: 'STATIC',
          startScale: 1,
          endScale: 1,
          startPosition: { x: 0.5, y: 0.5 },
          endPosition: { x: 0.5, y: 0.5 },
          easing: 'LINEAR',
        },
      }),
    );
    await validateHierarchicalVideo(tools, output, {
      width: 320,
      height: 180,
      fps: 30,
      expectedDurationMs: 500,
      requireAudio: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      container: 'mp4',
    });
  }, 120_000);
  it('renders three chapters into one music-backed project video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-ffmpeg-project-'));
    const tools = new FfmpegTools(new ProcessRunner());
    const profile: MediaProfile = {
      width: 320,
      height: 180,
      fps: 30,
      qualityPreset: 'FAST_PREVIEW',
    };
    const colors = ['red', 'green', 'blue'] as const;
    const chapterPaths: string[] = [];
    const chapterDurations = colors.map(() => 1_000);

    for (const [index, color] of colors.entries()) {
      const image = join(root, `scene-${index + 1}.png`);
      const narration = join(root, `narration-${index + 1}.m4a`);
      const scene = join(root, `scene-clip-${index + 1}.mp4`);
      const chapter = join(root, `chapter-${index + 1}.mp4`);
      await tools.run([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=320x180`,
        '-frames:v',
        '1',
        image,
      ]);
      await tools.run([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${440 + index * 80}:sample_rate=48000`,
        '-t',
        '1',
        '-c:a',
        'aac',
        narration,
      ]);
      await tools.run(
        buildSceneClipArguments({
          sourcePath: image,
          outputPath: scene,
          durationMs: 1_000,
          sourceWidth: 320,
          sourceHeight: 180,
          profile,
          fitMode: 'COVER',
          motionPlan: {
            motionType: index === 0 ? 'STATIC' : 'SLOW_PUSH_IN',
            startScale: 1,
            endScale: index === 0 ? 1 : 1.05,
            startPosition: { x: 0.5, y: 0.5 },
            endPosition: { x: 0.5, y: 0.5 },
            easing: 'LINEAR',
          },
        }),
      );
      await tools.run(
        buildChapterVideoArguments({
          clips: [{ path: scene, durationMs: 1_000 }],
          narrationPath: narration,
          outputPath: chapter,
          durationMs: 1_000,
          profile,
          transition: 'CUT',
          transitionDurationMs: 0,
          narrationVolume: 1,
        }),
      );
      await validateHierarchicalVideo(tools, chapter, {
        ...profile,
        expectedDurationMs: 1_000,
        requireAudio: true,
        videoCodec: 'h264',
        pixelFormat: 'yuv420p',
        audioSampleRate: 48_000,
        container: 'mp4',
      });
      chapterPaths.push(chapter);
    }

    const chapterList = join(root, 'chapters.txt');
    await writeFile(
      chapterList,
      chapterPaths
        .map((path) => `file '${path.split(/[\\\\/]/u).at(-1)}'`)
        .join('\n')
        .concat('\n'),
    );
    const music = join(root, 'music.m4a');
    const project = join(root, 'three-chapter-project.mp4');
    await tools.run([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=48000',
      '-t',
      '0.75',
      '-c:a',
      'aac',
      music,
    ]);
    await tools.run(
      buildProjectVideoArguments({
        chapters: chapterPaths.map((path, index) => ({
          chapterId: `chapter-${index + 1}`,
          path,
          durationMs: chapterDurations[index] ?? 1_000,
        })),
        chapterListPath: chapterList,
        outputPath: project,
        durationMs: 3_000,
        profile,
        musicPath: music,
        musicEnabled: true,
        loopMusic: true,
        narrationVolume: 1,
        musicVolume: 0.15,
      }),
      { cwd: root },
    );
    const projectProbe = await validateHierarchicalVideo(tools, project, {
      ...profile,
      expectedDurationMs: 3_000,
      requireAudio: true,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioSampleRate: 48_000,
      container: 'mp4',
    });
    expect(projectProbe).toHaveProperty('streams');
  }, 120_000);
});
