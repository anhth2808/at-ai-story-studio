import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize, relative, resolve, win32 } from 'node:path';
import { AppError } from '@studio/shared';

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
    ['chapters', 'audio/segments', 'subtitles', 'backgrounds', 'music', 'renders', 'images/scenes'].map((part) =>
      mkdir(join(base, part), { recursive: true }),
    ),
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

export type ProcessOptions = {
  executable: string;
  arguments?: string[];
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
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
        if (stdout.length < max) stdout += chunk.toString('utf8').slice(0, max - stdout.length);
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
