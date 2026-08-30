import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeWorkspacePath, sha256File } from './index.js';

describe('managed media filesystem', () => {
  it('rejects paths outside the workspace', () => {
    const root = 'C:/studio/workspace';
    expect(() => safeWorkspacePath(root, '../secret.txt')).toThrow('escapes');
    expect(() => safeWorkspacePath(root, 'C:/secret.txt')).toThrow('relative');
  });
  it('hashes identical bytes consistently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-'));
    const first = join(root, 'first.bin');
    const second = join(root, 'second.bin');
    await writeFile(first, Buffer.from('same'));
    await writeFile(second, Buffer.from('same'));
    expect(await sha256File(first)).toEqual(await sha256File(second));
  });
});
