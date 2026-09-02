import { AppError } from '@studio/shared';
import type {
  FitMode,
  MotionEasing,
  MotionPlan,
  MotionType,
  QualityPreset,
  TransitionType,
} from '@studio/shared';
import { buildCropPlan, validateCropPlan } from './crop.js';

export type MediaProfile = {
  width: number;
  height: number;
  fps: number;
  qualityPreset: QualityPreset;
};

export type SceneClipRenderInput = {
  sourcePath: string | null;
  outputPath: string;
  durationMs: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  profile: MediaProfile;
  fitMode: FitMode;
  motionPlan: Pick<
    MotionPlan,
    'motionType' | 'startScale' | 'endScale' | 'startPosition' | 'endPosition' | 'easing'
  >;
  containFill?: 'BLACK' | 'WHITE';
  fallback?: 'BLACK';
};

export type ChapterClipInput = {
  path: string;
  durationMs: number;
};

export type SubtitleStyle = {
  position: 'TOP' | 'CENTER' | 'BOTTOM';
  fontSize: number;
  outlineWidth: number;
};

export type ChapterVideoRenderInput = {
  clips: ChapterClipInput[];
  narrationPath: string;
  subtitlePath?: string;
  outputPath: string;
  durationMs: number;
  profile: MediaProfile;
  transition: TransitionType;
  transitionDurationMs: number;
  subtitleStyle?: SubtitleStyle;
  narrationVolume: number;
};

export type ProjectChapterInput = ChapterClipInput & { chapterId: string };

export type ProjectVideoRenderInput = {
  chapters: ProjectChapterInput[];
  chapterListPath: string;
  outputPath: string;
  durationMs: number;
  profile: MediaProfile;
  musicPath?: string;
  musicEnabled: boolean;
  loopMusic: boolean;
  narrationVolume: number;
  musicVolume: number;
};

type QualityProfile = { preset: 'ultrafast' | 'medium' | 'slow'; crf: number };

const QUALITY_PROFILES: Record<QualityPreset, QualityProfile> = {
  FAST_PREVIEW: { preset: 'ultrafast', crf: 30 },
  STANDARD: { preset: 'medium', crf: 23 },
  HIGH: { preset: 'slow', crf: 18 },
};

const MOTION_TYPES: Record<MotionType, true> = {
  STATIC: true,
  ZOOM_IN: true,
  ZOOM_OUT: true,
  PAN_LEFT: true,
  PAN_RIGHT: true,
  PAN_UP: true,
  PAN_DOWN: true,
  PAN_ZOOM: true,
  SLOW_PUSH_IN: true,
};

const MOTION_EASING: Record<MotionEasing, true> = {
  LINEAR: true,
  EASE_IN_OUT: true,
};

const SUBTITLE_ALIGNMENT: Record<SubtitleStyle['position'], number> = {
  TOP: 8,
  CENTER: 10,
  BOTTOM: 2,
};

function invalid(message: string): never {
  throw new AppError('INVALID_MEDIA', message, 400);
}

function validateManagedPath(value: string, name: string): void {
  if (
    !value.trim() ||
    value.includes(String.fromCharCode(0)) ||
    value.split(/[\\/]/u).some((part) => part === '..')
  ) {
    invalid(`${name} must be a managed media path`);
  }
}

function validateDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 16 || value > 16_384)
    invalid(`${name} is not a valid media dimension`);
}

function validateDuration(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 24 * 60 * 60 * 1_000) {
    invalid(`${name} must be a positive duration within 24 hours`);
  }
}

function validateProfile(profile: MediaProfile): void {
  validateDimension(profile.width, 'profile.width');
  validateDimension(profile.height, 'profile.height');
  if (!Number.isInteger(profile.fps) || profile.fps < 1 || profile.fps > 120)
    invalid('profile.fps is invalid');
  if (!(profile.qualityPreset in QUALITY_PROFILES)) invalid('profile.qualityPreset is invalid');
}

function validateMotion(motion: SceneClipRenderInput['motionPlan']): void {
  if (!(motion.motionType in MOTION_TYPES)) invalid('motionPlan.motionType is invalid');
  if (!(motion.easing in MOTION_EASING)) invalid('motionPlan.easing is invalid');
  for (const [name, value] of [
    ['startScale', motion.startScale],
    ['endScale', motion.endScale],
    ['startPosition.x', motion.startPosition.x],
    ['startPosition.y', motion.startPosition.y],
    ['endPosition.x', motion.endPosition.x],
    ['endPosition.y', motion.endPosition.y],
  ] as const) {
    if (!Number.isFinite(value)) invalid(`motionPlan.${name} must be finite`);
  }
  if (
    motion.startScale < 1 ||
    motion.startScale > 1.25 ||
    motion.endScale < 1 ||
    motion.endScale > 1.25
  ) {
    invalid('motionPlan scale is outside safe bounds');
  }
  if (
    motion.startPosition.x < 0 ||
    motion.startPosition.x > 1 ||
    motion.startPosition.y < 0 ||
    motion.startPosition.y > 1 ||
    motion.endPosition.x < 0 ||
    motion.endPosition.x > 1 ||
    motion.endPosition.y < 0 ||
    motion.endPosition.y > 1
  ) {
    invalid('motionPlan position is outside normalized bounds');
  }
}
function validateSceneClipInput(input: SceneClipRenderInput): void {
  if (input.fallback === 'BLACK') {
    if (input.sourcePath !== null || input.sourceWidth !== null || input.sourceHeight !== null)
      invalid('BLACK fallback must not include an image source');
  } else {
    if (!input.sourcePath) invalid('sourcePath is required without a fallback');
    validateManagedPath(input.sourcePath, 'sourcePath');
    if (input.sourceWidth === null || input.sourceHeight === null)
      invalid('source dimensions are required without a fallback');
    validateDimension(input.sourceWidth, 'sourceWidth');
    validateDimension(input.sourceHeight, 'sourceHeight');
  }
  validateManagedPath(input.outputPath, 'outputPath');
  validateDuration(input.durationMs, 'durationMs');
  validateProfile(input.profile);
  validateMotion(input.motionPlan);
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function number(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function seconds(milliseconds: number): string {
  return number(milliseconds / 1_000);
}

function escapeFilterPath(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

function fitFilter(input: SceneClipRenderInput, crop: ReturnType<typeof buildCropPlan>): string {
  if (input.fitMode === 'CONTAIN') {
    const fill = crop.fill === 'WHITE' ? 'white' : 'black';
    return `scale=${input.profile.width}:${input.profile.height}:force_original_aspect_ratio=decrease,pad=${input.profile.width}:${input.profile.height}:(ow-iw)/2:(oh-ih)/2:color=${fill}`;
  }
  return `scale=${even(crop.startScaledWidth)}:${even(crop.startScaledHeight)},crop=${input.profile.width}:${input.profile.height}:${Math.round(crop.startCrop.x)}:${Math.round(crop.startCrop.y)}`;
}

function hasMotion(input: SceneClipRenderInput): boolean {
  const motion = input.motionPlan;
  return (
    motion.motionType !== 'STATIC' &&
    (motion.startScale !== motion.endScale ||
      motion.startPosition.x !== motion.endPosition.x ||
      motion.startPosition.y !== motion.endPosition.y)
  );
}

function motionFilter(input: SceneClipRenderInput, crop: ReturnType<typeof buildCropPlan>): string {
  if (input.fitMode === 'CONTAIN' || !hasMotion(input)) return fitFilter(input, crop);
  const frames = Math.max(1, Math.round((input.durationMs / 1_000) * input.profile.fps));
  const frame = frames === 1 ? '0' : `n/${frames - 1}`;
  const scaleStart = crop.baseScale * input.motionPlan.startScale;
  const scaleDelta = crop.baseScale * (input.motionPlan.endScale - input.motionPlan.startScale);
  const xDelta = input.motionPlan.endPosition.x - input.motionPlan.startPosition.x;
  const yDelta = input.motionPlan.endPosition.y - input.motionPlan.startPosition.y;
  const scale = `${number(scaleStart)}+(${number(scaleDelta)})*${frame}`;
  const positionX = `${number(input.motionPlan.startPosition.x)}+(${number(xDelta)})*${frame}`;
  const positionY = `${number(input.motionPlan.startPosition.y)}+(${number(yDelta)})*${frame}`;
  return [
    `fps=${input.profile.fps}`,
    `scale=w='trunc(${input.sourceWidth}*(${scale})/2)*2':h='trunc(${input.sourceHeight}*(${scale})/2)*2':eval=frame`,
    `crop=${input.profile.width}:${input.profile.height}:x='(iw-${input.profile.width})*(${positionX})':y='(ih-${input.profile.height})*(${positionY})'`,
  ].join(',');
}

export function buildSceneClipArguments(input: SceneClipRenderInput): string[] {
  validateSceneClipInput(input);
  const quality = QUALITY_PROFILES[input.profile.qualityPreset];
  if (input.fallback === 'BLACK') {
    return [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${input.profile.width}x${input.profile.height}:r=${input.profile.fps}`,
      '-t',
      seconds(input.durationMs),
      '-an',
      '-r',
      String(input.profile.fps),
      '-c:v',
      'libx264',
      '-preset',
      quality.preset,
      '-crf',
      String(quality.crf),
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      input.outputPath,
    ];
  }
  const crop = buildCropPlan({
    sourceWidth: input.sourceWidth!,
    sourceHeight: input.sourceHeight!,
    targetWidth: input.profile.width,
    targetHeight: input.profile.height,
    fitMode: input.fitMode,
    startScale: input.motionPlan.startScale,
    endScale: input.motionPlan.endScale,
    startPosition: input.motionPlan.startPosition,
    endPosition: input.motionPlan.endPosition,
    containFill: input.containFill,
  });
  validateCropPlan(crop);
  return [
    '-y',
    '-loop',
    '1',
    '-i',
    input.sourcePath!,
    '-t',
    seconds(input.durationMs),
    '-vf',
    motionFilter(input, crop),
    '-an',
    '-r',
    String(input.profile.fps),
    '-c:v',
    'libx264',
    '-preset',
    quality.preset,
    '-crf',
    String(quality.crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    input.outputPath,
  ];
}

function validateChapterInput(input: ChapterVideoRenderInput): void {
  if (input.clips.length < 1 || input.clips.length > 2_000)
    invalid('clips must contain at least one Scene Clip');
  input.clips.forEach((clip, index) => {
    validateManagedPath(clip.path, `clips[${index}].path`);
    validateDuration(clip.durationMs, `clips[${index}].durationMs`);
  });
  validateManagedPath(input.narrationPath, 'narrationPath');
  if (input.subtitlePath) validateManagedPath(input.subtitlePath, 'subtitlePath');
  validateManagedPath(input.outputPath, 'outputPath');
  validateDuration(input.durationMs, 'durationMs');
  validateProfile(input.profile);
  if (!(
    input.transition === 'CUT' ||
    input.transition === 'CROSSFADE' ||
    input.transition === 'FADE'
  )) {
    invalid('transition is invalid');
  }
  if (
    !Number.isInteger(input.transitionDurationMs) ||
    input.transitionDurationMs < 0 ||
    input.transitionDurationMs > 8_000
  ) {
    invalid('transitionDurationMs is invalid');
  }
  if (input.transition === 'CUT' && input.transitionDurationMs !== 0)
    invalid('CUT transition must have zero duration');
  if (input.transition !== 'CUT' && input.transitionDurationMs < 300)
    invalid('Animated transitions must be at least 300ms');
  if (
    !Number.isFinite(input.narrationVolume) ||
    input.narrationVolume < 0 ||
    input.narrationVolume > 4
  ) {
    invalid('narrationVolume is invalid');
  }
  if (input.subtitleStyle) {
    if (!(input.subtitleStyle.position in SUBTITLE_ALIGNMENT))
      invalid('subtitle position is invalid');
    if (
      !Number.isInteger(input.subtitleStyle.fontSize) ||
      input.subtitleStyle.fontSize < 8 ||
      input.subtitleStyle.fontSize > 96
    ) {
      invalid('subtitle font size is invalid');
    }
    if (
      !Number.isInteger(input.subtitleStyle.outlineWidth) ||
      input.subtitleStyle.outlineWidth < 0 ||
      input.subtitleStyle.outlineWidth > 8
    ) {
      invalid('subtitle outline width is invalid');
    }
  }
  const clipDuration = input.clips.reduce((total, clip) => total + clip.durationMs, 0);
  if (input.durationMs > clipDuration)
    invalid('Chapter duration cannot exceed Scene Clip duration');
  if (input.transitionDurationMs >= Math.min(...input.clips.map((clip) => clip.durationMs))) {
    invalid('Transition duration must be shorter than every Scene Clip');
  }
}

function chapterVideoFilter(input: ChapterVideoRenderInput): string {
  const clipCount = input.clips.length;
  const duration = seconds(input.durationMs);
  const transition = input.transitionDurationMs / 1_000;
  const filters: string[] = [];
  const firstClip = input.clips.at(0);
  const lastClip = input.clips.at(-1);
  if (!firstClip || !lastClip) invalid('clips must contain at least one Scene Clip');
  for (let index = 0; index < clipCount; index += 1) {
    filters.push(`[${index}:v]setpts=PTS-STARTPTS[v${index}]`);
  }
  let output = '';
  if (input.transition === 'CUT') {
    output = `[${input.clips.map((_, index) => `v${index}`).join('][')}]concat=n=${clipCount}:v=1:a=0[chapter]`;
  } else if (input.transition === 'FADE') {
    const last = clipCount - 1;
    const fadeIn = `fade=t=in:st=0:d=${seconds(input.transitionDurationMs)}`;
    const fadeOut = `fade=t=out:st=${Math.max(0, lastClip.durationMs / 1_000 - transition)}:d=${transition}`;
    filters[0] =
      last === 0
        ? `[0:v]setpts=PTS-STARTPTS,${fadeIn},${fadeOut}[v0]`
        : `[0:v]setpts=PTS-STARTPTS,${fadeIn}[v0]`;
    if (last > 0) filters[last] = `[${last}:v]setpts=PTS-STARTPTS,${fadeOut}[v${last}]`;
    output = `[${input.clips.map((_, index) => `v${index}`).join('][')}]concat=n=${clipCount}:v=1:a=0[chapter]`;
  } else {
    let previous = '[v0]';
    let elapsedMs = firstClip.durationMs;
    for (let index = 1; index < clipCount; index += 1) {
      const next = `[vx${index}]`;
      const offset = Math.max(0, elapsedMs / 1_000 - transition);
      filters.push(
        `${previous}[v${index}]xfade=transition=fade:duration=${transition}:offset=${number(offset)}${next}`,
      );
      previous = next;
      elapsedMs += (input.clips[index]?.durationMs ?? 0) - input.transitionDurationMs;
    }
    filters.push(
      `${previous}tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[chapter]`,
    );
  }
  if (input.transition !== 'CROSSFADE') filters.push(output);
  const subtitle = input.subtitlePath
    ? `,subtitles='${escapeFilterPath(input.subtitlePath)}':force_style='FontSize=${input.subtitleStyle?.fontSize ?? 32},Outline=${input.subtitleStyle?.outlineWidth ?? 2},Alignment=${SUBTITLE_ALIGNMENT[input.subtitleStyle?.position ?? 'BOTTOM']}'`
    : '';
  filters.push(
    `[chapter]${subtitle ? `format=yuv420p${subtitle}` : 'format=yuv420p'},trim=duration=${duration},setpts=PTS-STARTPTS[video]`,
  );
  return filters.join(';');
}

export function buildChapterVideoArguments(input: ChapterVideoRenderInput): string[] {
  validateChapterInput(input);
  const audioIndex = input.clips.length;
  return [
    '-y',
    ...input.clips.flatMap((clip) => ['-i', clip.path]),
    '-i',
    input.narrationPath,
    '-filter_complex',
    `${chapterVideoFilter(input)};[${audioIndex}:a]aresample=48000,volume=${number(input.narrationVolume)},apad,atrim=duration=${seconds(input.durationMs)}[audio]`,
    '-map',
    '[video]',
    '-map',
    '[audio]',
    '-t',
    seconds(input.durationMs),
    '-r',
    String(input.profile.fps),
    '-c:v',
    'libx264',
    '-preset',
    QUALITY_PROFILES[input.profile.qualityPreset].preset,
    '-crf',
    String(QUALITY_PROFILES[input.profile.qualityPreset].crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    input.outputPath,
  ];
}

function validateProjectInput(input: ProjectVideoRenderInput): void {
  if (input.chapters.length < 1 || input.chapters.length > 500)
    invalid('chapters must contain at least one Chapter Video');
  input.chapters.forEach((chapter, index) => {
    if (!chapter.chapterId.trim()) invalid(`chapters[${index}].chapterId is required`);
    validateManagedPath(chapter.path, `chapters[${index}].path`);
    validateDuration(chapter.durationMs, `chapters[${index}].durationMs`);
  });
  validateManagedPath(input.chapterListPath, 'chapterListPath');
  validateManagedPath(input.outputPath, 'outputPath');
  validateDuration(input.durationMs, 'durationMs');
  validateProfile(input.profile);
  if (input.musicEnabled && !input.musicPath)
    invalid('musicPath is required when music is enabled');
  if (input.musicPath) validateManagedPath(input.musicPath, 'musicPath');
  if (
    !Number.isFinite(input.narrationVolume) ||
    input.narrationVolume < 0 ||
    input.narrationVolume > 4
  ) {
    invalid('narrationVolume is invalid');
  }
  if (!Number.isFinite(input.musicVolume) || input.musicVolume < 0 || input.musicVolume > 4)
    invalid('musicVolume is invalid');
  const chapterDuration = input.chapters.reduce((total, chapter) => total + chapter.durationMs, 0);
  if (input.durationMs > chapterDuration)
    invalid('Project duration cannot exceed Chapter Video duration');
}

export function buildProjectVideoArguments(input: ProjectVideoRenderInput): string[] {
  validateProjectInput(input);
  const base = ['-y', '-f', 'concat', '-safe', '0', '-i', input.chapterListPath];
  if (!input.musicEnabled) {
    return [
      ...base,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c',
      'copy',
      '-t',
      seconds(input.durationMs),
      '-movflags',
      '+faststart',
      input.outputPath,
    ];
  }
  return [
    ...base,
    ...(input.loopMusic ? ['-stream_loop', '-1'] : []),
    '-i',
    input.musicPath as string,
    '-filter_complex',
    `[0:a]aresample=48000,volume=${number(input.narrationVolume)}[narration];[1:a]aresample=48000,volume=${number(input.musicVolume)}[music];[narration][music]amix=inputs=2:duration=first:dropout_transition=2[audio]`,
    '-map',
    '0:v:0',
    '-map',
    '[audio]',
    '-t',
    seconds(input.durationMs),
    '-r',
    String(input.profile.fps),
    '-c:v',
    'libx264',
    '-preset',
    QUALITY_PROFILES[input.profile.qualityPreset].preset,
    '-crf',
    String(QUALITY_PROFILES[input.profile.qualityPreset].crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    input.outputPath,
  ];
}
