import { randomUUID } from 'node:crypto';
import {
  AppError,
  characterVisualProfilePayloadSchema,
  characterVisualProfileDtoSchema,
  locationVisualProfilePayloadSchema,
  locationVisualProfileDtoSchema,
  sceneObjectResolutionSchema,
  visualObjectProfilePayloadSchema,
  visualObjectProfileDtoSchema,
  visualObjectResolutionStatusSchema,
  visualProfileStatusSchema,
  visualPromptPackageDtoSchema,
  visualPromptPackagePayloadSchema,
  visualPromptDependencySchema,
  type CharacterVisualProfileDto,
  type CharacterVisualProfilePayloadInput,
  type Id,
  type LocationVisualProfileDto,
  type LocationVisualProfilePayloadInput,
  type SceneObjectResolution,
  type VisualObjectProfileDto,
  type VisualObjectProfilePayloadInput,
  type VisualObjectResolutionStatus,
  type VisualPromptDependency,
  type VisualPromptPackageDto,
  type VisualPromptPackageListItem,
  type VisualPromptPackagePayload,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const parseJson = (value: string): unknown => JSON.parse(value);
const clampLimit = (value: number): number => Math.max(1, Math.min(100, value));
const clampOffset = (value: number): number => Math.max(0, value);
const referenceTypes = {
  CHARACTER: 'CHARACTER_REFERENCE_IMAGE',
  LOCATION: 'LOCATION_REFERENCE_IMAGE',
  OBJECT: 'OBJECT_REFERENCE_IMAGE',
  STYLE: 'STYLE_REFERENCE_IMAGE',
} as const;

function assertProject(database: DatabaseHandle, projectId: Id): void {
  const row = database.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId);
  if (!row) throw new AppError('NOT_FOUND', 'Project not found', 404);
}

function assertReferences(
  database: DatabaseHandle,
  projectId: Id,
  assetIds: string[],
  kind: keyof typeof referenceTypes,
): void {
  const uniqueIds = [...new Set(assetIds)];
  if (!uniqueIds.length) return;
  const placeholders = uniqueIds.map(() => '?').join(',');
  const approvalFilter =
    kind === 'CHARACTER' ? " AND json_extract(metadata,'$.approval')='APPROVED'" : '';
  const rows = database.sqlite
    .prepare(
      `SELECT id,type FROM assets WHERE project_id=? AND id IN (${placeholders}) AND status='READY'${approvalFilter}`,
    )
    .all(projectId, ...uniqueIds) as Array<{ id: string; type: string }>;
  if (rows.length !== uniqueIds.length || rows.some((row) => row.type !== referenceTypes[kind]))
    throw new AppError(
      'INVALID_REFERENCE',
      kind === 'CHARACTER'
        ? 'Character references must be project-owned READY assets in APPROVED state'
        : 'Reference assets must belong to the project and use the allowed role',
      400,
    );
}

function parseProfilePayload<T>(value: string, schema: { parse(input: unknown): T }): T {
  return schema.parse(parseJson(value));
}

function profileConflict(message = 'Profile revision conflict'): AppError {
  return new AppError('CONFLICT', message, 409);
}

type ProfileInsert = {
  id: Id;
  projectId: Id;
  kind: 'CHARACTER' | 'LOCATION' | 'OBJECT';
  key: string;
  name: string;
  revision: number;
  status: 'DRAFT' | 'APPROVED';
  payload: unknown;
  promptFragment: string;
  referenceAssetIds: string[];
  inputFingerprint: string;
  generationId?: Id | null;
  isCurrent: boolean;
};
export type CharacterVisualProfileRevisionInput = {
  projectId: Id;
  characterId: string;
  payload: CharacterVisualProfilePayloadInput;
  promptFragment?: string;
  inputFingerprint: string;
  generationId?: Id | null;
  status?: 'DRAFT' | 'APPROVED';
  referenceAssetIds?: string[];
};

export type LocationVisualProfileRevisionInput = {
  projectId: Id;
  locationId: Id;
  locationName: string;
  payload: LocationVisualProfilePayloadInput;
  promptFragment?: string;
  inputFingerprint: string;
  generationId?: Id | null;
  status?: 'DRAFT' | 'APPROVED';
  referenceAssetIds?: string[];
};

export type VisualObjectProfileRevisionInput = {
  projectId: Id;
  objectKey: string;
  name: string;
  payload: VisualObjectProfilePayloadInput;
  promptFragment?: string;
  inputFingerprint: string;
  generationId?: Id | null;
  status?: 'DRAFT' | 'APPROVED';
  referenceAssetIds?: string[];
};

export type VisualProfilePage<T> = {
  items: T[];
  limit: number;
  offset: number;
};

export class VisualProfileRepository {
  constructor(private readonly database: DatabaseHandle) {}

  getCharacter(
    projectId: Id,
    characterId: string,
    revision?: number,
  ): CharacterVisualProfileDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,character_id as characterId,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,row_version as rowVersion,
          created_at as createdAt,updated_at as updatedAt
         FROM character_visual_profiles
         WHERE project_id=? AND character_id=? AND (? IS NULL AND is_current=1 OR revision=?)
         ORDER BY revision DESC LIMIT 1`,
      )
      .get(projectId, characterId, revision ?? null, revision ?? null) as ProfileRow | undefined;
    return row ? parseCharacter(row) : null;
  }

  listCharacters(
    projectId: Id,
    limit = 50,
    offset = 0,
  ): VisualProfilePage<CharacterVisualProfileDto> {
    const boundedLimit = clampLimit(limit);
    const boundedOffset = clampOffset(offset);
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,character_id as characterId,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,row_version as rowVersion,
          created_at as createdAt,updated_at as updatedAt
         FROM character_visual_profiles
         WHERE project_id=? AND is_current=1 ORDER BY character_id LIMIT ? OFFSET ?`,
      )
      .all(projectId, boundedLimit, boundedOffset) as ProfileRow[];
    return { items: rows.map(parseCharacter), limit: boundedLimit, offset: boundedOffset };
  }

  listCharacterRevisions(
    projectId: Id,
    characterId: string,
    limit = 50,
    offset = 0,
  ): CharacterVisualProfileDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,character_id as characterId,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,row_version as rowVersion,
          created_at as createdAt,updated_at as updatedAt
         FROM character_visual_profiles WHERE project_id=? AND character_id=?
         ORDER BY revision DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, characterId, clampLimit(limit), clampOffset(offset)) as ProfileRow[];
    return rows.map(parseCharacter);
  }

  saveCharacter(input: CharacterVisualProfileRevisionInput): CharacterVisualProfileDto {
    const payload = characterVisualProfilePayloadSchema.parse(input.payload);
    const referenceAssetIds = input.referenceAssetIds ?? payload.referenceAssetIds;
    assertProject(this.database, input.projectId);
    assertReferences(this.database, input.projectId, referenceAssetIds, 'CHARACTER');
    payload.referenceAssetIds = referenceAssetIds;
    const revision = this.nextRevision(
      'character_visual_profiles',
      'character_id',
      input.projectId,
      input.characterId,
    );
    this.insertProfile({
      id: randomUUID(),
      projectId: input.projectId,
      kind: 'CHARACTER',
      key: input.characterId,
      name: input.characterId,
      revision,
      status: input.status ?? 'DRAFT',
      payload,
      promptFragment: input.promptFragment ?? '',
      referenceAssetIds,
      inputFingerprint: input.inputFingerprint,
      generationId: input.generationId,
      isCurrent:
        input.status === 'APPROVED' || !this.getCharacter(input.projectId, input.characterId),
    });
    return this.getCharacter(input.projectId, input.characterId, revision)!;
  }

  approveCharacter(
    projectId: Id,
    characterId: string,
    revision: number,
    expectedRowVersion?: number,
  ): CharacterVisualProfileDto {
    return this.approve(
      'character_visual_profiles',
      'character_id',
      projectId,
      characterId,
      revision,
      expectedRowVersion,
      (row) => parseCharacter(row),
    );
  }

  getLocation(projectId: Id, locationId: Id, revision?: number): LocationVisualProfileDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT p.id,p.project_id as projectId,p.location_id as locationId,p.location_name as locationName,
          p.revision,p.status,p.payload,p.prompt_fragment as promptFragment,p.input_fingerprint as inputFingerprint,
          p.reference_asset_ids as referenceAssetIds,p.generation_id as generationId,p.row_version as rowVersion,
          p.created_at as createdAt,p.updated_at as updatedAt
         FROM location_visual_profiles p
         WHERE p.project_id=? AND p.location_id=? AND (? IS NULL AND p.is_current=1 OR p.revision=?)
         ORDER BY p.revision DESC LIMIT 1`,
      )
      .get(projectId, locationId, revision ?? null, revision ?? null) as ProfileRow | undefined;
    return row ? parseLocation(row) : null;
  }

  listLocations(
    projectId: Id,
    limit = 50,
    offset = 0,
  ): VisualProfilePage<LocationVisualProfileDto> {
    const boundedLimit = clampLimit(limit);
    const boundedOffset = clampOffset(offset);
    const rows = this.database.sqlite
      .prepare(
        `SELECT p.id,p.project_id as projectId,p.location_id as locationId,p.location_name as locationName,
          p.revision,p.status,p.payload,p.prompt_fragment as promptFragment,p.input_fingerprint as inputFingerprint,
          p.reference_asset_ids as referenceAssetIds,p.generation_id as generationId,p.row_version as rowVersion,
          p.created_at as createdAt,p.updated_at as updatedAt
         FROM location_visual_profiles p
         WHERE p.project_id=? AND p.is_current=1 ORDER BY p.location_name LIMIT ? OFFSET ?`,
      )
      .all(projectId, boundedLimit, boundedOffset) as ProfileRow[];
    return { items: rows.map(parseLocation), limit: boundedLimit, offset: boundedOffset };
  }

  listLocationRevisions(
    projectId: Id,
    locationId: Id,
    limit = 50,
    offset = 0,
  ): LocationVisualProfileDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT p.id,p.project_id as projectId,p.location_id as locationId,p.location_name as locationName,
          p.revision,p.status,payload,p.prompt_fragment as promptFragment,p.input_fingerprint as inputFingerprint,
          p.reference_asset_ids as referenceAssetIds,p.generation_id as generationId,p.row_version as rowVersion,
          p.created_at as createdAt,p.updated_at as updatedAt
         FROM location_visual_profiles p WHERE p.project_id=? AND p.location_id=?
         ORDER BY p.revision DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, locationId, clampLimit(limit), clampOffset(offset)) as ProfileRow[];
    return rows.map(parseLocation);
  }

  saveLocation(input: LocationVisualProfileRevisionInput): LocationVisualProfileDto {
    const payload = locationVisualProfilePayloadSchema.parse(input.payload);
    const referenceAssetIds = input.referenceAssetIds ?? payload.referenceAssetIds;
    assertProject(this.database, input.projectId);
    const location = this.database.sqlite
      .prepare('SELECT 1 FROM locations WHERE id=? AND project_id=?')
      .get(input.locationId, input.projectId);
    if (!location) throw new AppError('NOT_FOUND', 'Location not found', 404);
    assertReferences(this.database, input.projectId, referenceAssetIds, 'LOCATION');
    payload.referenceAssetIds = referenceAssetIds;
    const revision = this.nextRevision(
      'location_visual_profiles',
      'location_id',
      input.projectId,
      input.locationId,
    );
    this.insertProfile({
      id: randomUUID(),
      projectId: input.projectId,
      kind: 'LOCATION',
      key: input.locationId,
      name: input.locationName,
      revision,
      status: input.status ?? 'DRAFT',
      payload,
      promptFragment: input.promptFragment ?? '',
      referenceAssetIds,
      inputFingerprint: input.inputFingerprint,
      generationId: input.generationId,
      isCurrent:
        input.status === 'APPROVED' || !this.getLocation(input.projectId, input.locationId),
    });
    return this.getLocation(input.projectId, input.locationId, revision)!;
  }

  approveLocation(
    projectId: Id,
    locationId: Id,
    revision: number,
    expectedRowVersion?: number,
  ): LocationVisualProfileDto {
    return this.approve(
      'location_visual_profiles',
      'location_id',
      projectId,
      locationId,
      revision,
      expectedRowVersion,
      (row) => parseLocation(row),
    );
  }

  getObject(projectId: Id, objectKey: string, revision?: number): VisualObjectProfileDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,object_key as objectKey,name,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,row_version as rowVersion,
          created_at as createdAt,updated_at as updatedAt
         FROM visual_object_profiles
         WHERE project_id=? AND object_key=? AND (? IS NULL AND is_current=1 OR revision=?)
         ORDER BY revision DESC LIMIT 1`,
      )
      .get(projectId, objectKey, revision ?? null, revision ?? null) as ProfileRow | undefined;
    return row ? parseObject(row) : null;
  }

  getObjectById(projectId: Id, profileId: Id): VisualObjectProfileDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,object_key as objectKey,name,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,
          row_version as rowVersion,created_at as createdAt,updated_at as updatedAt
         FROM visual_object_profiles WHERE project_id=? AND id=?`,
      )
      .get(projectId, profileId) as ProfileRow | undefined;
    return row ? parseObject(row) : null;
  }
  listObjects(projectId: Id, limit = 50, offset = 0): VisualProfilePage<VisualObjectProfileDto> {
    const boundedLimit = clampLimit(limit);
    const boundedOffset = clampOffset(offset);
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,object_key as objectKey,name,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,
          row_version as rowVersion,created_at as createdAt,updated_at as updatedAt
         FROM visual_object_profiles
         WHERE project_id=? AND is_current=1 ORDER BY object_key LIMIT ? OFFSET ?`,
      )
      .all(projectId, boundedLimit, boundedOffset) as ProfileRow[];
    return { items: rows.map(parseObject), limit: boundedLimit, offset: boundedOffset };
  }
  listObjectsByName(projectId: Id, name: string, limit = 5): VisualObjectProfileDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,object_key as objectKey,name,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,
          row_version as rowVersion,created_at as createdAt,updated_at as updatedAt
         FROM visual_object_profiles
         WHERE project_id=? AND is_current=1 AND lower(name)=lower(?)
         ORDER BY object_key LIMIT ?`,
      )
      .all(projectId, name, Math.max(1, Math.min(10, limit))) as ProfileRow[];
    return rows.map(parseObject);
  }

  listObjectRevisions(
    projectId: Id,
    objectKey: string,
    limit = 50,
    offset = 0,
  ): VisualObjectProfileDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,object_key as objectKey,name,revision,status,payload,
          prompt_fragment as promptFragment,input_fingerprint as inputFingerprint,
          reference_asset_ids as referenceAssetIds,generation_id as generationId,row_version as rowVersion,
          created_at as createdAt,updated_at as updatedAt
         FROM visual_object_profiles WHERE project_id=? AND object_key=?
         ORDER BY revision DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, objectKey, clampLimit(limit), clampOffset(offset)) as ProfileRow[];
    return rows.map(parseObject);
  }
  saveObject(input: VisualObjectProfileRevisionInput): VisualObjectProfileDto {
    const payload = visualObjectProfilePayloadSchema.parse({
      ...input.payload,
      name: input.payload.name ?? input.name,
    });
    const referenceAssetIds = input.referenceAssetIds ?? payload.referenceAssetIds;
    assertProject(this.database, input.projectId);
    assertReferences(this.database, input.projectId, referenceAssetIds, 'OBJECT');
    payload.referenceAssetIds = referenceAssetIds;
    const revision = this.nextRevision(
      'visual_object_profiles',
      'object_key',
      input.projectId,
      input.objectKey,
    );
    this.insertProfile({
      id: randomUUID(),
      projectId: input.projectId,
      kind: 'OBJECT',
      key: input.objectKey,
      name: input.name,
      revision,
      status: input.status ?? 'DRAFT',
      payload,
      promptFragment: input.promptFragment ?? '',
      referenceAssetIds,
      inputFingerprint: input.inputFingerprint,
      generationId: input.generationId,
      isCurrent: input.status === 'APPROVED' || !this.getObject(input.projectId, input.objectKey),
    });
    return this.getObject(input.projectId, input.objectKey, revision)!;
  }

  approveObject(
    projectId: Id,
    objectKey: string,
    revision: number,
    expectedRowVersion?: number,
  ): VisualObjectProfileDto {
    return this.approve(
      'visual_object_profiles',
      'object_key',
      projectId,
      objectKey,
      revision,
      expectedRowVersion,
      (row) => parseObject(row),
    );
  }

  private nextRevision(table: string, keyColumn: string, projectId: Id, key: string): number {
    const row = this.database.sqlite
      .prepare(
        `SELECT COALESCE(MAX(revision),0)+1 as revision FROM ${table} WHERE project_id=? AND ${keyColumn}=?`,
      )
      .get(projectId, key) as { revision: number };
    return row.revision;
  }

  private insertProfile(input: ProfileInsert): unknown {
    const stamp = now();
    if (input.kind === 'LOCATION') {
      return this.database.sqlite.transaction(() => {
        if (input.isCurrent)
          this.database.sqlite
            .prepare(
              `UPDATE location_visual_profiles
               SET is_current=0,status=CASE WHEN status='APPROVED' THEN 'STALE' ELSE status END,updated_at=?
               WHERE project_id=? AND location_id=?`,
            )
            .run(stamp, input.projectId, input.key);
        this.database.sqlite
          .prepare(
            `INSERT INTO location_visual_profiles(
              id,project_id,location_id,location_name,revision,status,payload,prompt_fragment,
              reference_asset_ids,input_fingerprint,generation_id,row_version,is_current,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            input.id,
            input.projectId,
            input.key,
            input.name,
            input.revision,
            input.status,
            json(input.payload),
            input.promptFragment,
            json(input.referenceAssetIds),
            input.inputFingerprint,
            input.generationId ?? null,
            1,
            input.isCurrent ? 1 : 0,
            stamp,
            stamp,
          );
      })();
    }
    const table = input.kind === 'OBJECT' ? 'visual_object_profiles' : 'character_visual_profiles';
    const keyColumn = input.kind === 'OBJECT' ? 'object_key' : 'character_id';
    return this.database.sqlite.transaction(() => {
      const columns =
        input.kind === 'OBJECT'
          ? 'id,project_id,object_key,name,revision,status,payload,prompt_fragment,reference_asset_ids,input_fingerprint,generation_id,row_version,is_current,created_at,updated_at'
          : 'id,project_id,character_id,revision,status,payload,prompt_fragment,reference_asset_ids,input_fingerprint,generation_id,row_version,is_current,created_at,updated_at';
      const values =
        input.kind === 'OBJECT' ? '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?' : '?,?,?,?,?,?,?,?,?,?,?,?,?,?';
      const params =
        input.kind === 'OBJECT'
          ? [
              input.id,
              input.projectId,
              input.key,
              input.name,
              input.revision,
              input.status,
              json(input.payload),
              input.promptFragment,
              json(input.referenceAssetIds),
              input.inputFingerprint,
              input.generationId ?? null,
              1,
              input.isCurrent ? 1 : 0,
              stamp,
              stamp,
            ]
          : [
              input.id,
              input.projectId,
              input.key,
              input.revision,
              input.status,
              json(input.payload),
              input.promptFragment,
              json(input.referenceAssetIds),
              input.inputFingerprint,
              input.generationId ?? null,
              1,
              input.isCurrent ? 1 : 0,
              stamp,
              stamp,
            ];
      if (input.isCurrent)
        this.database.sqlite
          .prepare(
            `UPDATE ${table}
             SET is_current=0,status=CASE WHEN status='APPROVED' THEN 'STALE' ELSE status END,updated_at=?
             WHERE project_id=? AND ${keyColumn}=?`,
          )
          .run(stamp, input.projectId, input.key);
      this.database.sqlite
        .prepare(`INSERT INTO ${table}(${columns}) VALUES(${values})`)
        .run(...params);
      return input.id;
    })();
  }

  private approve<T>(
    table: 'character_visual_profiles' | 'location_visual_profiles' | 'visual_object_profiles',
    keyColumn: 'character_id' | 'location_id' | 'object_key',
    projectId: Id,
    key: string,
    revision: number,
    expectedRowVersion: number | undefined,
    parse: (row: ProfileRow) => T,
  ): T {
    const stamp = now();
    const result = this.database.sqlite.transaction(() => {
      const row = this.database.sqlite
        .prepare(`SELECT * FROM ${table} WHERE project_id=? AND ${keyColumn}=? AND revision=?`)
        .get(projectId, key, revision) as ProfileRow | undefined;
      if (!row) throw new AppError('NOT_FOUND', 'Visual profile revision not found', 404);
      if (
        expectedRowVersion !== undefined &&
        numberValue(row, 'rowVersion', 'row_version') !== expectedRowVersion
      )
        throw profileConflict();
      const rowVersion = numberValue(row, 'rowVersion', 'row_version');
      const id = textValue(row, 'id', 'id');
      this.database.sqlite
        .prepare(
          `UPDATE ${table} SET is_current=0,status=CASE WHEN status='APPROVED' THEN 'STALE' ELSE status END,updated_at=? WHERE project_id=? AND ${keyColumn}=?`,
        )
        .run(stamp, projectId, key);
      const updated = this.database.sqlite
        .prepare(
          `UPDATE ${table} SET status='APPROVED',is_current=1,row_version=row_version+1,updated_at=? WHERE id=? AND row_version=?`,
        )
        .run(stamp, id, rowVersion);
      if (updated.changes !== 1) throw profileConflict();
      return this.database.sqlite
        .prepare(`SELECT * FROM ${table} WHERE id=?`)
        .get(id) as ProfileRow;
    })();
    return parse(result);
  }
}

type ProfileRow = Record<string, unknown>;

function textValue(row: ProfileRow, camel: string, snake: string): string {
  return String(row[camel] ?? row[snake] ?? '');
}

function optionalTextValue(row: ProfileRow, camel: string, snake: string): string | null {
  const value = row[camel] ?? row[snake];
  return value === null || value === undefined ? null : String(value);
}

function numberValue(row: ProfileRow, camel: string, snake: string): number {
  return Number(row[camel] ?? row[snake] ?? 0);
}

function profileBase(row: ProfileRow) {
  return {
    id: textValue(row, 'id', 'id'),
    projectId: textValue(row, 'projectId', 'project_id'),
    revision: numberValue(row, 'revision', 'revision'),
    status: visualProfileStatusSchema.parse(textValue(row, 'status', 'status')),
    promptFragment: textValue(row, 'promptFragment', 'prompt_fragment'),
    inputFingerprint: textValue(row, 'inputFingerprint', 'input_fingerprint'),
    generationId: optionalTextValue(row, 'generationId', 'generation_id'),
    rowVersion: numberValue(row, 'rowVersion', 'row_version'),
    createdAt: textValue(row, 'createdAt', 'created_at'),
    updatedAt: textValue(row, 'updatedAt', 'updated_at'),
  };
}

function payloadValue(row: ProfileRow): string {
  return textValue(row, 'payload', 'payload');
}

function parseCharacter(row: ProfileRow): CharacterVisualProfileDto {
  return characterVisualProfileDtoSchema.parse({
    ...profileBase(row),
    characterId: textValue(row, 'characterId', 'character_id'),
    payload: parseProfilePayload(payloadValue(row), characterVisualProfilePayloadSchema),
  });
}

function parseLocation(row: ProfileRow): LocationVisualProfileDto {
  return locationVisualProfileDtoSchema.parse({
    ...profileBase(row),
    locationId: textValue(row, 'locationId', 'location_id'),
    locationName: textValue(row, 'locationName', 'location_name'),
    payload: parseProfilePayload(payloadValue(row), locationVisualProfilePayloadSchema),
  });
}

function parseObject(row: ProfileRow): VisualObjectProfileDto {
  return visualObjectProfileDtoSchema.parse({
    ...profileBase(row),
    objectKey: textValue(row, 'objectKey', 'object_key'),
    name: textValue(row, 'name', 'name'),
    payload: parseProfilePayload(payloadValue(row), visualObjectProfilePayloadSchema),
  });
}

export type SceneObjectResolutionInput = {
  projectId: Id;
  sceneRevisionId: Id;
  sourceLabel: string;
  normalizedKey: string;
  visualObjectProfileId: Id | null;
  resolutionStatus: VisualObjectResolutionStatus;
};

export class SceneObjectResolutionRepository {
  constructor(private readonly database: DatabaseHandle) {}

  list(projectId: Id, sceneRevisionId: Id): SceneObjectResolution[] {
    return this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,scene_revision_id as sceneRevisionId,source_label as sourceLabel,
          normalized_key as normalizedKey,visual_object_profile_id as visualObjectProfileId,
          resolution_status as resolutionStatus,created_at as createdAt,updated_at as updatedAt
         FROM scene_object_resolutions WHERE project_id=? AND scene_revision_id=? ORDER BY source_label`,
      )
      .all(projectId, sceneRevisionId)
      .map((row) => sceneObjectResolutionSchema.parse(row));
  }

  save(input: SceneObjectResolutionInput): SceneObjectResolution {
    const scene = this.database.sqlite
      .prepare('SELECT 1 FROM scene_revisions WHERE id=? AND project_id=?')
      .get(input.sceneRevisionId, input.projectId);
    if (!scene) throw new AppError('NOT_FOUND', 'Scene revision not found', 404);
    if (input.visualObjectProfileId) {
      const profile = this.database.sqlite
        .prepare('SELECT 1 FROM visual_object_profiles WHERE id=? AND project_id=?')
        .get(input.visualObjectProfileId, input.projectId);
      if (!profile) throw new AppError('NOT_FOUND', 'Visual object profile not found', 404);
    }
    const stamp = now();
    const id = randomUUID();
    this.database.sqlite
      .prepare(
        `INSERT INTO scene_object_resolutions(
          id,project_id,scene_revision_id,source_label,normalized_key,visual_object_profile_id,
          resolution_status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(scene_revision_id,normalized_key) DO UPDATE SET
          source_label=excluded.source_label,visual_object_profile_id=excluded.visual_object_profile_id,
          resolution_status=excluded.resolution_status,updated_at=excluded.updated_at`,
      )
      .run(
        id,
        input.projectId,
        input.sceneRevisionId,
        input.sourceLabel,
        input.normalizedKey,
        input.visualObjectProfileId,
        visualObjectResolutionStatusSchema.parse(input.resolutionStatus),
        stamp,
        stamp,
      );
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,scene_revision_id as sceneRevisionId,source_label as sourceLabel,
          normalized_key as normalizedKey,visual_object_profile_id as visualObjectProfileId,
          resolution_status as resolutionStatus,created_at as createdAt,updated_at as updatedAt
         FROM scene_object_resolutions WHERE project_id=? AND scene_revision_id=? AND normalized_key=?`,
      )
      .get(input.projectId, input.sceneRevisionId, input.normalizedKey);
    return sceneObjectResolutionSchema.parse(row);
  }
}

export type VisualPromptPackageSaveInput = {
  projectId: Id;
  sceneRevisionId: Id;
  payload: VisualPromptPackagePayload;
  shotPlanId?: Id | null;
  shotStableId?: string | null;
  generationId?: Id | null;
  forceRevision?: boolean;
};
export type VisualPromptPackageRefinementSaveInput = {
  projectId: Id;
  sceneRevisionId: Id;
  packageFingerprint: string;
  refinementInputFingerprint: string;
  fullPrompt: string;
  negativePrompt: string | null;
  generationId?: Id | null;
};

export class VisualPromptPackageRepository {
  constructor(private readonly database: DatabaseHandle) {}

  getCurrent(
    projectId: Id,
    sceneRevisionId: Id,
    shotStableId: string | null = null,
  ): VisualPromptPackageDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,scene_revision_id as sceneRevisionId,revision,status,payload,
          generation_id as generationId,created_at as createdAt,updated_at as updatedAt
         FROM visual_prompt_packages
         WHERE project_id=? AND scene_revision_id=? AND is_current=1
           AND ((? IS NULL AND shot_stable_id IS NULL) OR shot_stable_id=?)`,
      )
      .get(projectId, sceneRevisionId, shotStableId, shotStableId) as PackageRow | undefined;
    return row ? parsePackage(row) : null;
  }

  get(projectId: Id, packageId: Id): VisualPromptPackageDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,scene_revision_id as sceneRevisionId,revision,status,payload,
          generation_id as generationId,created_at as createdAt,updated_at as updatedAt
         FROM visual_prompt_packages WHERE project_id=? AND id=?`,
      )
      .get(projectId, packageId) as PackageRow | undefined;
    return row ? parsePackage(row) : null;
  }

  listForChapter(
    projectId: Id,
    chapterId: Id,
    limit = 100,
    offset = 0,
  ): VisualPromptPackageListItem[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT p.id,p.project_id as projectId,p.scene_revision_id as sceneRevisionId,p.revision,p.status,
          p.generation_id as generationId,p.created_at as createdAt,p.updated_at as updatedAt,
          s.scene_number as sceneNumber,s.title as sceneTitle,
          json_extract(p.payload,'$.consistencyStatus') as consistencyStatus,
          p.input_fingerprint as inputFingerprint
         FROM visual_prompt_packages p
         JOIN scene_revisions s ON s.id=p.scene_revision_id
         WHERE p.project_id=? AND s.chapter_id=? AND p.is_current=1
         ORDER BY s.scene_number LIMIT ? OFFSET ?`,
      )
      .all(
        projectId,
        chapterId,
        clampLimit(limit),
        clampOffset(offset),
      ) as VisualPromptPackageListItem[];
    return rows;
  }

  saveCurrent(input: VisualPromptPackageSaveInput): VisualPromptPackageDto {
    const payload = visualPromptPackagePayloadSchema.parse(input.payload);
    const shotStableId = input.shotStableId ?? payload.shotId;
    const current = this.getCurrent(input.projectId, input.sceneRevisionId, shotStableId);
    if (!input.forceRevision && current?.payload.inputFingerprint === payload.inputFingerprint)
      return current;
    const scene = this.database.sqlite
      .prepare('SELECT 1 FROM scene_revisions WHERE id=? AND project_id=?')
      .get(input.sceneRevisionId, input.projectId);
    if (!scene) throw new AppError('NOT_FOUND', 'Scene revision not found', 404);
    const latest = this.database.sqlite
      .prepare(
        `SELECT COALESCE(MAX(revision),0) as revision FROM visual_prompt_packages
         WHERE project_id=? AND scene_revision_id=?
           AND ((? IS NULL AND shot_stable_id IS NULL) OR shot_stable_id=?)`,
      )
      .get(input.projectId, input.sceneRevisionId, shotStableId, shotStableId) as {
      revision: number;
    };
    const revision = latest.revision + 1;
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `UPDATE visual_prompt_packages SET is_current=0,status='STALE',updated_at=?
           WHERE project_id=? AND scene_revision_id=? AND is_current=1
             AND ((? IS NULL AND shot_stable_id IS NULL) OR shot_stable_id=?)`,
        )
        .run(stamp, input.projectId, input.sceneRevisionId, shotStableId, shotStableId);
      this.database.sqlite
        .prepare(
          `INSERT INTO visual_prompt_packages(
            id,project_id,scene_revision_id,shot_plan_id,shot_stable_id,revision,status,payload,consistency_status,consistency_issues,
            input_fingerprint,prompt_template_version,generation_id,row_version,is_current,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.projectId,
          input.sceneRevisionId,
          input.shotPlanId ?? null,
          shotStableId,
          revision,
          'CURRENT',
          json(payload),
          payload.consistencyStatus,
          json(payload.consistencyIssues),
          payload.inputFingerprint,
          payload.promptTemplateVersion,
          input.generationId ?? null,
          1,
          1,
          stamp,
          stamp,
        );
      this.database.sqlite
        .prepare('DELETE FROM visual_prompt_package_dependencies WHERE package_id=?')
        .run(id);
      const dependency = this.database.sqlite.prepare(
        `INSERT INTO visual_prompt_package_dependencies(
          package_id,dependency_kind,dependency_key,dependency_revision_id,dependency_revision,dependency_fingerprint
        ) VALUES(?,?,?,?,?,?)`,
      );
      for (const item of payload.dependencies) {
        const dependencyValue = visualPromptDependencySchema.parse(item);
        dependency.run(
          id,
          dependencyValue.kind,
          dependencyValue.key,
          dependencyValue.revisionId,
          dependencyValue.revision,
          dependencyValue.fingerprint,
        );
      }
    })();
    return this.getCurrent(input.projectId, input.sceneRevisionId, shotStableId)!;
  }
  saveRefinement(input: VisualPromptPackageRefinementSaveInput): VisualPromptPackageDto {
    const current = this.getCurrent(input.projectId, input.sceneRevisionId);
    if (!current) throw new AppError('NOT_FOUND', 'Visual prompt package not found', 404);
    if (current.payload.inputFingerprint !== input.packageFingerprint)
      throw new AppError('STALE_INPUT', 'Visual prompt package fingerprint is stale', 409);
    return this.saveCurrent({
      projectId: input.projectId,
      sceneRevisionId: input.sceneRevisionId,
      generationId: input.generationId,
      forceRevision: true,
      payload: visualPromptPackagePayloadSchema.parse({
        ...current.payload,
        refinedPrompt: input.fullPrompt,
        refinementInputFingerprint: input.refinementInputFingerprint,
        negativePrompt: input.negativePrompt,
      }),
    });
  }

  invalidateSceneRevision(projectId: Id, sceneRevisionId: Id): void {
    this.database.sqlite
      .prepare(
        `UPDATE visual_prompt_packages
         SET status='STALE',is_current=0,updated_at=?
         WHERE project_id=? AND scene_revision_id=? AND is_current=1`,
      )
      .run(now(), projectId, sceneRevisionId);
  }
  invalidateDependency(
    projectId: Id,
    kind: VisualPromptDependency['kind'],
    key: string,
    revisionId?: Id,
  ): Id[] {
    const stamp = now();
    return this.database.sqlite.transaction(() => {
      const condition = revisionId ? 'AND d.dependency_revision_id<>?' : '';
      const rows = this.database.sqlite
        .prepare(
          `SELECT DISTINCT p.scene_revision_id as sceneRevisionId
           FROM visual_prompt_packages p
           JOIN visual_prompt_package_dependencies d ON d.package_id=p.id
           WHERE p.project_id=? AND p.is_current=1
             AND d.dependency_kind=? AND d.dependency_key=? ${condition}`,
        )
        .all(
          ...(revisionId ? [projectId, kind, key, revisionId] : [projectId, kind, key]),
        ) as Array<{
        sceneRevisionId: Id;
      }>;
      const query = revisionId
        ? `UPDATE visual_prompt_packages SET status='STALE',is_current=0,updated_at=? WHERE project_id=? AND is_current=1 AND id IN (
            SELECT d.package_id FROM visual_prompt_package_dependencies d
            WHERE d.dependency_kind=? AND d.dependency_key=? AND d.dependency_revision_id<>?
          )`
        : `UPDATE visual_prompt_packages SET status='STALE',is_current=0,updated_at=? WHERE project_id=? AND is_current=1 AND id IN (
            SELECT d.package_id FROM visual_prompt_package_dependencies d
            WHERE d.dependency_kind=? AND d.dependency_key=?
          )`;
      this.database.sqlite
        .prepare(query)
        .run(
          ...(revisionId
            ? [stamp, projectId, kind, key, revisionId]
            : [stamp, projectId, kind, key]),
        );
      return rows.map((row) => row.sceneRevisionId);
    })();
  }
}

type PackageRow = {
  id: Id;
  projectId: Id;
  sceneRevisionId: Id;
  revision: number;
  status: 'CURRENT' | 'STALE' | 'FAILED';
  payload: string;
  generationId: Id | null;
  createdAt: string;
  updatedAt: string;
};

function parsePackage(row: PackageRow): VisualPromptPackageDto {
  return visualPromptPackageDtoSchema.parse({
    ...row,
    payload: visualPromptPackagePayloadSchema.parse(parseJson(row.payload)),
  });
}
