import { randomUUID } from 'node:crypto';
import {
  AppError,
  characterAppearanceStagePayloadSchema,
  characterAppearanceStageSchema,
  appearanceStageProvenanceSchema,
  visualReferenceGenerationSchema,
  type AppearanceStageProvenance,
  type CharacterAppearanceStage,
  type CharacterAppearanceStagePayload,
  type Id,
  type VisualReferenceGeneration,
  type VisualReferenceTargetKind,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';

const now = (): string => new Date().toISOString();
const limit = (value: number): number => Math.max(1, Math.min(100, value));

type StageRow = {
  id: string;
  stableId: string;
  projectId: string;
  characterId: string;
  profileId: string;
  profileRevision: number;
  revision: number;
  name: string;
  payload: string;
  provenance: string;
  reviewStatus: 'DRAFT' | 'APPROVED' | 'REJECTED';
  referenceAssetId: string | null;
  referenceSha256: string | null;
  inputFingerprint: string;
  isCurrent: number;
  createdAt: string;
  updatedAt: string;
};

function parseStage(row: StageRow): CharacterAppearanceStage {
  return characterAppearanceStageSchema.parse({
    ...row,
    profileId: row.profileId,
    payload: JSON.parse(row.payload),
    provenance: JSON.parse(row.provenance),
    isCurrent: row.isCurrent === 1,
  });
}

export type SaveAppearanceStageInput = {
  stableId: string;
  projectId: Id;
  characterId: string;
  profileId: Id;
  profileRevision: number;
  name: string;
  payload: CharacterAppearanceStagePayload;
  provenance: AppearanceStageProvenance;
  reviewStatus?: 'DRAFT' | 'APPROVED' | 'REJECTED';
  referenceAssetId?: Id | null;
  referenceSha256?: string | null;
  inputFingerprint: string;
  expectedRevision?: number;
};

export class AppearanceStageRepository {
  constructor(private readonly database: DatabaseHandle) {}

  saveCurrent(input: SaveAppearanceStageInput): CharacterAppearanceStage {
    const payload = characterAppearanceStagePayloadSchema.parse(input.payload);
    const provenance = appearanceStageProvenanceSchema.parse(input.provenance);
    const profile = this.database.sqlite
      .prepare(
        'SELECT id,revision FROM character_visual_profiles WHERE id=? AND project_id=? AND character_id=?',
      )
      .get(input.profileId, input.projectId, input.characterId) as
      { id: string; revision: number } | undefined;
    if (!profile || profile.revision !== input.profileRevision)
      throw new AppError(
        'STALE_INPUT',
        'Character profile revision does not match appearance stage',
        409,
      );
    const current = this.getCurrent(input.projectId, input.stableId);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current?.revision)
      throw new AppError('REVISION_CONFLICT', 'Appearance stage revision is stale', 409);
    if (input.referenceAssetId) {
      const asset = this.database.sqlite
        .prepare("SELECT sha256 FROM assets WHERE id=? AND project_id=? AND status='READY'")
        .get(input.referenceAssetId, input.projectId) as { sha256: string } | undefined;
      if (!asset || asset.sha256 !== input.referenceSha256)
        throw new AppError(
          'INVALID_REFERENCE',
          'Appearance reference Asset/hash is not current',
          400,
        );
    }
    const revision = (current?.revision ?? 0) + 1;
    const id = randomUUID();
    const timestamp = now();
    this.database.sqlite.transaction(() => {
      if (current)
        this.database.sqlite
          .prepare('UPDATE character_appearance_stages SET is_current=0,updated_at=? WHERE id=?')
          .run(timestamp, current.id);
      this.database.sqlite
        .prepare(
          `INSERT INTO character_appearance_stages(id,stable_id,project_id,character_id,character_profile_id,profile_revision,revision,name,payload,provenance,review_status,reference_asset_id,reference_sha256,input_fingerprint,is_current,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .run(
          id,
          input.stableId,
          input.projectId,
          input.characterId,
          input.profileId,
          input.profileRevision,
          revision,
          input.name,
          JSON.stringify(payload),
          JSON.stringify(provenance),
          input.reviewStatus ?? 'DRAFT',
          input.referenceAssetId ?? null,
          input.referenceSha256 ?? null,
          input.inputFingerprint,
          timestamp,
          timestamp,
        );
    })();
    return this.get(input.projectId, id)!;
  }

  getCurrent(projectId: Id, stableId: string): CharacterAppearanceStage | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,stable_id as stableId,project_id as projectId,character_id as characterId,character_profile_id as profileId,profile_revision as profileRevision,revision,name,payload,provenance,review_status as reviewStatus,reference_asset_id as referenceAssetId,reference_sha256 as referenceSha256,input_fingerprint as inputFingerprint,is_current as isCurrent,created_at as createdAt,updated_at as updatedAt
         FROM character_appearance_stages WHERE project_id=? AND stable_id=? AND is_current=1`,
      )
      .get(projectId, stableId) as StageRow | undefined;
    return row ? parseStage(row) : null;
  }

  get(projectId: Id, id: Id): CharacterAppearanceStage | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,stable_id as stableId,project_id as projectId,character_id as characterId,character_profile_id as profileId,profile_revision as profileRevision,revision,name,payload,provenance,review_status as reviewStatus,reference_asset_id as referenceAssetId,reference_sha256 as referenceSha256,input_fingerprint as inputFingerprint,is_current as isCurrent,created_at as createdAt,updated_at as updatedAt
         FROM character_appearance_stages WHERE project_id=? AND id=?`,
      )
      .get(projectId, id) as StageRow | undefined;
    return row ? parseStage(row) : null;
  }

  listCharacter(projectId: Id, characterId: string, count = 50): CharacterAppearanceStage[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,stable_id as stableId,project_id as projectId,character_id as characterId,character_profile_id as profileId,profile_revision as profileRevision,revision,name,payload,provenance,review_status as reviewStatus,reference_asset_id as referenceAssetId,reference_sha256 as referenceSha256,input_fingerprint as inputFingerprint,is_current as isCurrent,created_at as createdAt,updated_at as updatedAt
         FROM character_appearance_stages WHERE project_id=? AND character_id=? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, characterId, limit(count)) as StageRow[];
    return rows.map(parseStage);
  }
}

type ReferenceRow = {
  id: string;
  projectId: string;
  targetKind: VisualReferenceTargetKind;
  targetEntityId: string;
  targetRevision: number;
  sourcePrototypeAssetId: string | null;
  sourcePrototypeSha256: string | null;
  prompt: string;
  workflowTemplate: string;
  provider: string;
  settings: string;
  seed: number;
  inputFingerprint: string;
  status: VisualReferenceGeneration['status'];
  approval: VisualReferenceGeneration['approval'];
  assetId: string | null;
  assetSha256: string | null;
  attempt: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseReference(row: ReferenceRow): VisualReferenceGeneration {
  return visualReferenceGenerationSchema.parse({ ...row, settings: JSON.parse(row.settings) });
}

export type CreateVisualReferenceInput = Omit<
  VisualReferenceGeneration,
  | 'id'
  | 'status'
  | 'approval'
  | 'assetId'
  | 'assetSha256'
  | 'attempt'
  | 'error'
  | 'createdAt'
  | 'updatedAt'
> & { workflowStepId?: Id | null };

export class VisualReferenceGenerationRepository {
  constructor(private readonly database: DatabaseHandle) {}

  create(input: CreateVisualReferenceInput): VisualReferenceGeneration {
    const id = randomUUID();
    const timestamp = now();
    const value = visualReferenceGenerationSchema.parse({
      ...input,
      id,
      status: 'PENDING',
      approval: 'CANDIDATE',
      assetId: null,
      assetSha256: null,
      attempt: 0,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.database.sqlite
      .prepare(
        `INSERT INTO visual_reference_generations(id,project_id,target_kind,target_entity_id,target_revision,source_prototype_asset_id,source_prototype_sha256,prompt,workflow_template,provider,settings,seed,input_fingerprint,status,approval,workflow_step_id,attempt,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING','CANDIDATE',?,0,?,?)`,
      )
      .run(
        value.id,
        value.projectId,
        value.targetKind,
        value.targetEntityId,
        value.targetRevision,
        value.sourcePrototypeAssetId,
        value.sourcePrototypeSha256,
        value.prompt,
        value.workflowTemplate,
        value.provider,
        JSON.stringify(value.settings),
        value.seed,
        value.inputFingerprint,
        input.workflowStepId ?? null,
        timestamp,
        timestamp,
      );
    return value;
  }

  complete(id: Id, assetId: Id, assetSha256: string): VisualReferenceGeneration {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Visual reference generation not found', 404);
    const asset = this.database.sqlite
      .prepare("SELECT sha256 FROM assets WHERE id=? AND project_id=? AND status='READY'")
      .get(assetId, current.projectId) as { sha256: string } | undefined;
    if (!asset || asset.sha256 !== assetSha256)
      throw new AppError('INVALID_REFERENCE', 'Generated reference Asset/hash mismatch', 400);
    this.database.sqlite
      .prepare(
        "UPDATE visual_reference_generations SET status='COMPLETED',asset_id=?,asset_sha256=?,error=NULL,updated_at=? WHERE id=? AND status IN ('PENDING','RUNNING')",
      )
      .run(assetId, assetSha256, now(), id);
    return this.get(id)!;
  }
  markRunning(id: Id): VisualReferenceGeneration {
    const result = this.database.sqlite
      .prepare(
        "UPDATE visual_reference_generations SET status='RUNNING',attempt=attempt+1,error=NULL,updated_at=? WHERE id=? AND status='PENDING'",
      )
      .run(now(), id);
    if (result.changes !== 1)
      throw new AppError('CONFLICT', 'Visual reference generation is not pending', 409);
    return this.get(id)!;
  }

  fail(id: Id, status: 'FAILED' | 'CANCELLED', error: string): VisualReferenceGeneration {
    const result = this.database.sqlite
      .prepare(
        "UPDATE visual_reference_generations SET status=?,error=?,updated_at=? WHERE id=? AND status IN ('PENDING','RUNNING')",
      )
      .run(status, error.slice(0, 2_000), now(), id);
    if (result.changes !== 1)
      throw new AppError('CONFLICT', 'Visual reference generation is not active', 409);
    return this.get(id)!;
  }
  markRetryPending(id: Id, error: string): VisualReferenceGeneration {
    const result = this.database.sqlite
      .prepare(
        "UPDATE visual_reference_generations SET status='PENDING',error=?,updated_at=? WHERE id=? AND status='RUNNING'",
      )
      .run(error.slice(0, 2_000), now(), id);
    if (result.changes !== 1)
      throw new AppError('CONFLICT', 'Visual reference generation is not running', 409);
    return this.get(id)!;
  }

  reject(id: Id): VisualReferenceGeneration {
    const result = this.database.sqlite
      .prepare(
        "UPDATE visual_reference_generations SET approval='REJECTED',is_current=0,updated_at=? WHERE id=? AND status='COMPLETED'",
      )
      .run(now(), id);
    if (result.changes !== 1)
      throw new AppError('CONFLICT', 'Only a completed reference candidate can be rejected', 409);
    return this.get(id)!;
  }

  list(
    projectId: Id,
    targetKind: VisualReferenceTargetKind,
    targetEntityId: string,
    count = 50,
  ): VisualReferenceGeneration[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,target_kind as targetKind,target_entity_id as targetEntityId,target_revision as targetRevision,source_prototype_asset_id as sourcePrototypeAssetId,source_prototype_sha256 as sourcePrototypeSha256,prompt,workflow_template as workflowTemplate,provider,settings,seed,input_fingerprint as inputFingerprint,status,approval,asset_id as assetId,asset_sha256 as assetSha256,attempt,error,created_at as createdAt,updated_at as updatedAt
         FROM visual_reference_generations WHERE project_id=? AND target_kind=? AND target_entity_id=? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, targetKind, targetEntityId, limit(count)) as ReferenceRow[];
    return rows.map(parseReference);
  }

  approve(id: Id): VisualReferenceGeneration {
    const current = this.get(id);
    if (!current || current.status !== 'COMPLETED' || !current.assetId)
      throw new AppError('CONFLICT', 'Only a completed reference candidate can be approved', 409);
    const prior = this.database.sqlite
      .prepare(
        `SELECT asset_id as assetId FROM visual_reference_generations
         WHERE project_id=? AND target_kind=? AND target_entity_id=? AND target_revision=? AND is_current=1`,
      )
      .get(
        current.projectId,
        current.targetKind,
        current.targetEntityId,
        current.targetRevision,
      ) as { assetId: string | null } | undefined;
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'UPDATE visual_reference_generations SET is_current=0,updated_at=? WHERE project_id=? AND target_kind=? AND target_entity_id=? AND target_revision=? AND is_current=1',
        )
        .run(
          now(),
          current.projectId,
          current.targetKind,
          current.targetEntityId,
          current.targetRevision,
        );
      this.database.sqlite
        .prepare(
          "UPDATE visual_reference_generations SET approval='APPROVED',is_current=1,updated_at=? WHERE id=? AND approval='CANDIDATE'",
        )
        .run(now(), id);
      if (prior?.assetId && prior.assetId !== current.assetId) {
        if (current.targetKind === 'CHARACTER_PROTOTYPE')
          this.database.sqlite
            .prepare(
              'UPDATE visual_reference_generations SET is_current=0,updated_at=? WHERE project_id=? AND source_prototype_asset_id=? AND is_current=1',
            )
            .run(now(), current.projectId, prior.assetId);
        this.database.sqlite
          .prepare(
            `UPDATE visual_prompt_packages SET status='STALE',is_current=0,updated_at=?
             WHERE project_id=? AND is_current=1 AND EXISTS (
               SELECT 1 FROM json_each(reference_bindings) WHERE json_extract(value,'$.assetId')=?
             )`,
          )
          .run(now(), current.projectId, prior.assetId);
        this.database.sqlite
          .prepare(
            `UPDATE scene_image_generations SET is_current=0,updated_at=?
             WHERE project_id=? AND visual_prompt_package_id IN (
               SELECT id FROM visual_prompt_packages WHERE project_id=? AND status='STALE'
             )`,
          )
          .run(now(), current.projectId, current.projectId);
        this.database.sqlite
          .prepare(
            'UPDATE scene_video_generations SET is_current=0,updated_at=? WHERE project_id=? AND source_image_asset_id=?',
          )
          .run(now(), current.projectId, prior.assetId);
      }
    })();
    return this.get(id)!;
  }

  get(id: Id): VisualReferenceGeneration | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,target_kind as targetKind,target_entity_id as targetEntityId,target_revision as targetRevision,source_prototype_asset_id as sourcePrototypeAssetId,source_prototype_sha256 as sourcePrototypeSha256,prompt,workflow_template as workflowTemplate,provider,settings,seed,input_fingerprint as inputFingerprint,status,approval,asset_id as assetId,asset_sha256 as assetSha256,attempt,error,created_at as createdAt,updated_at as updatedAt
         FROM visual_reference_generations WHERE id=?`,
      )
      .get(id) as ReferenceRow | undefined;
    return row ? parseReference(row) : null;
  }

  resolveApproved(
    projectId: Id,
    targetKind: VisualReferenceTargetKind,
    targetEntityId: string,
    targetRevision: number,
  ): VisualReferenceGeneration | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT g.id,g.project_id as projectId,g.target_kind as targetKind,g.target_entity_id as targetEntityId,g.target_revision as targetRevision,g.source_prototype_asset_id as sourcePrototypeAssetId,g.source_prototype_sha256 as sourcePrototypeSha256,g.prompt,g.workflow_template as workflowTemplate,g.provider,g.settings,g.seed,g.input_fingerprint as inputFingerprint,g.status,g.approval,g.asset_id as assetId,g.asset_sha256 as assetSha256,g.attempt,g.error,g.created_at as createdAt,g.updated_at as updatedAt
         FROM visual_reference_generations g JOIN assets a ON a.id=g.asset_id
         WHERE g.project_id=? AND g.target_kind=? AND g.target_entity_id=? AND g.target_revision=? AND g.is_current=1 AND g.status='COMPLETED' AND g.approval='APPROVED' AND a.project_id=g.project_id AND a.status='READY' AND a.sha256=g.asset_sha256`,
      )
      .get(projectId, targetKind, targetEntityId, targetRevision) as ReferenceRow | undefined;
    return row ? parseReference(row) : null;
  }
}
