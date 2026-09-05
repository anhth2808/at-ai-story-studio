import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AppError,
  DEFAULT_OMP_MODEL,
  ompProtocolErrorSchema,
  ompProtocolRequestSchema,
  ompReadinessSchema,
  parseOmpProtocolLine,
  type GenerationOperation,
  type OmpProtocolEvent,
  type OmpReadiness,
} from '@studio/shared';
import { ProcessError, ProcessRunner } from '@studio/media';

export type AiAgentRequest = {
  operation: GenerationOperation;
  model: string | null;
  promptVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  systemPrompt: string;
  userPrompt: string;
  imagePaths?: string[];
  deadlineMs?: number;
};

export type AiAgentResult = {
  operation: GenerationOperation;
  text: string;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costCurrency?: string | null;
  finishReason?: string | null;
  durationMs: number;
};
export type AiAgentProgress = (event: Extract<OmpProtocolEvent, { kind: 'progress' }>) => void;

export interface AiAgent {
  generate(
    request: AiAgentRequest,
    signal?: AbortSignal,
    onProgress?: AiAgentProgress,
  ): Promise<AiAgentResult>;
}

function protocolError(code: string, message: string, retryable: boolean): AppError {
  const known = ompProtocolErrorSchema.shape.code.safeParse(code).data;
  return new AppError(
    known ?? 'HOST_ERROR',
    message,
    code === 'TIMEOUT' || code === 'CANCELLED' ? 409 : 502,
    retryable,
  );
}

function parseOutput(stdout: string, correlationId: string): AiAgentResult {
  let terminal: AiAgentResult | undefined;
  for (const line of stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    let event: OmpProtocolEvent;
    try {
      event = parseOmpProtocolLine(line);
    } catch {
      throw protocolError('PROTOCOL_ERROR', 'OMP host returned invalid protocol data', false);
    }
    if (event.correlationId !== correlationId)
      throw protocolError('PROTOCOL_ERROR', 'OMP host correlation ID mismatch', false);
    if (event.kind === 'progress') continue;
    if (terminal)
      throw protocolError('PROTOCOL_ERROR', 'OMP host returned duplicate terminal events', false);
    if (event.kind === 'error') throw protocolError(event.code, event.message, event.retryable);
    terminal = event;
  }
  if (!terminal) throw protocolError('PROTOCOL_ERROR', 'OMP host returned no terminal event', true);
  return terminal;
}

export type OmpAgentOptions = {
  executable?: string;
  script?: string;
  cwd?: string;
  maxOutputBytes?: number;
};

export class OmpAgent implements AiAgent {
  private readonly executable: string;
  private readonly script: string;
  private readonly cwd: string;
  private readonly maxOutputBytes: number;

  constructor(
    private readonly runner: ProcessRunner,
    options: OmpAgentOptions = {},
  ) {
    this.executable = options.executable ?? process.env.BUN_EXECUTABLE ?? 'bun';
    this.script =
      options.script ??
      process.env.OMP_AGENT_SCRIPT ??
      fileURLToPath(new URL('../../../apps/omp-agent/src/index.ts', import.meta.url));
    this.cwd =
      options.cwd ?? process.env.STUDIO_WORKSPACE ?? join(dirname(this.script), '../../..');
    this.maxOutputBytes = options.maxOutputBytes ?? 2_500_000;
  }

  async generate(
    request: AiAgentRequest,
    signal?: AbortSignal,
    onProgress?: AiAgentProgress,
  ): Promise<AiAgentResult> {
    const correlationId = randomUUID();
    const protocolRequest = ompProtocolRequestSchema.parse({
      kind: 'request',
      version: 1,
      correlationId,
      operation: request.operation,
      model: request.model ?? DEFAULT_OMP_MODEL,
      promptVersion: request.promptVersion,
      schemaVersion: request.schemaVersion,
      inputFingerprint: request.inputFingerprint,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      deadlineMs: request.deadlineMs ?? 120_000,
      ...(request.imagePaths?.length ? { imagePaths: request.imagePaths } : {}),
    });
    let result;
    try {
      result = await this.runner.run({
        executable: this.executable,
        arguments: [this.script],
        cwd: this.cwd,
        input: `${JSON.stringify(protocolRequest)}\n`,
        timeoutMs: protocolRequest.deadlineMs + 5_000,
        signal,
        maxOutputBytes: this.maxOutputBytes,
      });
    } catch (error) {
      if (error instanceof ProcessError) {
        if (signal?.aborted || error.message === 'Process cancelled')
          throw protocolError('CANCELLED', 'Story generation was cancelled', false);
        if (error.message === 'Process timed out')
          throw protocolError('TIMEOUT', 'Story generation timed out', true);
        throw protocolError('HOST_ERROR', 'OMP host process failed', error.retryable);
      }
      throw error;
    }
    try {
      for (const line of result.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)) {
        const event = parseOmpProtocolLine(line);
        if (event.correlationId === correlationId && event.kind === 'progress') onProgress?.(event);
      }
      const parsed = parseOutput(result.stdout, correlationId);
      if (parsed.operation !== request.operation)
        throw protocolError('PROTOCOL_ERROR', 'OMP host operation mismatch', false);
      return parsed;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw protocolError('PROTOCOL_ERROR', 'OMP host response could not be parsed', false);
    }
  }
  async readiness(): Promise<OmpReadiness> {
    try {
      const result = await this.runner.run({
        executable: this.executable,
        arguments: [this.script, '--readiness'],
        cwd: this.cwd,
        timeoutMs: 20_000,
        maxOutputBytes: 20_000,
      });
      return ompReadinessSchema.parse(JSON.parse(result.stdout.trim()));
    } catch {
      return {
        ready: false,
        runtime: 'bun',
        model: null,
        message: 'OMP runtime or authentication is not ready',
      };
    }
  }
}

export function createOmpAgent(runner: ProcessRunner, options: OmpAgentOptions = {}): OmpAgent {
  return new OmpAgent(runner, options);
}
