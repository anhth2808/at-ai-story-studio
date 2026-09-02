import { describe, expect, it } from 'vitest';
import { HierarchicalProbeError, validateHierarchicalProbeDocument } from './index.js';

const expected = {
  width: 320,
  height: 180,
  fps: 30,
  expectedDurationMs: 2_000,
  requireAudio: true,
  videoCodec: 'h264' as const,
  pixelFormat: 'yuv420p' as const,
  audioSampleRate: 48_000,
  container: 'mp4' as const,
};

const validProbe = {
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2.001' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 320,
      height: 180,
      avg_frame_rate: '30/1',
      pix_fmt: 'yuv420p',
      duration: '2.001',
    },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', duration: '2.001' },
  ],
};

describe('hierarchical ffprobe validation', () => {
  it('accepts compatible MP4 video and audio streams', () => {
    expect(() => validateHierarchicalProbeDocument(validProbe, expected)).not.toThrow();
  });

  it('returns bounded diagnostics for incompatible output', () => {
    try {
      validateHierarchicalProbeDocument(
        {
          ...validProbe,
          format: { format_name: 'matroska,webm', duration: '2.8' },
          streams: [
            {
              codec_type: 'video',
              width: 640,
              height: 360,
              avg_frame_rate: '24/1',
              pix_fmt: 'rgb24',
            },
          ],
        },
        expected,
      );
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HierarchicalProbeError);
      expect((error as HierarchicalProbeError).diagnostics.map((item) => item.code)).toEqual([
        'VIDEO_WIDTH',
        'VIDEO_HEIGHT',
        'VIDEO_FPS',
        'VIDEO_CODEC',
        'VIDEO_PIXEL_FORMAT',
        'AUDIO_STREAM_MISSING',
        'CONTAINER',
        'DURATION',
      ]);
    }
  });
});
