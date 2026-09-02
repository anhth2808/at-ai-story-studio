export type FfmpegProgressUpdate = {
  frame: number | null;
  fps: number | null;
  outTimeMs: number | null;
  totalSizeBytes: number | null;
  speed: number | null;
  progress: 'continue' | 'end';
};

function finiteNumber(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationMilliseconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/u.exec(value);
  if (!match) return finiteNumber(value);
  const fraction = Number(`0.${match[4] ?? '0'}`);
  return (Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]) + fraction) * 1_000;
}

function readUpdate(values: Record<string, string>): FfmpegProgressUpdate | null {
  const progress = values.progress;
  if (progress !== 'continue' && progress !== 'end') return null;
  const speedValue = values.speed?.replace(/x$/u, '');
  const rawMilliseconds = finiteNumber(values.out_time_ms);
  const rawMicroseconds = finiteNumber(values.out_time_us);
  return {
    frame: finiteNumber(values.frame),
    fps: finiteNumber(values.fps),
    outTimeMs:
      durationMilliseconds(values.out_time) ??
      (rawMilliseconds === null ? null : rawMilliseconds / 1_000) ??
      (rawMicroseconds === null ? null : rawMicroseconds / 1_000),
    totalSizeBytes: finiteNumber(values.total_size),
    speed: finiteNumber(speedValue),
    progress,
  };
}

export class FfmpegProgressParser {
  private buffer = '';
  private values: Record<string, string> = {};

  constructor(private readonly onUpdate: (update: FfmpegProgressUpdate) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024) this.buffer = this.buffer.slice(-32 * 1024);
    const lines = this.buffer.split(/\r?\n/u);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.readLine(line);
  }

  flush(): void {
    if (this.buffer) this.readLine(this.buffer);
    this.buffer = '';
    this.emit();
  }

  private readLine(line: string): void {
    const separator = line.indexOf('=');
    if (separator <= 0) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'progress') {
      this.values.progress = value;
      this.emit();
      return;
    }
    if (
      key === 'frame' ||
      key === 'fps' ||
      key === 'out_time' ||
      key === 'out_time_ms' ||
      key === 'out_time_us' ||
      key === 'total_size' ||
      key === 'speed'
    ) {
      this.values[key] = value;
    }
  }

  private emit(): void {
    const update = readUpdate(this.values);
    if (!update) return;
    this.onUpdate(update);
    this.values = {};
  }
}

export function parseFfmpegProgress(text: string): FfmpegProgressUpdate[] {
  const updates: FfmpegProgressUpdate[] = [];
  const parser = new FfmpegProgressParser((update) => updates.push(update));
  parser.push(text);
  parser.flush();
  return updates;
}
