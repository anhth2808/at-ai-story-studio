import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize, relative, resolve, win32 } from 'node:path';
import { AppError } from '@studio/shared';
import { FfmpegProgressParser } from './ffmpeg-progress.js';
import type { FfmpegProgressUpdate } from './ffmpeg-progress.js';

export type WorkspacePaths = { root: string; database: string; projects: string; staging: string };

export async function initializeWorkspace(root: string): Promise<WorkspacePaths> {
  const normalizedRoot = resolve(root);
  const paths = {
    root: normalizedRoot,
    database: join(normalizedRoot, 'studio.db'),
    projects: join(normalizedRoot, 'projects'),
    staging: join(normalizedRoot, 'staging'),
  };
  await Promise.all([
    mkdir(normalizedRoot, { recursive: true }),
    mkdir(dirname(paths.database), { recursive: true }),
    mkdir(paths.projects, { recursive: true }),
    mkdir(paths.staging, { recursive: true }),
  ]);
  return paths;
}

export type WorkspaceReconciliation = {
  removedStagingEntries: number;
  missingReferencedAssets: string[];
};

export async function reconcileWorkspace(
  paths: WorkspacePaths,
  referencedPaths: string[] = [],
  ageMs = 24 * 60 * 60 * 1000,
): Promise<WorkspaceReconciliation> {
  await initializeWorkspace(paths.root);
  const before = await readdir(paths.staging, { withFileTypes: true });
  await cleanupOldStaging(paths.staging, ageMs);
  const after = await readdir(paths.staging, { withFileTypes: true });
  const missingReferencedAssets: string[] = [];
  for (const relativePath of referencedPaths) {
    const filename = safeWorkspacePath(paths.root, relativePath);
    try {
      await access(filename);
    } catch {
      missingReferencedAssets.push(relativePath);
    }
  }
  return {
    removedStagingEntries: before.length - after.length,
    missingReferencedAssets,
  };
}

export function safeWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes(String.fromCharCode(0)) ||
    resolve(relativePath) === relativePath ||
    win32.isAbsolute(relativePath)
  )
    throw new AppError('UNSAFE_PATH', 'Only workspace-relative paths are allowed', 400);
  const candidate = resolve(workspaceRoot, normalize(relativePath));
  const root = resolve(workspaceRoot);
  if (candidate !== root && !candidate.startsWith(`${root}\\`) && !candidate.startsWith(`${root}/`))
    throw new AppError('UNSAFE_PATH', 'Path escapes the managed workspace', 400);
  return candidate;
}

export async function sha256File(filename: string): Promise<{ hash: string; bytes: number }> {
  const digest = createHash('sha256');
  let bytes = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const input = createReadStream(filename);
    input.on('data', (chunk: string | Buffer) => {
      const bytesChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += bytesChunk.length;
      digest.update(bytesChunk);
    });
    input.on('error', reject);
    input.on('end', () => resolvePromise());
  });
  return { hash: digest.digest('hex'), bytes };
}

export async function prepareProjectDirectories(
  paths: WorkspacePaths,
  projectId: string,
): Promise<void> {
  const base = join(paths.projects, projectId);
  await Promise.all(
    [
      'chapters',
      'audio/segments',
      'subtitles',
      'backgrounds',
      'music',
      'renders',
      'images/scenes',
      'video/scenes',
      'video/chapters',
      'video/projects',
      'video/scenes',
      'video/motion',
    ].map((part) => mkdir(join(base, part), { recursive: true })),
  );
}

export async function promoteFile(stagingFile: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await access(stagingFile);
  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  const source = createReadStream(stagingFile);
  const target = createWriteStream(temporary);
  await new Promise<void>((resolvePromise, reject) => {
    source.pipe(target);
    source.on('error', reject);
    target.on('error', reject);
    target.on('finish', resolvePromise);
  });
  await rm(destination, { force: true });
  await rename(temporary, destination);
}
export type HierarchicalVideoKind = 'scene' | 'chapter' | 'project';
export type ManagedPromotion = { relativePath: string; hash: string; bytes: number };

export function managedVideoRelativePath(
  projectId: string,
  kind: HierarchicalVideoKind,
  entityId: string,
  revision: number,
): string {
  if (
    !projectId.trim() ||
    !entityId.trim() ||
    /[\\/]/u.test(projectId) ||
    /[\\/]/u.test(entityId)
  ) {
    throw new AppError('UNSAFE_PATH', 'Managed video identifiers are invalid', 400);
  }
  if (!Number.isInteger(revision) || revision < 1)
    throw new AppError('INVALID_MEDIA', 'Video revision is invalid', 400);
  return `projects/${projectId}/video/${kind}s/${entityId}-r${revision}.mp4`;
}

export function managedMotionRelativePath(
  projectId: string,
  sceneStableId: string,
  generationId: string,
): string {
  if (
    !projectId.trim() ||
    !sceneStableId.trim() ||
    !generationId.trim() ||
    /[\\/]/u.test(projectId) ||
    /[\\/]/u.test(sceneStableId) ||
    /[\\/]/u.test(generationId)
  )
    throw new AppError('UNSAFE_PATH', 'Managed motion identifiers are invalid', 400);
  return `projects/${projectId}/video/motion/${sceneStableId}/${generationId}.mp4`;
}

export async function promoteManagedFile(
  paths: WorkspacePaths,
  stagingRelativePath: string,
  destinationRelativePath: string,
): Promise<ManagedPromotion> {
  const stagingFile = safeWorkspacePath(paths.root, stagingRelativePath);
  const destination = safeWorkspacePath(paths.root, destinationRelativePath);
  try {
    await access(destination);
    throw new AppError('ASSET_EXISTS', 'Managed output already exists', 409);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') throw error;
  }
  await promoteFile(stagingFile, destination);
  const file = await sha256File(destination);
  return {
    relativePath: relativeAssetPath(paths.root, destination),
    hash: file.hash,
    bytes: file.bytes,
  };
}

export async function promoteManagedManifest(
  paths: WorkspacePaths,
  stagingRelativePath: string,
  destinationRelativePath: string,
  value: unknown,
): Promise<ManagedPromotion> {
  const stagingFile = safeWorkspacePath(paths.root, stagingRelativePath);
  await mkdir(dirname(stagingFile), { recursive: true });
  await writeFile(stagingFile, `${JSON.stringify(value)}${String.fromCharCode(10)}`, 'utf8');
  return await promoteManagedFile(paths, stagingRelativePath, destinationRelativePath);
}

export type ProcessOptions = {
  executable: string;
  arguments?: string[];
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  onStdoutChunk?: (chunk: string) => void;
};
export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
};

export class ProcessError extends Error {
  constructor(
    public readonly result: ProcessResult,
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

export class ProcessRunner {
  async run(options: ProcessOptions): Promise<ProcessResult> {
    const started = Date.now();
    const args = options.arguments ?? [];
    const max = options.maxOutputBytes ?? 2_000_000;
    const inheritedKeys = [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'HOME',
      'USERPROFILE',
      'ComSpec',
    ];
    const environment: Record<string, string> = {};
    for (const key of inheritedKeys) {
      const value = process.env[key];
      if (value !== undefined) environment[key] = value;
    }
    Object.assign(environment, options.env ?? {});
    return await new Promise<ProcessResult>((resolvePromise, reject) => {
      const child = spawn(options.executable, args, {
        cwd: options.cwd,
        env: environment,
        shell: false,
        windowsHide: true,
      });
      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const result = (exitCode: number | null, signal: NodeJS.Signals | null): ProcessResult => ({
        stdout,
        stderr,
        exitCode,
        signal,
        durationMs: Date.now() - started,
      });
      const finish = (value: ProcessResult, error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolvePromise(value);
      };
      const forceTerminate = (): void => {
        if (child.exitCode !== null) return;
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            shell: false,
            windowsHide: true,
          });
        } else {
          child.kill('SIGKILL');
        }
      };
      const terminate = (): void => {
        if (process.platform === 'win32') child.kill();
        else child.kill('SIGTERM');
        setTimeout(forceTerminate, 1_000);
      };
      const abort = (): void => {
        terminate();
        const cancelled = result(null, 'SIGTERM');
        finish(cancelled, new ProcessError(cancelled, 'Process cancelled', false));
      };
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        options.onStdoutChunk?.(text);
        if (stdout.length < max) stdout += text.slice(0, max - stdout.length);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < max) stderr += chunk.toString('utf8').slice(0, max - stderr.length);
      });
      child.on('error', (error) => {
        const failed = result(null, null);
        finish(failed, new ProcessError(failed, error.message, false));
      });
      child.on('close', (exitCode, signal) => {
        const completed = result(exitCode, signal);
        if (exitCode === 0) finish(completed);
        else
          finish(
            completed,
            new ProcessError(
              completed,
              `Process exited with code ${exitCode ?? signal}`,
              exitCode !== 1,
            ),
          );
      });
      if (options.signal) {
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
      if (options.timeoutMs)
        timer = setTimeout(() => {
          terminate();
          const timedOut = result(null, 'SIGTERM');
          finish(timedOut, new ProcessError(timedOut, 'Process timed out'));
        }, options.timeoutMs);
    });
  }
}

export class FfmpegTools {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
    private readonly ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
  ) {}
  async health(): Promise<{ ffmpeg: boolean; ffprobe: boolean; message: string }> {
    let ffmpeg = false;
    let ffprobe = false;
    let ffmpegMessage = '';
    let ffprobeMessage = '';
    try {
      await this.runner.run({ executable: this.ffmpeg, arguments: ['-version'], timeoutMs: 5000 });
      ffmpeg = true;
    } catch (error) {
      ffmpegMessage = error instanceof Error ? error.message : 'FFmpeg unavailable';
    }
    try {
      await this.runner.run({ executable: this.ffprobe, arguments: ['-version'], timeoutMs: 5000 });
      ffprobe = true;
    } catch (error) {
      ffprobeMessage = error instanceof Error ? error.message : 'ffprobe unavailable';
    }
    return {
      ffmpeg,
      ffprobe,
      message:
        [ffmpegMessage, ffprobeMessage].filter(Boolean).join('; ') || 'Media tools available',
    };
  }
  async version(tool: 'ffmpeg' | 'ffprobe' = 'ffmpeg'): Promise<string> {
    const executable = tool === 'ffmpeg' ? this.ffmpeg : this.ffprobe;
    const result = await this.runner.run({ executable, arguments: ['-version'], timeoutMs: 5000 });
    return result.stdout.split(/\r?\n/u)[0] ?? '';
  }
  async encoders(): Promise<string[]> {
    const result = await this.runner.run({
      executable: this.ffmpeg,
      arguments: ['-hide_banner', '-encoders'],
      timeoutMs: 10_000,
    });
    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u)[1])
      .filter((name): name is string => Boolean(name));
  }
  async measureAudioDuration(
    filename: string,
  ): Promise<{ durationMs: number; provenance: 'DECODED_FRAMES' | 'CONTAINER_METADATA' }> {
    try {
      const result = await this.runner.run({
        executable: this.ffmpeg,
        arguments: [
          '-v',
          'error',
          '-i',
          filename,
          '-map',
          '0:a:0',
          '-f',
          'null',
          '-',
          '-progress',
          'pipe:1',
          '-nostats',
        ],
        timeoutMs: 120_000,
      });
      const times = [...result.stdout.matchAll(/^out_time_us=(\d+)$/gmu)].map((match) =>
        Number(match[1]),
      );
      const decoded = times.at(-1);
      if (decoded && Number.isFinite(decoded))
        return { durationMs: Math.round(decoded / 1_000), provenance: 'DECODED_FRAMES' };
    } catch {
      // Probe metadata remains an explicit fallback when decoding is unavailable.
    }
    const probe = await this.probe(filename);
    const seconds = Number((probe.format as { duration?: string } | undefined)?.duration ?? 0);
    const durationMs = Math.round(seconds * 1_000);
    if (durationMs < 1) throw new AppError('INVALID_MEDIA', 'Audio duration is unavailable', 400);
    return { durationMs, provenance: 'CONTAINER_METADATA' };
  }

  async detectAudioSilence(
    filename: string,
    durationMs?: number,
  ): Promise<{ totalSilenceMs: number; activityRatio: number }> {
    const duration = durationMs ?? (await this.measureAudioDuration(filename)).durationMs;
    const result = await this.runner.run({
      executable: this.ffmpeg,
      arguments: [
        '-v',
        'info',
        '-i',
        filename,
        '-af',
        'silencedetect=noise=-45dB:d=0.35',
        '-f',
        'null',
        '-',
      ],
      timeoutMs: 120_000,
    });
    const totalSilenceMs = [...result.stderr.matchAll(/silence_duration: ([0-9.]+)/gu)].reduce(
      (sum, match) => sum + Math.round(Number(match[1]) * 1_000),
      0,
    );
    return {
      totalSilenceMs,
      activityRatio: Math.max(0, 1 - totalSilenceMs / duration),
    };
  }
  async extractVideoFrame(
    input: string,
    output: string,
    positionMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!Number.isFinite(positionMs) || positionMs < 0)
      throw new AppError('INVALID_INPUT', 'Frame position must be non-negative', 400);
    await this.runner.run({
      executable: this.ffmpeg,
      arguments: [
        '-y',
        '-ss',
        (positionMs / 1_000).toFixed(3),
        '-i',
        input,
        '-frames:v',
        '1',
        '-update',
        '1',
        output,
      ],
      timeoutMs: 60_000,
      ...(signal ? { signal } : {}),
    });
    await this.validateProbe(output, 'image');
  }

  async extractFinalVideoFrame(input: string, output: string, signal?: AbortSignal): Promise<void> {
    await this.runner.run({
      executable: this.ffmpeg,
      arguments: ['-y', '-sseof', '-0.05', '-i', input, '-frames:v', '1', '-update', '1', output],
      timeoutMs: 60_000,
      ...(signal ? { signal } : {}),
    });
    await this.validateProbe(output, 'image');
  }
  async probe(filename: string): Promise<Record<string, unknown>> {
    const result = await this.runner.run({
      executable: this.ffprobe,
      arguments: [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filename,
      ],
      timeoutMs: 30_000,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new ProcessError(result, 'ffprobe returned invalid JSON', false);
    }
    if (!parsed || typeof parsed !== 'object')
      throw new ProcessError(result, 'ffprobe returned an invalid probe document', false);
    return parsed as Record<string, unknown>;
  }
  async validateProbe(
    filename: string,
    expected: 'audio' | 'video' | 'image',
  ): Promise<Record<string, unknown>> {
    const probe = await this.probe(filename);
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const expectedType = expected === 'image' ? 'video' : expected;
    const valid = streams.some(
      (stream) =>
        stream &&
        typeof stream === 'object' &&
        'codec_type' in stream &&
        stream.codec_type === expectedType,
    );
    if (!valid)
      throw new ProcessError(
        { stdout: '', stderr: '', exitCode: 1, signal: null, durationMs: 0 },
        `Media is not a valid ${expected}`,
        false,
      );
    return probe;
  }
  async run(
    args: string[],
    options?: Omit<ProcessOptions, 'executable' | 'arguments'>,
  ): Promise<ProcessResult> {
    return await this.runner.run({ ...options, executable: this.ffmpeg, arguments: args });
  }
  async runWithProgress(
    args: string[],
    onProgress: (progress: FfmpegProgressUpdate) => void,
    options?: Omit<ProcessOptions, 'executable' | 'arguments' | 'onStdoutChunk'>,
  ): Promise<ProcessResult> {
    const parser = new FfmpegProgressParser(onProgress);
    const result = await this.runner.run({
      ...options,
      executable: this.ffmpeg,
      arguments: ['-progress', 'pipe:1', '-nostats', ...args],
      onStdoutChunk: (chunk) => parser.push(chunk),
    });
    parser.flush();
    return result;
  }
}
export type MediaValidationKind = 'audio' | 'image' | 'video' | 'subtitle' | 'mp4';

export async function validateMediaFile(
  tools: FfmpegTools,
  filename: string,
  kind: MediaValidationKind,
): Promise<Record<string, unknown> | null> {
  const info = await stat(filename);
  if (!info.isFile() || info.size === 0)
    throw new AppError('INVALID_MEDIA', 'Media file is empty', 400);
  if (kind === 'subtitle') {
    const content = await readFile(filename, 'utf8');
    if (!/^\s*\d+\s*\r?\n\d{2}:\d{2}:\d{2},\d{3}\s+-->/u.test(content))
      throw new AppError('INVALID_MEDIA', 'Subtitle file is not valid SRT', 400);
    return null;
  }
  return await tools.validateProbe(filename, kind === 'mp4' ? 'video' : kind);
}

export type ValidatedImage = {
  format: 'png' | 'jpeg' | 'webp';
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  probe: Record<string, unknown>;
};

export async function validateImageFile(
  tools: FfmpegTools,
  filename: string,
): Promise<ValidatedImage> {
  const info = await stat(filename);
  if (!info.isFile() || info.size === 0)
    throw new AppError('INVALID_MEDIA', 'Image file is empty', 400);
  const handle = await open(filename, 'r');
  const signature = Buffer.alloc(12);
  try {
    const result = await handle.read(signature, 0, signature.length, 0);
    const bytes = signature.subarray(0, result.bytesRead);
    const format =
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ? 'png'
        : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? 'jpeg'
          : bytes.length >= 12 &&
              bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
              bytes.subarray(8, 12).toString('ascii') === 'WEBP'
            ? 'webp'
            : null;
    if (!format) throw new AppError('INVALID_MEDIA', 'Image format is not supported', 400);
    const probe = await tools.validateProbe(filename, 'image');
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const stream = streams.find((value): value is Record<string, unknown> => {
      if (!value || typeof value !== 'object') return false;
      const candidate = value as Record<string, unknown>;
      return (
        candidate.codec_type === 'video' &&
        Number.isInteger(candidate.width) &&
        Number.isInteger(candidate.height) &&
        Number(candidate.width) >= 16 &&
        Number(candidate.height) >= 16
      );
    });
    const width = stream ? Number(stream.width) : 0;
    const height = stream ? Number(stream.height) : 0;
    if (!stream || width > 16_384 || height > 16_384)
      throw new AppError('INVALID_MEDIA', 'Image dimensions are invalid', 400);
    return {
      format,
      mediaType: format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp',
      width,
      height,
      probe,
    };
  } finally {
    await handle.close();
  }
}
export type ValidatedRawVideo = {
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  frameCount: number;
  codec: string;
  probe: Record<string, unknown>;
};

// Raw AI provider output must be a real, readable, sane video file before it
// may be persisted as an Asset. Strict format normalization happens later at
// the SceneClip stage; this gate only rejects corrupt or empty output.
export async function validateRawAiVideo(
  tools: FfmpegTools,
  filename: string,
): Promise<ValidatedRawVideo> {
  const info = await stat(filename);
  if (!info.isFile() || info.size === 0)
    throw new AppError('INVALID_MEDIA', 'Raw AI video file is empty', 400);
  const probe = await tools.validateProbe(filename, 'video');
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const stream = streams.find((value): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return candidate.codec_type === 'video' && Number(candidate.width) >= 16;
  });
  if (!stream) throw new AppError('INVALID_MEDIA', 'Raw AI video has no usable video stream', 400);
  const width = Number(stream.width);
  const height = Number(stream.height);
  const rateText = String(stream.avg_frame_rate ?? stream.r_frame_rate ?? '0/1');
  const rateParts = rateText.split('/').map((value) => Number(value));
  const rateNum = rateParts[0] ?? 0;
  const rateDen = rateParts[1] ?? 0;
  const fps = rateDen ? rateNum / rateDen : 0;
  const format = (probe.format ?? {}) as Record<string, unknown>;
  const durationSeconds = Number(format.duration ?? 0);
  const frameCount = Number(stream.nb_frames ?? 0);
  if (
    !Number.isFinite(width) ||
    width < 16 ||
    width > 16_384 ||
    !Number.isFinite(height) ||
    height < 16 ||
    height > 16_384 ||
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 240 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    throw new AppError('INVALID_MEDIA', 'Raw AI video probe values are not plausible', 400);
  return {
    width,
    height,
    durationMs: Math.round(durationSeconds * 1_000),
    fps,
    frameCount: Number.isFinite(frameCount) ? frameCount : Math.round(durationSeconds * fps),
    codec: String(stream.codec_name ?? 'unknown'),
    probe,
  };
}
export type RenderArguments = {
  backgroundPath: string;
  backgroundType: 'BACKGROUND_IMAGE' | 'BACKGROUND_VIDEO';
  narrationPath: string;
  subtitlePath?: string;
  subtitleFontSize: number;
  musicPath?: string;
  loopMusic: boolean;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  narrationVolume: number;
  musicVolume: number;
};

export function buildConcatArguments(listPath: string, outputPath: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];
}

export function buildRenderArguments(input: RenderArguments): string[] {
  const videoInput =
    input.backgroundType === 'BACKGROUND_IMAGE'
      ? ['-loop', '1', '-i', input.backgroundPath]
      : ['-stream_loop', '-1', '-i', input.backgroundPath];
  const subtitleFilter = input.subtitlePath
    ? `,subtitles='${input.subtitlePath.replaceAll('\\', '/').replaceAll(':', '\\:')}':force_style='FontSize=${input.subtitleFontSize}'`
    : '';
  const scale = `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`;
  const audio = input.musicPath
    ? [
        '-i',
        input.narrationPath,
        ...(input.loopMusic ? ['-stream_loop', '-1'] : []),
        '-i',
        input.musicPath,
        '-filter_complex',
        `[1:a]volume=${input.narrationVolume}[n];[2:a]volume=${input.musicVolume}[m];[n][m]amix=inputs=2:duration=first:dropout_transition=2[a]`,
        '-map',
        '0:v:0',
        '-map',
        '[a]',
      ]
    : [
        '-i',
        input.narrationPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-filter:a',
        `volume=${input.narrationVolume}`,
      ];
  return [
    '-y',
    ...videoInput,
    ...audio,
    '-t',
    String(input.durationSeconds),
    '-vf',
    scale,
    '-r',
    String(input.fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
  ];
}

export async function cleanupOldStaging(root: string, ageMs = 24 * 60 * 60 * 1000): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  const threshold = Date.now() - ageMs;
  for (const entry of entries) {
    const filename = join(root, entry.name);
    const info = await stat(filename);
    if (info.mtimeMs < threshold) await rm(filename, { recursive: true, force: true });
  }
}

export function contentTypeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const types: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.srt': 'text/plain; charset=utf-8',
  };
  return types[ext] ?? 'application/octet-stream';
}

export function relativeAssetPath(workspaceRoot: string, filename: string): string {
  const root = resolve(workspaceRoot);
  const absolute = resolve(filename);
  const value = relative(root, absolute).replaceAll('\\', '/');
  if (!value || value === '..' || value.startsWith('../'))
    throw new AppError('UNSAFE_PATH', 'Path is outside the managed workspace', 400);
  return value;
}
export * from './crop.js';
export * from './ffmpeg-progress.js';
export * from './ai-clip-render.js';
export * from './timeline-render.js';
export * from './hierarchical-probe.js';
