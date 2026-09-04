import { AppError } from '@studio/shared';
import { AI_CLIP_CROSSFADE_MAX_MS } from '@studio/shared';
import type { FitMode, MotionPlan } from '@studio/shared';
import { buildCropPlan, validateCropPlan } from './crop.js';
import { QUALITY_PROFILES, type MediaProfile } from './timeline-render.js';
export type AiSceneClipRenderInput = {
  rawClipPath: string;
  rawClipDurationMs: number;
  sourceImagePath: string;
  sourceWidth: number;
  sourceHeight: number;
  outputPath: string;
  sceneDurationMs: number;
  crossfadeMs: number;
  profile: MediaProfile;
  fitMode: FitMode;
  containFill?: 'BLACK' | 'WHITE';
  continuationMotion: Pick<
    MotionPlan,
    'motionType' | 'startScale' | 'endScale' | 'startPosition' | 'endPosition' | 'easing'
  >;
};

type QualityProfile = { preset: string; crf: number };

function number(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function seconds(milliseconds: number): string {
  return number(milliseconds / 1_000);
}

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

function validateInput(input: AiSceneClipRenderInput): void {
  if (!input.rawClipPath) invalid('rawClipPath is required');
  if (!input.sourceImagePath) invalid('sourceImagePath is required');
  // Inputs are resolved by the caller via safeWorkspacePath; only the output
  // must stay a managed workspace-relative path.
  validateManagedPath(input.outputPath, 'outputPath');
  if (!Number.isFinite(input.rawClipDurationMs) || input.rawClipDurationMs <= 0)
    invalid('rawClipDurationMs must be positive');
  if (!Number.isFinite(input.sceneDurationMs) || input.sceneDurationMs <= 0)
    invalid('sceneDurationMs must be positive');
  if (!Number.isFinite(input.sourceWidth) || input.sourceWidth < 16)
    invalid('sourceWidth is invalid');
  if (!Number.isFinite(input.sourceHeight) || input.sourceHeight < 16)
    invalid('sourceHeight is invalid');
  const quality: QualityProfile | undefined = QUALITY_PROFILES[input.profile.qualityPreset];
  if (!quality) invalid('qualityPreset is invalid');
  if (
    !Number.isInteger(input.profile.width) ||
    input.profile.width < 16 ||
    !Number.isInteger(input.profile.height) ||
    input.profile.height < 16 ||
    !Number.isInteger(input.profile.fps) ||
    input.profile.fps < 1
  )
    invalid('profile is invalid');
  if (input.fitMode !== 'COVER' && input.fitMode !== 'CONTAIN') invalid('fitMode is invalid');
  if (!Number.isFinite(input.crossfadeMs) || input.crossfadeMs < 0)
    invalid('crossfadeMs must not be negative');
  if (input.crossfadeMs > AI_CLIP_CROSSFADE_MAX_MS)
    invalid(`crossfadeMs must not exceed ${AI_CLIP_CROSSFADE_MAX_MS}`);
  const composing = input.rawClipDurationMs < input.sceneDurationMs;
  if (composing && input.crossfadeMs < 1)
    invalid('AI_THEN_KEN_BURNS composition requires a positive crossfade');
  if (
    input.fitMode === 'CONTAIN' &&
    input.containFill &&
    !['BLACK', 'WHITE'].includes(input.containFill)
  )
    invalid('containFill is invalid');
}

// Segment B continues from the accepted scene image with the same bounded
// Ken Burns math the deterministic renderer uses, so AI and fallback clips
// stay visually consistent.
function continuationFilter(input: AiSceneClipRenderInput, durationMs: number): string {
  const crop = buildCropPlan({
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    targetWidth: input.profile.width,
    targetHeight: input.profile.height,
    fitMode: input.fitMode,
    startScale: input.continuationMotion.startScale,
    endScale: input.continuationMotion.endScale,
    startPosition: input.continuationMotion.startPosition,
    endPosition: input.continuationMotion.endPosition,
    containFill: input.containFill,
  });
  validateCropPlan(crop);
  if (input.fitMode === 'CONTAIN') {
    const fill = crop.fill === 'WHITE' ? 'white' : 'black';
    return `scale=${input.profile.width}:${input.profile.height}:force_original_aspect_ratio=decrease,pad=${input.profile.width}:${input.profile.height}:(ow-iw)/2:(oh-ih)/2:color=${fill}`;
  }
  const motion = input.continuationMotion;
  const frames = Math.max(1, Math.round((durationMs / 1_000) * input.profile.fps));
  const frame = frames === 1 ? '0' : `n/${frames - 1}`;
  const scaleStart = crop.baseScale * motion.startScale;
  const scaleDelta = crop.baseScale * (motion.endScale - motion.startScale);
  const xDelta = motion.endPosition.x - motion.startPosition.x;
  const yDelta = motion.endPosition.y - motion.startPosition.y;
  const scale = `${number(scaleStart)}+(${number(scaleDelta)})*${frame}`;
  const positionX = `${number(motion.startPosition.x)}+(${number(xDelta)})*${frame}`;
  const positionY = `${number(motion.startPosition.y)}+(${number(yDelta)})*${frame}`;
  return [
    `fps=${input.profile.fps}`,
    `scale=w='trunc(${input.sourceWidth}*(${scale})/2)*2':h='trunc(${input.sourceHeight}*(${scale})/2)*2':eval=frame`,
    `crop=${input.profile.width}:${input.profile.height}:x='(iw-${input.profile.width})*(${positionX})':y='(ih-${input.profile.height})*(${positionY})'`,
  ].join(',');
}

function normalizeFilter(input: AiSceneClipRenderInput): string {
  if (input.fitMode === 'CONTAIN') {
    const fill = input.containFill === 'WHITE' ? 'white' : 'black';
    return `scale=${input.profile.width}:${input.profile.height}:force_original_aspect_ratio=decrease,pad=${input.profile.width}:${input.profile.height}:(ow-iw)/2:(oh-ih)/2:color=${fill}`;
  }
  return `scale=${input.profile.width}:${input.profile.height}:force_original_aspect_ratio=increase,crop=${input.profile.width}:${input.profile.height}`;
}

function encoderArguments(quality: QualityProfile, fps: number): string[] {
  return [
    '-an',
    '-r',
    String(fps),
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
  ];
}

// AI clip duration policy: a raw clip at least as long as the scene is
// trimmed to the scene; a shorter clip plays first (AI_THEN_KEN_BURNS) and a
// short crossfade returns to the accepted scene image continued with bounded
// Ken Burns motion. LOOP_AI and TIME_STRETCH are deliberately not offered.
export function buildAiSceneClipArguments(input: AiSceneClipRenderInput): string[] {
  validateInput(input);
  const quality = QUALITY_PROFILES[input.profile.qualityPreset]!;
  const normalize = normalizeFilter(input);
  if (input.rawClipDurationMs >= input.sceneDurationMs) {
    return [
      '-y',
      '-i',
      input.rawClipPath,
      '-t',
      seconds(input.sceneDurationMs),
      '-vf',
      normalize,
      ...encoderArguments(quality, input.profile.fps),
      input.outputPath,
    ];
  }
  const crossfadeMs = input.crossfadeMs;
  const continuationDurationMs = input.sceneDurationMs - input.rawClipDurationMs + crossfadeMs;
  const offsetSeconds = seconds(input.rawClipDurationMs - crossfadeMs);
  return [
    '-y',
    '-i',
    input.rawClipPath,
    '-loop',
    '1',
    '-t',
    seconds(continuationDurationMs),
    '-i',
    input.sourceImagePath,
    '-filter_complex',
    [
      `[0:v]${normalize},settb=AVTB,fps=${input.profile.fps}[aim]`,
      `[1:v]${continuationFilter(input, continuationDurationMs)},settb=AVTB,fps=${input.profile.fps}[ken]`,
      `[aim][ken]xfade=transition=fade:duration=${seconds(crossfadeMs)}:offset=${offsetSeconds}`,
    ].join(';'),
    ...encoderArguments(quality, input.profile.fps),
    input.outputPath,
  ];
}
