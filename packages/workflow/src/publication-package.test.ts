import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  AssetRepository,
  createDatabase,
  migrateDatabase,
  WorkflowRepository,
} from '@studio/database';
import { FfmpegTools, ProcessRunner, initializeWorkspace, sha256File } from '@studio/media';
import type { Id } from '@studio/shared';
import { projectVideoRole, StudioService, type StudioContext } from './index.js';

async function setup(
  probe: FfmpegTools['probe'] = async () => ({
    format: { duration: '1' },
    streams: [{ codec_type: 'video' }],
  }),
): Promise<{
  root: string;
  database: ReturnType<typeof createDatabase>;
  service: StudioService;
  projectId: Id;
  chapterIds: Id[];
}> {
  const root = await mkdtemp(join(tmpdir(), 'studio-publication-'));
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const workspace = await initializeWorkspace(root);
  const runner = new ProcessRunner();
  const media = {
    probe,
    run: async () => ({ stdout: '', stderr: '', exitCode: 0, signal: null, durationMs: 1 }),
  } as unknown as FfmpegTools;
  const context: StudioContext = { database, workspace, runner, media };
  const service = new StudioService(context);
  const project = service.createProject({
    title: 'Publication fixture',
    description: 'A package fixture',
    language: 'vi-VN',
    workflowType: 'AUDIO_STORY',
  });
  const first = service.createChapter(project.id, {
    title: 'Chapter 1',
    content: 'Một câu chuyện.',
  });
  const second = service.createChapter(project.id, {
    title: 'Chapter 2',
    content: 'Một kết thúc.',
  });
  return { root, database, service, projectId: project.id, chapterIds: [first.id, second.id] };
}

async function addAsset(
  root: string,
  assets: AssetRepository,
  projectId: Id,
  input: { role: string; type: string; mediaType: string; path: string; metadata?: unknown },
): Promise<Id> {
  const id = randomUUID();
  const absolutePath = join(root, input.path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(input.path));
  const digest = await sha256File(absolutePath);
  assets.register({
    id,
    projectId,
    type: input.type,
    role: input.role,
    path: input.path,
    mediaType: input.mediaType,
    bytes: digest.bytes,
    sha256: digest.hash,
    metadata: input.metadata,
  });
  return id;
}

describe('PublicationPackageService', () => {
  it('builds a reusable manifest and exports only workspace-relative assets', async () => {
    const fixture = await setup();
    try {
      const assets = new AssetRepository(fixture.database);
      const videoId = await addAsset(fixture.root, assets, fixture.projectId, {
        role: projectVideoRole(fixture.projectId, { kind: 'FULL_STORY' }),
        type: 'PROJECT_VIDEO',
        mediaType: 'video/mp4',
        path: 'renders/project.mp4',
      });
      for (const [index, chapterId] of fixture.chapterIds.entries()) {
        await addAsset(fixture.root, assets, fixture.projectId, {
          role: `chapter:${chapterId}:subtitle`,
          type: 'SUBTITLE',
          mediaType: 'application/x-subrip',
          path: `chapters/${index + 1}/subtitle.srt`,
        });
        await addAsset(fixture.root, assets, fixture.projectId, {
          role: `chapter:${chapterId}:audio`,
          type: 'AUDIO',
          mediaType: 'audio/mpeg',
          path: `chapters/${index + 1}/audio.mp3`,
          metadata: { durationMs: (index + 1) * 1_000 },
        });
      }

      const run = fixture.service.production.createRun(fixture.projectId, { type: 'FULL_PROJECT' });
      const first = await fixture.service.publication.build(run.id);
      expect(first.status).toBe('READY');
      expect(first.video?.assetId).toBe(videoId);
      expect(first.manifest?.packageId).toBe(first.id);
      expect(first.manifest?.chapterMarkers.map((marker) => marker.offsetMs)).toEqual([0, 1_000]);
      expect(JSON.stringify(first.manifest)).not.toContain(fixture.root);

      const updated = fixture.service.publication.updateMetadata(first.id, {
        expectedRevision: first.revision,
        title: 'Bản phát hành',
        description: 'Mô tả bản phát hành.',
      });
      expect(updated.status).toBe('STALE');
      expect(updated.metadata?.title).toBe('Bản phát hành');

      const rebuilt = await fixture.service.publication.build(run.id);
      expect(rebuilt.status).toBe('READY');
      expect(rebuilt.metadata?.title).toBe('Bản phát hành');
      expect(() => fixture.service.publication.scheduleExport(rebuilt.id, '../unsafe')).toThrow();

      const reused = await fixture.service.publication.build(run.id);
      expect(reused.id).toBe(rebuilt.id);
      expect(reused.revision).toBe(rebuilt.revision);

      const scheduled = fixture.service.publication.scheduleExport(rebuilt.id, 'release-1');
      const claimed = new WorkflowRepository(fixture.database).claim('publication-test');
      expect(claimed?.id).toBe(scheduled.stepId);
      await fixture.service.publication.executeExport(claimed!);

      const exportedManifest = JSON.parse(
        await readFile(join(fixture.root, 'exports', 'release-1', 'publication.json'), 'utf8'),
      ) as { packageId: Id; packageRevision: number };
      expect(exportedManifest.packageId).toBe(rebuilt.id);
      expect(exportedManifest.packageRevision).toBe(rebuilt.revision);
      expect(
        await readFile(join(fixture.root, 'exports', 'release-1', 'video-project.mp4'), 'utf8'),
      ).toBe('renders/project.mp4');
      expect(fixture.service.publication.exports.get(scheduled.exportId)?.status).toBe('COMPLETED');
    } finally {
      fixture.database.sqlite.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('keeps the package incomplete when the rendered video is missing', async () => {
    const fixture = await setup();
    try {
      const assets = new AssetRepository(fixture.database);
      await addAsset(fixture.root, assets, fixture.projectId, {
        role: projectVideoRole(fixture.projectId, { kind: 'FULL_STORY' }),
        type: 'PROJECT_VIDEO',
        mediaType: 'video/mp4',
        path: 'renders/project.mp4',
      });
      for (const [index, chapterId] of fixture.chapterIds.entries())
        await addAsset(fixture.root, assets, fixture.projectId, {
          role: `chapter:${chapterId}:subtitle`,
          type: 'SUBTITLE',
          mediaType: 'application/x-subrip',
          path: `chapters/${index + 1}/subtitle.srt`,
        });
      const run = fixture.service.production.createRun(fixture.projectId, { type: 'FULL_PROJECT' });
      const packageRecord = await fixture.service.publication.build(run.id);
      expect(packageRecord.status).toBe('INCOMPLETE');
      expect(packageRecord.validation.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(['AUDIO_DURATION_UNKNOWN']),
      );
      expect(packageRecord.manifest).toBeNull();
    } finally {
      fixture.database.sqlite.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('blocks a package when the current rendered video fails ffprobe', async () => {
    const fixture = await setup(async () => ({ format: { duration: '0' }, streams: [] }));
    try {
      const assets = new AssetRepository(fixture.database);
      await addAsset(fixture.root, assets, fixture.projectId, {
        role: projectVideoRole(fixture.projectId, { kind: 'FULL_STORY' }),
        type: 'PROJECT_VIDEO',
        mediaType: 'video/mp4',
        path: 'renders/project.mp4',
      });
      const run = fixture.service.production.createRun(fixture.projectId, { type: 'FULL_PROJECT' });
      const packageRecord = await fixture.service.publication.build(run.id);
      expect(packageRecord.status).toBe('INCOMPLETE');
      expect(packageRecord.validation.map((issue) => issue.code)).toContain(
        'RENDER_OUTPUT_INVALID',
      );
    } finally {
      fixture.database.sqlite.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
