import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize, relative, resolve, win32 } from 'node:path';
import { AppError } from '@studio/shared';

export type WorkspacePaths = { root: string; database: string; projects: string; staging: string };

export async function initializeWorkspace(root: string): Promise<WorkspacePaths> {
  const paths = {
    root: resolve(root),
    database: join(resolve(root), 'studio.db'),
    projects: join(resolve(root), 'projects'),
    staging: join(resolve(root), 'staging'),
  };
  await Promise.all([
    mkdir(paths.projects, { recursive: true }),
    mkdir(paths.staging, { recursive: true }),
  ]);
  return paths;
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
    ['chapters', 'audio/segments', 'subtitles', 'backgrounds', 'music', 'renders'].map((part) =>
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
    return await new Promise<ProcessResult>((resolvePromise, reject) => {
      const child = spawn(options.executable, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (result: ProcessResult, error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolvePromise(result);
      };
      const terminate = (): void => {
        if (process.platform === 'win32' && child.pid)
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            shell: false,
            windowsHide: true,
          });
        else child.kill('SIGTERM');
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < max) stdout += chunk.toString('utf8').slice(0, max - stdout.length);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < max) stderr += chunk.toString('utf8').slice(0, max - stderr.length);
      });
      const abort = (): void => {
        terminate();
        finish(
          { stdout, stderr, exitCode: null, signal: 'SIGTERM', durationMs: Date.now() - started },
          new ProcessError(
            { stdout, stderr, exitCode: null, signal: 'SIGTERM', durationMs: Date.now() - started },
            'Process cancelled',
            false,
          ),
        );
      };
      if (options.signal) {
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
      if (options.timeoutMs)
        timer = setTimeout(() => {
          terminate();
          finish(
            { stdout, stderr, exitCode: null, signal: 'SIGTERM', durationMs: Date.now() - started },
            new ProcessError(
              {
                stdout,
                stderr,
                exitCode: null,
                signal: 'SIGTERM',
                durationMs: Date.now() - started,
              },
              'Process timed out',
            ),
          );
        }, options.timeoutMs);
      child.on('error', (error) =>
        finish(
          { stdout, stderr, exitCode: null, signal: null, durationMs: Date.now() - started },
          new ProcessError(
            { stdout, stderr, exitCode: null, signal: null, durationMs: Date.now() - started },
            error.message,
            false,
          ),
        ),
      );
      child.on('close', (exitCode, signal) => {
        const result = { stdout, stderr, exitCode, signal, durationMs: Date.now() - started };
        if (exitCode === 0) finish(result);
        else
          finish(
            result,
            new ProcessError(
              result,
              `Process exited with code ${exitCode ?? signal}`,
              exitCode !== 1,
            ),
          );
      });
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
    try {
      await this.runner.run({ executable: this.ffmpeg, arguments: ['-version'], timeoutMs: 5000 });
      await this.runner.run({ executable: this.ffprobe, arguments: ['-version'], timeoutMs: 5000 });
      return { ffmpeg: true, ffprobe: true, message: 'FFmpeg and ffprobe available' };
    } catch (error) {
      return {
        ffmpeg: false,
        ffprobe: false,
        message: error instanceof Error ? error.message : 'Media tools unavailable',
      };
    }
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
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }
  async run(
    args: string[],
    options?: Omit<ProcessOptions, 'executable' | 'arguments'>,
  ): Promise<ProcessResult> {
    return await this.runner.run({ ...options, executable: this.ffmpeg, arguments: args });
  }
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
    '.srt': 'text/plain; charset=utf-8',
  };
  return types[ext] ?? 'application/octet-stream';
}

export function relativeAssetPath(workspaceRoot: string, filename: string): string {
  return relative(resolve(workspaceRoot), resolve(filename)).replaceAll('\\', '/');
}
