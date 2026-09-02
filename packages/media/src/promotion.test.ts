import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  initializeWorkspace,
  managedVideoRelativePath,
  promoteManagedFile,
  promoteManagedManifest,
  safeWorkspacePath,
} from './index.js';

describe('managed hierarchical promotion', () => {
  it('promotes an immutable video and returns a workspace-relative hash', async () => {
    const paths = await initializeWorkspace(join(tmpdir(), `studio-promotion-${Date.now()}`));
    const staging = 'staging/job-1/scene.mp4';
    await mkdir(dirname(safeWorkspacePath(paths.root, staging)), { recursive: true });
    await writeFile(safeWorkspacePath(paths.root, staging), Buffer.from('video-bytes'));
    const destination = managedVideoRelativePath('project-1', 'scene', 'scene-1', 1);
    const promoted = await promoteManagedFile(paths, staging, destination);
    expect(promoted.relativePath).toBe(destination);
    expect(promoted.bytes).toBe(11);
    await expect(access(safeWorkspacePath(paths.root, destination))).resolves.toBeUndefined();
    await expect(promoteManagedFile(paths, staging, destination)).rejects.toThrow('already exists');
  });

  it('writes and promotes JSON manifests without exposing partial files', async () => {
    const paths = await initializeWorkspace(join(tmpdir(), `studio-manifest-${Date.now()}`));
    const promoted = await promoteManagedManifest(
      paths,
      'staging/job-2/timeline.json',
      'projects/project-1/video/chapters/chapter-1.timeline.json',
      { durationMs: 1_000, source: 'SCENES' },
    );
    expect(await readFile(safeWorkspacePath(paths.root, promoted.relativePath), 'utf8')).toBe(
      '{"durationMs":1000,"source":"SCENES"}\n',
    );
    await expect(
      access(`${safeWorkspacePath(paths.root, promoted.relativePath)}.partial`),
    ).rejects.toThrow();
  });
});
