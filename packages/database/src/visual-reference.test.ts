import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from './db.js';
import { VisualProfileRepository } from './visual.js';
import {
  AppearanceStageRepository,
  VisualReferenceGenerationRepository,
} from './visual-reference.js';

const hash = 'a'.repeat(64);

function setup() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Visual test','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      `INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,metadata,is_current,created_at,updated_at)
       VALUES('prototype-asset','project','CHARACTER_PROTOTYPE_IMAGE','CHARACTER_PROTOTYPE_IMAGE','READY','projects/project/prototype.png','image/png',1,?,'{}',1,'2026-01-01','2026-01-01')`,
    )
    .run(hash);
  const profile = new VisualProfileRepository(database).saveCharacter({
    projectId: 'project',
    characterId: 'mai',
    payload: { ageAppearance: 'adult', bodyType: 'slim', hairColor: 'black' },
    inputFingerprint: 'profile-fingerprint',
    status: 'APPROVED',
  });
  return { database, profile };
}

describe('visual reference repositories', () => {
  it('keeps appearance stage history immutable after current promotion', () => {
    const { database, profile } = setup();
    const repository = new AppearanceStageRepository(database);
    const first = repository.saveCurrent({
      stableId: 'winter',
      projectId: 'project',
      characterId: 'mai',
      profileId: profile.id,
      profileRevision: profile.revision,
      name: 'Winter',
      payload: { clothing: ['winter coat'], accessories: [], equipment: [] },
      provenance: {
        mode: 'EXPLICIT',
        chapterId: null,
        sceneId: null,
        evidence: 'winter coat',
        confidence: 1,
        reason: 'Explicit clothing',
      },
      inputFingerprint: 'stage-1',
    });
    const second = repository.saveCurrent({
      stableId: 'winter',
      projectId: 'project',
      characterId: 'mai',
      profileId: profile.id,
      profileRevision: profile.revision,
      name: 'Winter',
      payload: { clothing: ['blue winter coat'], accessories: [], equipment: [] },
      provenance: {
        mode: 'EXPLICIT',
        chapterId: null,
        sceneId: null,
        evidence: 'blue winter coat',
        confidence: 1,
        reason: 'Explicit clothing',
      },
      inputFingerprint: 'stage-2',
      expectedRevision: 1,
    });
    expect(first).toMatchObject({ revision: 1, isCurrent: true });
    expect(second).toMatchObject({ revision: 2, isCurrent: true });
    expect(repository.get('project', first.id)).toMatchObject({ revision: 1, isCurrent: false });
    expect(repository.listCharacter('project', 'mai')).toHaveLength(2);
    database.sqlite.close();
  });

  it('requires explicit approval and resolves only exact target identity and revision', () => {
    const { database } = setup();
    const repository = new VisualReferenceGenerationRepository(database);
    const generation = repository.create({
      projectId: 'project',
      targetKind: 'CHARACTER_PROTOTYPE',
      targetEntityId: 'mai',
      targetRevision: 1,
      sourcePrototypeAssetId: null,
      sourcePrototypeSha256: null,
      prompt: 'canonical model sheet',
      workflowTemplate: 'text-to-image-v1',
      provider: 'COMFYUI',
      settings: {},
      seed: 1,
      inputFingerprint: 'reference-1',
    });
    expect(repository.resolveApproved('project', 'CHARACTER_PROTOTYPE', 'mai', 1)).toBeNull();
    repository.complete(generation.id, 'prototype-asset', hash);
    expect(repository.resolveApproved('project', 'CHARACTER_PROTOTYPE', 'mai', 1)).toBeNull();
    repository.approve(generation.id);
    expect(repository.resolveApproved('project', 'CHARACTER_PROTOTYPE', 'mai', 1)?.assetId).toBe(
      'prototype-asset',
    );
    expect(repository.resolveApproved('project', 'CHARACTER_PROTOTYPE', 'other', 1)).toBeNull();
    expect(repository.resolveApproved('project', 'CHARACTER_PROTOTYPE', 'mai', 2)).toBeNull();
    database.sqlite.close();
  });
});
