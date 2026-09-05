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

function insertSceneGraph(
  database: ReturnType<typeof createDatabase>,
  sceneRevisionId: string,
  sceneStableId: string,
  packageId: string,
  payload: Record<string, unknown>,
): void {
  database.sqlite
    .prepare(
      'INSERT OR IGNORE INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run('chapter', 'project', 1, 'Chapter', 'Text', 'ACTIVE', 1, 1, '2026-01-01', '2026-01-01');
  database.sqlite
    .prepare(
      `INSERT OR IGNORE INTO scene_plan_revisions(
        id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'plan',
      'project',
      'chapter',
      1,
      1,
      'MEDIUM',
      'plan',
      'CURRENT',
      1,
      '2026-01-01',
      '2026-01-01',
    );
  database.sqlite
    .prepare(
      `INSERT INTO scene_revisions(
        id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,scene_number,revision,title,summary,
        purpose,source_start_offset,source_end_offset,source_content,visual_description,camera,composition,image_prompt,
        negative_prompt,input_fingerprint,prompt_version,schema_version,status,prompt_status,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      sceneRevisionId,
      sceneStableId,
      'plan',
      'project',
      'chapter',
      1,
      sceneStableId === 'scene-old' ? 1 : 2,
      1,
      'Scene',
      'Summary',
      'INTRODUCTION',
      0,
      10,
      'Text',
      'Visual',
      '{}',
      '{}',
      'Prompt',
      'Negative',
      `${sceneStableId}-fingerprint`,
      'scene-v1',
      'scene-v1',
      'CURRENT',
      'CURRENT',
      1,
      '2026-01-01',
      '2026-01-01',
    );
  database.sqlite
    .prepare(
      `INSERT INTO visual_prompt_packages(
        id,project_id,scene_revision_id,revision,status,payload,consistency_status,input_fingerprint,prompt_template_version,
        row_version,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      packageId,
      'project',
      sceneRevisionId,
      1,
      'CURRENT',
      JSON.stringify(payload),
      'PASS',
      `${sceneStableId}-package`,
      'visual-prompt-v1',
      1,
      1,
      '2026-01-01',
      '2026-01-01',
    );
}

function insertAsset(
  database: ReturnType<typeof createDatabase>,
  id: string,
  type: string,
  role: string,
  sha256: string,
  isCurrent: number,
): void {
  database.sqlite
    .prepare(
      `INSERT INTO assets(
        id,project_id,type,role,status,path,media_type,bytes,sha256,metadata,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      'project',
      type,
      role,
      'READY',
      `projects/project/${id}.bin`,
      type.includes('VIDEO') ? 'video/mp4' : 'image/png',
      1,
      sha256,
      '{}',
      isCurrent,
      '2026-01-01',
      '2026-01-01',
    );
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

  it('retires the current stage reference when the stage revision changes', () => {
    const { database, profile } = setup();
    const stages = new AppearanceStageRepository(database);
    const references = new VisualReferenceGenerationRepository(database);
    stages.saveCurrent({
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
    const reference = references.create({
      projectId: 'project',
      targetKind: 'CHARACTER_STAGE',
      targetEntityId: 'winter',
      targetRevision: 1,
      sourcePrototypeAssetId: 'prototype-asset',
      sourcePrototypeSha256: hash,
      prompt: 'winter stage reference',
      workflowTemplate: 'text-to-image-v1',
      provider: 'COMFYUI',
      settings: {},
      seed: 1,
      inputFingerprint: 'stage-reference-1',
    });
    references.complete(reference.id, 'prototype-asset', hash);
    references.approve(reference.id);
    expect(
      database.sqlite
        .prepare(
          `SELECT is_current as isCurrent
           FROM visual_reference_generations WHERE id=?`,
        )
        .get(reference.id),
    ).toEqual({ isCurrent: 1 });
    stages.saveCurrent({
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
    expect(
      database.sqlite
        .prepare(
          `SELECT is_current as isCurrent
           FROM visual_reference_generations WHERE id=?`,
        )
        .get(reference.id),
    ).toEqual({ isCurrent: 0 });
    expect(references.resolveApproved('project', 'CHARACTER_STAGE', 'winter', 1)).toBeNull();
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
  it('invalidates only descendants of the replaced reference asset', () => {
    const { database } = setup();
    const repository = new VisualReferenceGenerationRepository(database);
    const newReferenceHash = 'b'.repeat(64);
    insertAsset(
      database,
      'new-reference',
      'CHARACTER_PROTOTYPE_REFERENCE',
      'visual-reference:new',
      newReferenceHash,
      0,
    );
    const first = repository.create({
      projectId: 'project',
      targetKind: 'CHARACTER_PROTOTYPE',
      targetEntityId: 'mai',
      targetRevision: 1,
      sourcePrototypeAssetId: null,
      sourcePrototypeSha256: null,
      prompt: 'first reference',
      workflowTemplate: 'text-to-image-v1',
      provider: 'COMFYUI',
      settings: {},
      seed: 1,
      inputFingerprint: 'reference-first',
    });
    repository.complete(first.id, 'prototype-asset', hash);
    repository.approve(first.id);

    insertSceneGraph(database, 'scene-old', 'scene-old', 'package-old', {
      referenceBindings: [{ assetId: 'prototype-asset', stageId: null, revision: 1 }],
    });
    insertAsset(database, 'scene-image-old', 'SCENE_IMAGE', 'scene:scene-old:image', hash, 1);
    insertAsset(database, 'video-old', 'SCENE_VIDEO', 'scene:scene-old:ai-motion', hash, 1);
    database.sqlite
      .prepare(
        `INSERT INTO scene_image_generations(
          id,project_id,scene_stable_id,scene_revision_id,visual_prompt_package_id,revision,source,status,
          review_status,is_current,input_fingerprint,asset_id,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'image-old',
        'project',
        'scene-old',
        'scene-old',
        'package-old',
        1,
        'MANUAL',
        'COMPLETED',
        'ACCEPTED',
        1,
        'image-old',
        'scene-image-old',
        '2026-01-01',
        '2026-01-01',
      );
    database.sqlite
      .prepare(
        `INSERT INTO scene_video_generations(
          id,project_id,chapter_id,scene_stable_id,scene_revision_id,revision,status,review_status,is_current,
          input_fingerprint,source_image_asset_id,asset_id,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'video-old',
        'project',
        'chapter',
        'scene-old',
        'scene-old',
        1,
        'COMPLETED',
        'ACCEPTED',
        1,
        'video-old',
        'scene-image-old',
        'video-old',
        '2026-01-01',
        '2026-01-01',
      );
    database.sqlite
      .prepare(
        'INSERT INTO asset_dependencies(asset_id,depends_on_asset_id,role,source_hash) VALUES(?,?,?,?)',
      )
      .run('video-old', 'scene-image-old', 'source-image', hash);

    insertAsset(
      database,
      'other-reference',
      'CHARACTER_REFERENCE_IMAGE',
      'visual-reference:other',
      'c'.repeat(64),
      0,
    );
    insertSceneGraph(database, 'scene-other', 'scene-other', 'package-other', {
      referenceBindings: [{ assetId: 'other-reference', stageId: null, revision: 1 }],
    });
    insertAsset(
      database,
      'scene-image-other',
      'SCENE_IMAGE',
      'scene:scene-other:image',
      'd'.repeat(64),
      1,
    );
    database.sqlite
      .prepare(
        `INSERT INTO scene_image_generations(
          id,project_id,scene_stable_id,scene_revision_id,visual_prompt_package_id,revision,source,status,
          review_status,is_current,input_fingerprint,asset_id,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'image-other',
        'project',
        'scene-other',
        'scene-other',
        'package-other',
        1,
        'MANUAL',
        'COMPLETED',
        'ACCEPTED',
        1,
        'image-other',
        'scene-image-other',
        '2026-01-01',
        '2026-01-01',
      );

    const replacement = repository.create({
      projectId: 'project',
      targetKind: 'CHARACTER_PROTOTYPE',
      targetEntityId: 'mai',
      targetRevision: 1,
      sourcePrototypeAssetId: null,
      sourcePrototypeSha256: null,
      prompt: 'replacement reference',
      workflowTemplate: 'text-to-image-v1',
      provider: 'COMFYUI',
      settings: {},
      seed: 2,
      inputFingerprint: 'reference-second',
    });
    repository.complete(replacement.id, 'new-reference', newReferenceHash);
    repository.approve(replacement.id);

    expect(
      database.sqlite
        .prepare('SELECT status,is_current FROM visual_prompt_packages WHERE id=?')
        .get('package-old'),
    ).toEqual({ status: 'STALE', is_current: 0 });
    expect(
      database.sqlite
        .prepare('SELECT is_current FROM scene_image_generations WHERE id=?')
        .get('image-old'),
    ).toEqual({ is_current: 0 });
    expect(
      database.sqlite
        .prepare('SELECT is_current FROM scene_video_generations WHERE id=?')
        .get('video-old'),
    ).toEqual({ is_current: 0 });
    expect(
      database.sqlite.prepare('SELECT is_current FROM assets WHERE id=?').get('video-old'),
    ).toEqual({ is_current: 0 });
    expect(
      database.sqlite
        .prepare('SELECT status,is_current FROM visual_prompt_packages WHERE id=?')
        .get('package-other'),
    ).toEqual({ status: 'CURRENT', is_current: 1 });
    expect(
      database.sqlite
        .prepare('SELECT is_current FROM scene_image_generations WHERE id=?')
        .get('image-other'),
    ).toEqual({ is_current: 1 });
    database.sqlite.close();
  });
});
