import { strict as assert } from 'node:assert';
import { execPath } from 'node:process';
import { describe, expect, it } from 'vitest';
import { ProcessError, ProcessRunner } from './index.js';

describe('ProcessRunner', () => {
  it('passes stdin without shell interpolation and bounds output', async () => {
    const runner = new ProcessRunner();
    const result = await runner.run({
      executable: execPath,
      arguments: [
        '-e',
        "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>process.stdout.write(d))",
      ],
      input: 'safe-input',
      maxOutputBytes: 4,
      timeoutMs: 5_000,
    });
    expect(result.stdout).toBe('safe');
    expect(result.exitCode).toBe(0);
  });

  it('reports timeout and cancellation as process errors', async () => {
    const runner = new ProcessRunner();
    await expect(
      runner.run({
        executable: execPath,
        arguments: ['-e', 'setTimeout(()=>{}, 60000)'],
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ message: 'Process timed out' });
    const controller = new AbortController();
    const promise = runner.run({
      executable: execPath,
      arguments: ['-e', 'setTimeout(()=>{}, 60000)'],
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(
      promise,
      (error: unknown) => error instanceof ProcessError && error.message === 'Process cancelled',
    );
  });
});
