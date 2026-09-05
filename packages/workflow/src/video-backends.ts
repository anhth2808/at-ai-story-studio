import {
  ltxVideoFrameCountSchema,
  videoFrameCountSchema,
  type AllowedVideoFallback,
  type VideoBackend,
  type VideoGenerationRequest,
} from '@studio/shared';
import {
  IMAGE_TO_VIDEO_V1_MAPPING_VERSION,
  buildComfyUiVideoPrompt,
  type ComfyUiVideoPrompt,
} from './comfyui-video.js';
import { LTX2_19B_MAPPING_VERSION, buildLtx2VideoPrompt } from './ltx-video.js';

export type FramePlan = {
  backend: VideoBackend;
  fps: number;
  requestedDurationMs: number;
  frameCount: number;
  actualDurationMs: number;
  residualMs: number;
};

export type VideoBackendAdapter = {
  id: VideoBackend;
  mappingVersion: string;
  legalFrameCount(value: number): boolean;
  framePlan(durationMs: number, fps: number): FramePlan;
  compile(request: VideoGenerationRequest, uploadedImageName: string): ComfyUiVideoPrompt;
};

function nearestFramePlan(
  backend: VideoBackend,
  durationMs: number,
  fps: number,
  step: number,
  min: number,
  max: number,
): FramePlan {
  const raw = (durationMs * fps) / 1_000;
  const frameCount = Math.max(min, Math.min(max, Math.round((raw - 1) / step) * step + 1));
  const actualDurationMs = Math.round((frameCount * 1_000) / fps);
  return {
    backend,
    fps,
    requestedDurationMs: durationMs,
    frameCount,
    actualDurationMs,
    residualMs: actualDurationMs - durationMs,
  };
}

export const wan22Ti2v5bBackend: VideoBackendAdapter = {
  id: 'WAN22_TI2V_5B',
  mappingVersion: IMAGE_TO_VIDEO_V1_MAPPING_VERSION,
  legalFrameCount: (value) => videoFrameCountSchema.safeParse(value).success,
  framePlan: (durationMs, fps) => nearestFramePlan('WAN22_TI2V_5B', durationMs, fps, 4, 9, 241),
  compile: buildComfyUiVideoPrompt,
};

export const ltx2_19bDistilledBackend: VideoBackendAdapter = {
  id: 'LTX2_19B_DISTILLED',
  mappingVersion: LTX2_19B_MAPPING_VERSION,
  legalFrameCount: (value) => ltxVideoFrameCountSchema.safeParse(value).success,
  framePlan: (durationMs, fps) =>
    nearestFramePlan('LTX2_19B_DISTILLED', durationMs, fps, 8, 9, 1_001),
  compile: buildLtx2VideoPrompt,
};

const adapters: Record<VideoBackend, VideoBackendAdapter> = {
  WAN22_TI2V_5B: wan22Ti2v5bBackend,
  LTX2_19B_DISTILLED: ltx2_19bDistilledBackend,
};

export function resolveVideoBackend(backend: VideoBackend): VideoBackendAdapter {
  return adapters[backend];
}

export function selectVideoBackend(
  preferred: VideoBackend,
  readiness: Partial<Record<VideoBackend, boolean>>,
  fallback: AllowedVideoFallback,
): { backend: VideoBackend; fallbackUsed: boolean } | null {
  if (readiness[preferred]) return { backend: preferred, fallbackUsed: false };
  if (fallback !== 'NONE' && readiness[fallback]) return { backend: fallback, fallbackUsed: true };
  return null;
}

export function allocateFramePlans(
  backend: VideoBackend,
  durationsMs: number[],
  fps: number,
): FramePlan[] {
  const adapter = resolveVideoBackend(backend);
  const parent = adapter.framePlan(
    durationsMs.reduce((sum, value) => sum + value, 0),
    fps,
  );
  const plans = durationsMs.map((duration) => adapter.framePlan(duration, fps));
  const totalFrames = plans.reduce((sum, plan) => sum + plan.frameCount, 0);
  const difference = parent.frameCount - totalFrames;
  if (difference !== 0 && plans.length) {
    const last = plans.at(-1)!;
    const step = backend === 'LTX2_19B_DISTILLED' ? 8 : 4;
    const adjusted = last.frameCount + Math.round(difference / step) * step;
    if (adapter.legalFrameCount(adjusted)) {
      last.frameCount = adjusted;
      last.actualDurationMs = Math.round((adjusted * 1_000) / fps);
      last.residualMs = last.actualDurationMs - last.requestedDurationMs;
    }
  }
  return plans;
}
