import { describe, expect, it } from 'vitest';
import { ProcessError, ProcessRunner } from '@studio/media';
import { AppError } from '@studio/shared';
import { OmpAgent } from './omp-agent.js';

const request = {
  operation: 'BLUEPRINT' as const,
  model: 'openai-codex/gpt-5.6-luna',
  promptVersion: 'story.blueprint.v1',
  schemaVersion: 'story.v1',
  inputFingerprint: 'a'.repeat(64),
  systemPrompt: 'Return JSON.',
  userPrompt: 'Story data.',
};
const result = {
  kind: 'result',
  version: 1,
  operation: 'BLUEPRINT',
  text: '{"ok":true}',
  provider: 'openai-codex',
  model: 'gpt-5.6-luna',
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  durationMs: 1,
};

describe('OmpAgent', () => {
  it('rejects a terminal event with a mismatched correlation ID', async () => {
    const runner = {
      run: async () => ({
        stdout: [
          JSON.stringify({
            kind: 'progress',
            version: 1,
            correlationId: '00000000-0000-0000-0000-000000000000',
            stage: 'GENERATING',
            message: 'ignored correlation fixture',
          }),
        ].join('\n'),
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 1,
      }),
    };
    const agent = new OmpAgent(runner as unknown as ProcessRunner);
    await expect(agent.generate(request)).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });

  it('rejects duplicate terminal events', async () => {
    let correlationId = '';
    const runner = {
      run: async (options: { input?: string }) => {
        correlationId = JSON.parse(options.input!.trim()).correlationId;
        return {
          stdout: [
            JSON.stringify({ ...result, correlationId }),
            JSON.stringify({ ...result, correlationId }),
          ].join('\n'),
          stderr: '',
          exitCode: 0,
          signal: null,
          durationMs: 1,
        };
      },
    };
    const agent = new OmpAgent(runner as unknown as ProcessRunner);
    await expect(agent.generate(request)).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });

  it('surfaces typed host errors', async () => {
    const runner = {
      run: async (options: { input?: string }) => {
        const correlationId = JSON.parse(options.input!.trim()).correlationId;
        return {
          stdout: JSON.stringify({
            kind: 'error',
            version: 1,
            correlationId,
            code: 'MODEL_ERROR',
            message: 'No authenticated model is available',
            retryable: false,
          }),
          stderr: '',
          exitCode: 0,
          signal: null,
          durationMs: 1,
        };
      },
    };
    const agent = new OmpAgent(runner as unknown as ProcessRunner);
    await expect(agent.generate(request)).rejects.toBeInstanceOf(AppError);
    await expect(agent.generate(request)).rejects.toMatchObject({
      code: 'MODEL_ERROR',
      retryable: false,
    });
  });

  it('maps host timeout, cancellation, and exit to stable errors', async () => {
    const cases = [
      { message: 'Process timed out', code: 'TIMEOUT', retryable: true },
      { message: 'Process cancelled', code: 'CANCELLED', retryable: false },
      { message: 'Process exited with code 1', code: 'HOST_ERROR', retryable: true },
    ] as const;
    for (const fixture of cases) {
      const runner = {
        run: async () => {
          throw new ProcessError(
            { stdout: '', stderr: 'bounded', exitCode: 1, signal: null, durationMs: 1 },
            fixture.message,
            fixture.retryable,
          );
        },
      };
      const agent = new OmpAgent(runner as unknown as ProcessRunner);
      await expect(agent.generate(request)).rejects.toMatchObject({
        code: fixture.code,
        retryable: fixture.retryable,
      });
    }
  });

  it('rejects malformed protocol data before exposing provider output', async () => {
    let received: { timeoutMs?: number; maxOutputBytes?: number; arguments?: string[] } | undefined;
    const runner = {
      run: async (options: {
        timeoutMs?: number;
        maxOutputBytes?: number;
        arguments?: string[];
      }) => {
        received = options;
        return {
          stdout: 'not-json',
          stderr: 'provider secret should stay in the host',
          exitCode: 0,
          signal: null,
          durationMs: 1,
        };
      },
    };
    const agent = new OmpAgent(runner as unknown as ProcessRunner);
    await expect(agent.generate({ ...request, deadlineMs: 1_000 })).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
    expect(received).toMatchObject({ timeoutMs: 6_000, maxOutputBytes: 2_500_000 });
    expect(received?.arguments).toHaveLength(1);
  });

  it('preserves nullable and available usage metadata from the protocol result', async () => {
    const runner = {
      run: async (options: { input?: string }) => {
        const correlationId = JSON.parse(options.input!.trim()).correlationId;
        return {
          stdout: JSON.stringify({
            ...result,
            correlationId,
            inputTokens: 12,
            outputTokens: 34,
            costUsd: 0.02,
            costCurrency: 'USD',
            finishReason: 'stop',
          }),
          stderr: '',
          exitCode: 0,
          signal: null,
          durationMs: 1,
        };
      },
    };
    const agent = new OmpAgent(runner as unknown as ProcessRunner);
    await expect(agent.generate(request)).resolves.toMatchObject({
      inputTokens: 12,
      outputTokens: 34,
      costUsd: 0.02,
      costCurrency: 'USD',
      finishReason: 'stop',
    });
  });

  it('rejects a terminal result for a different operation', async () => {
    const runner = {
      run: async (options: { input?: string }) => {
        const correlationId = JSON.parse(options.input!.trim()).correlationId;
        return {
          stdout: JSON.stringify({ ...result, correlationId, operation: 'CHAPTER_PLANS' }),
          stderr: '',
          exitCode: 0,
          signal: null,
          durationMs: 1,
        };
      },
    };
    const agent = new OmpAgent(runner as unknown as ProcessRunner);
    await expect(agent.generate(request)).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });

  it('returns safe readiness data without credential details', async () => {
    const runner = {
      run: async () => ({
        stdout: JSON.stringify({
          ready: true,
          runtime: 'bun 1.4.0',
          model: 'openai-codex/gpt-5.6-luna',
          message: 'OMP authentication and model discovery are ready',
        }),
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 1,
      }),
    };
    const agent = new OmpAgent(runner as unknown as ProcessRunner);
    await expect(agent.readiness()).resolves.toMatchObject({
      ready: true,
      model: 'openai-codex/gpt-5.6-luna',
    });
  });
});
