import { describe, expect, it } from 'vitest';
import { FfmpegProgressParser, parseFfmpegProgress } from './index.js';

describe('FFmpeg progress parsing', () => {
  it('parses chunked out-time updates and terminal progress', () => {
    const updates: ReturnType<typeof parseFfmpegProgress> = [];
    const parser = new FfmpegProgressParser((update) => updates.push(update));
    parser.push('frame=12\nout_time_ms=1500000\nprogress=cont');
    parser.push('inue\nframe=24\nout_time=00:00:02.500000\nspeed=1.5x\nprogress=end\n');
    parser.flush();
    expect(updates).toEqual([
      {
        frame: 12,
        fps: null,
        outTimeMs: 1_500,
        totalSizeBytes: null,
        speed: null,
        progress: 'continue',
      },
      {
        frame: 24,
        fps: null,
        outTimeMs: 2_500,
        totalSizeBytes: null,
        speed: 1.5,
        progress: 'end',
      },
    ]);
  });

  it('ignores unbounded log lines and returns an empty result without progress keys', () => {
    expect(parseFfmpegProgress('ffmpeg log\nframe=1\n')).toEqual([]);
  });
});
