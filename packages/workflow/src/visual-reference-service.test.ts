import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  VisualProfileRepository,
  WorkflowRepository,
} from '@studio/database';
import { initializeWorkspace, ProcessRunner, type FfmpegTools } from '@studio/media';
import type { ImageProvider } from './comfyui.js';
import { VisualReferenceService } from './visual-reference-service.js';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('VisualReferenceService', () => {
  it('keeps generated prototypes as candidates until explicit approval', async () => {
    const database = createDatabase(':memory:');
    migrateDatabase(database);
    database.sqlite
      .prepare(
        "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('11111111-1111-4111-8111-111111111111','Story','vi-VN','{}','2026-01-01','2026-01-01')",
      )
      .run();
    new VisualProfileRepository(database).saveCharacter({
      projectId: '11111111-1111-4111-8111-111111111111',
      characterId: 'mai',
      payload: { ageAppearance: 'adult', bodyType: 'slim', hairColor: 'black' },
      inputFingerprint: 'profile',
      status: 'APPROVED',
    });
    const workspace = await initializeWorkspace(await mkdtemp(join(tmpdir(), 'visual-reference-')));
    const provider: ImageProvider = {
      async generate(request) {
        const stagingPath = join(workspace.staging, `${request.providerJobId}.png`);
        await writeFile(stagingPath, pngSignature);
        return {
          provider: 'COMFYUI',
          providerJobId: request.providerJobId,
          seed: request.seed,
          width: request.width,
          height: request.height,
          durationMs: 1,
          images: [
            {
              stagingPath,
              width: request.width,
              height: request.height,
              mediaType: 'image/png' as const,
            },
          ],
          warnings: [],
          metadata: {},
        };
      },
      async readiness() {
        throw new Error('not used');
      },
      async cancel() {},
    };
    const media = {
      async validateProbe() {
        return { streams: [{ codec_type: 'video', width: 1024, height: 1024 }] };
      },
    } as unknown as FfmpegTools;
    const service = new VisualReferenceService(
      { database, workspace, media, runner: new ProcessRunner() },
      provider,
    );
    const scheduled = service.schedule(
      '11111111-1111-4111-8111-111111111111',
      'CHARACTER_PROTOTYPE',
      'mai',
    );
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('test-worker');
    expect(step?.id).toBe(scheduled.stepId);
    await service.executeStep(step!);
    const candidate = service.generations.get(scheduled.generation.id)!;
    expect(candidate).toMatchObject({ status: 'COMPLETED', approval: 'CANDIDATE' });
    expect(
      service.generations.resolveApproved(
        '11111111-1111-4111-8111-111111111111',
        'CHARACTER_PROTOTYPE',
        'mai',
        1,
      ),
    ).toBeNull();
    service.review('11111111-1111-4111-8111-111111111111', candidate.id, 'APPROVED');
    expect(
      service.generations.resolveApproved(
        '11111111-1111-4111-8111-111111111111',
        'CHARACTER_PROTOTYPE',
        'mai',
        1,
      )?.assetId,
    ).toBe(candidate.assetId);
    database.sqlite.close();
  });
});
