import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, VisualProfileRepository } from './index.js';
import type { DatabaseHandle } from './db.js';

function setup(): DatabaseHandle {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Visual test','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO locations(id,project_id,name,normalized_name,created_at,updated_at) VALUES('location','project','Sân trong','san trong','2026-01-01','2026-01-01')",
    )
    .run();
  return database;
}

const characterPayload = {
  ageAppearance: 'adult',
  bodyType: 'slim',
  hairColor: 'black',
  distinctiveFeatures: ['small scar'],
};

const locationPayload = {
  environmentType: 'courtyard',
  overallDescription: 'A quiet courtyard with old stone walls.',
};

const objectPayload = {
  name: 'Old wooden door',
  description: 'A weathered wooden door with iron hinges.',
};

describe('VisualProfileRepository', () => {
  it('keeps draft candidates and approves a selected revision', () => {
    const database = setup();
    const repository = new VisualProfileRepository(database);

    const first = repository.saveCharacter({
      projectId: 'project',
      characterId: 'mai',
      payload: characterPayload,
      inputFingerprint: 'character-1',
    });
    expect(first.status).toBe('DRAFT');
    expect(first.revision).toBe(1);

    const candidate = repository.saveCharacter({
      projectId: 'project',
      characterId: 'mai',
      payload: { ...characterPayload, hairColor: 'dark brown' },
      inputFingerprint: 'character-2',
    });
    expect(candidate.revision).toBe(2);
    expect(repository.getCharacter('project', 'mai')?.revision).toBe(1);

    const approved = repository.approveCharacter('project', 'mai', 2, candidate.rowVersion);
    expect(approved.status).toBe('APPROVED');
    expect(repository.getCharacter('project', 'mai')?.id).toBe(candidate.id);
    expect(repository.listCharacterRevisions('project', 'mai')).toHaveLength(2);
    expect(() => repository.approveCharacter('project', 'mai', 2, candidate.rowVersion)).toThrow(
      /conflict/i,
    );
    database.sqlite.close();
  });

  it('persists location and object profiles without crossing project boundaries', () => {
    const database = setup();
    const repository = new VisualProfileRepository(database);

    const location = repository.saveLocation({
      projectId: 'project',
      locationId: 'location',
      locationName: 'Sân trong',
      payload: locationPayload,
      inputFingerprint: 'location-1',
    });
    const object = repository.saveObject({
      projectId: 'project',
      objectKey: 'old wooden door',
      name: 'Old wooden door',
      payload: objectPayload,
      inputFingerprint: 'object-1',
    });
    expect(location.payload.overallDescription).toContain('quiet courtyard');
    expect(object.objectKey).toBe('old wooden door');
    expect(repository.getObjectById('project', object.id)?.id).toBe(object.id);
    expect(() =>
      repository.saveObject({
        projectId: 'other-project',
        objectKey: 'other',
        name: 'Other',
        payload: objectPayload,
        inputFingerprint: 'object-2',
      }),
    ).toThrow(/project not found/i);
    database.sqlite.close();
  });
  it('validates project-owned reference asset roles before persistence', () => {
    const database = setup();
    const repository = new VisualProfileRepository(database);
    database.sqlite
      .prepare(
        `INSERT INTO assets(
          id,project_id,type,role,status,path,media_type,bytes,sha256,metadata,is_current,created_at,updated_at
        ) VALUES('asset','project','CHARACTER_REFERENCE_IMAGE','CHARACTER_REFERENCE_IMAGE','READY',
          'projects/project/character-reference.png','image/png',1,'hash','{}',1,'2026-01-01','2026-01-01')`,
      )
      .run();
    const saved = repository.saveCharacter({
      projectId: 'project',
      characterId: 'mai',
      payload: { ...characterPayload, referenceAssetIds: ['asset'] },
      inputFingerprint: 'character-reference',
    });
    expect(saved.payload.referenceAssetIds).toEqual(['asset']);
    expect(() =>
      repository.saveCharacter({
        projectId: 'project',
        characterId: 'other',
        payload: { ...characterPayload, referenceAssetIds: ['missing'] },
        inputFingerprint: 'invalid-reference',
      }),
    ).toThrow(/reference assets/i);
    database.sqlite.close();
  });
  it('migrates the additive visual tables and Style Bible columns', () => {
    const database = setup();
    const styleColumns = database.sqlite
      .prepare('PRAGMA table_info(visual_style_settings)')
      .all() as Array<{ name: string }>;
    expect(styleColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'overall_style',
        'lighting_style',
        'mood_keywords',
        'positive_prompt_suffix',
        'negative_prompt',
        'reference_asset_ids',
      ]),
    );
    for (const table of [
      'character_visual_profiles',
      'location_visual_profiles',
      'visual_object_profiles',
      'scene_object_resolutions',
      'visual_prompt_packages',
      'visual_prompt_package_dependencies',
    ])
      expect(
        database.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table),
      ).toEqual({ name: table });
    database.sqlite.close();
  });
});
