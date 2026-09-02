import { describe, expect, it } from 'vitest';
import { ProcessRunner } from './index.js';

describe('managed process cancellation', () => {
  it('terminates a running process and rejects without a publishable result', async () => {
    const controller = new AbortController();
    const promise = new ProcessRunner().run({
      executable: process.execPath,
      arguments: ['-e', 'setTimeout(() => {}, 10000)'],
      signal: controller.signal,
    });
    setImmediate(() => controller.abort());
    await expect(promise).rejects.toMatchObject({ retryable: false });
  });
});
