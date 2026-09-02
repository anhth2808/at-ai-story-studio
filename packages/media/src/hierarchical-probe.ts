import type { FfmpegTools } from './index.js';

export type HierarchicalProbeExpectation = {
  width: number;
  height: number;
  fps: number;
  expectedDurationMs: number;
  durationToleranceMs?: number;
  requireAudio: boolean;
  videoCodec?: 'h264';
  videoProfile?: string;
  pixelFormat?: 'yuv420p';
  audioSampleRate?: number;
  container?: 'mp4';
};

export type ProbeDiagnostic = {
  code: string;
  message: string;
  actual: string | number | null;
  expected: string | number | null;
};

export class HierarchicalProbeError extends Error {
  constructor(public readonly diagnostics: ProbeDiagnostic[]) {
    super(diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; '));
    this.name = 'HierarchicalProbeError';
  }
}

type ProbeRecord = Record<string, unknown>;

function records(value: unknown): ProbeRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is ProbeRecord => Boolean(item) && typeof item === 'object')
    : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function numeric(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function frameRate(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return numeric(value);
  const parts = raw.split('/');
  const numerator = Number(parts[0] ?? '');
  const denominator = Number(parts[1] ?? '1');
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0)
    return null;
  return numerator / denominator;
}

function diagnostic(
  code: string,
  message: string,
  actual: string | number | null,
  expected: string | number | null,
): ProbeDiagnostic {
  return { code, message, actual, expected };
}

export function validateHierarchicalProbeDocument(
  probe: Record<string, unknown>,
  expected: HierarchicalProbeExpectation,
): void {
  const diagnostics: ProbeDiagnostic[] = [];
  const streams = records(probe.streams);
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const format = (
    probe.format && typeof probe.format === 'object' ? probe.format : {}
  ) as ProbeRecord;

  if (!video) {
    diagnostics.push(diagnostic('VIDEO_STREAM_MISSING', 'Video stream is missing', null, 'video'));
  } else {
    const width = integer(video.width);
    const height = integer(video.height);
    if (width !== expected.width)
      diagnostics.push(diagnostic('VIDEO_WIDTH', 'Video width differs', width, expected.width));
    if (height !== expected.height)
      diagnostics.push(diagnostic('VIDEO_HEIGHT', 'Video height differs', height, expected.height));
    const fps = frameRate(video.avg_frame_rate ?? video.r_frame_rate);
    if (fps === null || Math.abs(fps - expected.fps) > 0.01) {
      diagnostics.push(diagnostic('VIDEO_FPS', 'Video frame rate differs', fps, expected.fps));
    }
    if (expected.videoCodec && video.codec_name !== expected.videoCodec) {
      diagnostics.push(
        diagnostic(
          'VIDEO_CODEC',
          'Video codec is incompatible',
          text(video.codec_name),
          expected.videoCodec,
        ),
      );
    }
    if (expected.videoProfile && video.profile !== expected.videoProfile) {
      diagnostics.push(
        diagnostic(
          'VIDEO_PROFILE',
          'Video profile is incompatible',
          text(video.profile),
          expected.videoProfile,
        ),
      );
    }
    if (expected.pixelFormat && video.pix_fmt !== expected.pixelFormat) {
      diagnostics.push(
        diagnostic(
          'VIDEO_PIXEL_FORMAT',
          'Video pixel format differs',
          text(video.pix_fmt),
          expected.pixelFormat,
        ),
      );
    }
  }

  if (expected.requireAudio && !audio) {
    diagnostics.push(diagnostic('AUDIO_STREAM_MISSING', 'Audio stream is required', null, 'audio'));
  }
  if (audio && expected.audioSampleRate) {
    const sampleRate = integer(audio.sample_rate) ?? numeric(audio.sample_rate);
    if (sampleRate !== expected.audioSampleRate) {
      diagnostics.push(
        diagnostic(
          'AUDIO_SAMPLE_RATE',
          'Audio sample rate differs',
          sampleRate,
          expected.audioSampleRate,
        ),
      );
    }
  }

  const formatName = text(format.format_name);
  if (expected.container === 'mp4' && (!formatName || !formatName.split(',').includes('mp4'))) {
    diagnostics.push(diagnostic('CONTAINER', 'Output container is not MP4', formatName, 'mp4'));
  }
  const durationSeconds =
    numeric(format.duration) ?? numeric(video?.duration) ?? numeric(audio?.duration);
  const actualDurationMs = durationSeconds === null ? null : Math.round(durationSeconds * 1_000);
  const tolerance = expected.durationToleranceMs ?? 150;
  if (
    actualDurationMs === null ||
    Math.abs(actualDurationMs - expected.expectedDurationMs) > tolerance
  ) {
    diagnostics.push(
      diagnostic(
        'DURATION',
        'Output duration is outside tolerance',
        actualDurationMs,
        expected.expectedDurationMs,
      ),
    );
  }
  if (diagnostics.length > 0) throw new HierarchicalProbeError(diagnostics.slice(0, 20));
}

export async function validateHierarchicalVideo(
  tools: FfmpegTools,
  filename: string,
  expected: HierarchicalProbeExpectation,
): Promise<Record<string, unknown>> {
  const probe = await tools.probe(filename);
  validateHierarchicalProbeDocument(probe, expected);
  return probe;
}
