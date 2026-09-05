import { randomUUID } from 'node:crypto';
import { AppError, shotPlanCandidateSchema, shotPlanDtoSchema } from '@studio/shared';
import { invalidateAssetDependents } from './repositories.js';
import type {
  Id,
  ShotPlanCandidate,
  ShotPlanDto,
  ShotPlanReviewRequest,
  ShotValidationIssue,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';

const now = (): string => new Date().toISOString();

export type SaveShotPlanInput = {
  stableId: string;
  projectId: Id;
  chapterId: Id;
  sceneId: string;
  sceneRevisionId: Id;
  templateVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  generationId?: Id | null;
  candidate: ShotPlanCandidate;
  issues?: ShotValidationIssue[];
  metadata?: Record<string, unknown>;
  expectedRevision?: number;
};

type PlanRow = {
  id: string;
  stableId: string;
  projectId: string;
  chapterId: string;
  sceneId: string;
  sceneRevisionId: string;
  revision: number;
  status: 'CURRENT' | 'STALE' | 'FAILED';
  templateVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  generationId: string | null;
  issues: string;
  isCurrent: number;
  reviewStatus: ShotPlanDto['reviewStatus'];
  reviewNotes: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

type BeatRow = {
  stableId: string;
  ordinal: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
  kind: ShotPlanCandidate['beats'][number]['kind'];
  meaning: string;
  importance: ShotPlanCandidate['beats'][number]['importance'];
  turningPoint: number;
  timingGroupKey: string;
};

type ShotRow = {
  stableId: string;
  narrativeBeatStableId: string;
  ordinal: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
  primaryBeat: ShotPlanCandidate['shots'][number]['primaryBeat'];
  eventKinds: string;
  eventCount: number;
  importance: ShotPlanCandidate['shots'][number]['importance'];
  isHero: number;
  identitySensitive: number;
  dialogueMode: ShotPlanCandidate['shots'][number]['dialogueMode'];
  dialogueText: string;
  speakerCharacterId: string | null;
  visualCarrier: string;
  offscreenRationale: string;
  visibleCharacterIds: string;
  offscreenCharacterIds: string;
  staticIntent: string;
  dynamicIntent: string;
  initialState: string;
  finalState: string;
  continuation: string;
  plannedDurationMs: number;
  variationIntent: ShotPlanCandidate['shots'][number]['variationIntent'];
};

export class ShotPlanRepository {
  constructor(private readonly database: DatabaseHandle) {}

  saveCurrent(input: SaveShotPlanInput): ShotPlanDto {
    const candidate = shotPlanCandidateSchema.parse(input.candidate);
    const scene = this.database.sqlite
      .prepare(
        'SELECT id,stable_id as sceneId,project_id as projectId,chapter_id as chapterId,is_current as isCurrent FROM scene_revisions WHERE id=?',
      )
      .get(input.sceneRevisionId) as
      | { id: string; sceneId: string; projectId: string; chapterId: string; isCurrent: number }
      | undefined;
    if (
      !scene ||
      scene.projectId !== input.projectId ||
      scene.chapterId !== input.chapterId ||
      scene.sceneId !== input.sceneId ||
      scene.isCurrent !== 1
    ) {
      throw new AppError(
        'STALE_INPUT',
        'Current Scene revision does not match Shot plan input',
        409,
      );
    }

    return this.database.sqlite.transaction(() => {
      const current = this.database.sqlite
        .prepare('SELECT id,revision FROM shot_plans WHERE scene_revision_id=? AND is_current=1')
        .get(input.sceneRevisionId) as { id: Id; revision: number } | undefined;
      const revision = (current?.revision ?? 0) + 1;
      if (input.expectedRevision !== undefined && input.expectedRevision !== current?.revision) {
        throw new AppError('CONFLICT', 'Shot plan revision conflict', 409);
      }
      const timestamp = now();
      const id = randomUUID();
      const priorAssets = this.database.sqlite
        .prepare(
          `SELECT DISTINCT a.id
           FROM assets a
           LEFT JOIN scene_image_generations ig ON ig.asset_id=a.id
           LEFT JOIN scene_video_generations vg ON vg.asset_id=a.id
           WHERE a.project_id=? AND a.is_current=1 AND (
             (ig.scene_revision_id=? AND ig.shot_stable_id IS NOT NULL) OR
             (vg.scene_revision_id=? AND vg.shot_stable_id IS NOT NULL) OR
             (a.type='SHOT_CONTINUATION_FRAME' AND a.source_entity_id IN (
               SELECT id FROM scene_video_generations
               WHERE project_id=? AND scene_revision_id=? AND shot_stable_id IS NOT NULL
             ))
           )`,
        )
        .all(
          input.projectId,
          input.sceneRevisionId,
          input.sceneRevisionId,
          input.projectId,
          input.sceneRevisionId,
        ) as Array<{
        id: Id;
      }>;
      for (const asset of priorAssets)
        invalidateAssetDependents(this.database, input.projectId, asset.id, timestamp);
      this.database.sqlite
        .prepare(
          "UPDATE visual_prompt_packages SET status='STALE',is_current=0,updated_at=? WHERE project_id=? AND scene_revision_id=? AND shot_stable_id IS NOT NULL AND is_current=1",
        )
        .run(timestamp, input.projectId, input.sceneRevisionId);
      this.database.sqlite
        .prepare(
          'UPDATE scene_image_generations SET is_current=0,updated_at=? WHERE project_id=? AND scene_revision_id=? AND shot_stable_id IS NOT NULL AND is_current=1',
        )
        .run(timestamp, input.projectId, input.sceneRevisionId);
      this.database.sqlite
        .prepare(
          'UPDATE scene_video_generations SET is_current=0,updated_at=? WHERE project_id=? AND scene_revision_id=? AND shot_stable_id IS NOT NULL AND is_current=1',
        )
        .run(timestamp, input.projectId, input.sceneRevisionId);
      this.database.sqlite
        .prepare(
          "UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND id IN (SELECT id FROM assets WHERE project_id=? AND is_current=1 AND (type='SHOT_IMAGE' OR type='AI_SHOT_VIDEO' OR type='SHOT_CONTINUATION_FRAME') AND (source_entity_id IN (SELECT id FROM scene_image_generations WHERE project_id=? AND scene_revision_id=? AND shot_stable_id IS NOT NULL) OR source_entity_id IN (SELECT id FROM scene_video_generations WHERE project_id=? AND scene_revision_id=? AND shot_stable_id IS NOT NULL)))",
        )
        .run(
          timestamp,
          input.projectId,
          input.projectId,
          input.projectId,
          input.sceneRevisionId,
          input.projectId,
          input.sceneRevisionId,
        );
      const invalidatedTypes = [
        'BUILD_VISUAL_PROMPT',
        'GENERATE_SHOT_IMAGE',
        'EXTRACT_SHOT_CONTINUATION_FRAME',
        'GENERATE_AI_SHOT_VIDEO',
      ];
      const placeholders = invalidatedTypes.map(() => '?').join(',');
      this.database.sqlite
        .prepare(
          `UPDATE workflow_steps SET status='INVALIDATED',error=?,cancellation_requested_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
           WHERE entity_id=? AND type IN (${placeholders}) AND status IN ('PENDING','RUNNING')`,
        )
        .run('Shot plan changed', timestamp, timestamp, input.sceneRevisionId, ...invalidatedTypes);
      this.database.sqlite
        .prepare(
          `UPDATE jobs SET status='INVALIDATED',error=?,completed_at=NULL WHERE step_id IN (
             SELECT id FROM workflow_steps WHERE entity_id=? AND type IN (${placeholders})
           ) AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')`,
        )
        .run('Shot plan changed', input.sceneRevisionId, ...invalidatedTypes);
      this.database.sqlite
        .prepare(
          "UPDATE shot_plans SET is_current=0,status='STALE',updated_at=? WHERE scene_revision_id=? AND is_current=1",
        )
        .run(timestamp, input.sceneRevisionId);
      this.database.sqlite
        .prepare(
          `INSERT INTO shot_plans(id,stable_id,project_id,chapter_id,scene_stable_id,scene_revision_id,revision,status,template_version,schema_version,input_fingerprint,generation_id,issues,metadata,is_current,row_version,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,'CURRENT',?,?,?,?,?,?,1,1,?,?)`,
        )
        .run(
          id,
          input.stableId,
          input.projectId,
          input.chapterId,
          input.sceneId,
          input.sceneRevisionId,
          revision,
          input.templateVersion,
          input.schemaVersion,
          input.inputFingerprint,
          input.generationId ?? null,
          JSON.stringify(input.issues ?? []),
          JSON.stringify(input.metadata ?? {}),
          timestamp,
          timestamp,
        );

      const beatDatabaseIds = new Map<string, string>();
      const insertBeat = this.database.sqlite.prepare(
        `INSERT INTO narrative_beats(id,stable_id,shot_plan_id,ordinal,source_start_offset,source_end_offset,kind,meaning,importance,turning_point,timing_group_key,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const beat of candidate.beats) {
        const beatId = randomUUID();
        beatDatabaseIds.set(beat.id, beatId);
        insertBeat.run(
          beatId,
          beat.id,
          id,
          beat.ordinal,
          beat.sourceRange.startOffset,
          beat.sourceRange.endOffset,
          beat.kind,
          beat.meaning,
          beat.importance,
          beat.turningPoint ? 1 : 0,
          beat.timingGroupKey,
          timestamp,
        );
      }

      const insertShot = this.database.sqlite.prepare(
        `INSERT INTO shots(id,stable_id,shot_plan_id,narrative_beat_id,revision,ordinal,source_start_offset,source_end_offset,primary_beat,event_kinds,event_count,importance,is_hero,identity_sensitive,dialogue_mode,dialogue_text,speaker_character_id,visual_carrier,offscreen_rationale,visible_character_ids,offscreen_character_ids,static_intent,dynamic_intent,initial_state,final_state,continuation,planned_duration_ms,variation_intent,validation_issues,input_fingerprint,created_at,updated_at)
         VALUES(@id,@stableId,@shotPlanId,@narrativeBeatId,1,@ordinal,@sourceStartOffset,@sourceEndOffset,@primaryBeat,@eventKinds,@eventCount,@importance,@isHero,@identitySensitive,@dialogueMode,@dialogueText,@speakerCharacterId,@visualCarrier,@offscreenRationale,@visibleCharacterIds,@offscreenCharacterIds,@staticIntent,@dynamicIntent,@initialState,@finalState,@continuation,@plannedDurationMs,@variationIntent,'[]',@inputFingerprint,@createdAt,@updatedAt)`,
      );
      for (const shot of candidate.shots) {
        insertShot.run({
          id: randomUUID(),
          stableId: shot.id,
          shotPlanId: id,
          narrativeBeatId: beatDatabaseIds.get(shot.beatId),
          ordinal: shot.ordinal,
          sourceStartOffset: shot.sourceRange.startOffset,
          sourceEndOffset: shot.sourceRange.endOffset,
          primaryBeat: shot.primaryBeat,
          eventKinds: JSON.stringify(shot.eventKinds),
          eventCount: shot.eventCount,
          importance: shot.importance,
          isHero: shot.hero ? 1 : 0,
          identitySensitive: shot.identitySensitive ? 1 : 0,
          dialogueMode: shot.dialogueMode,
          dialogueText: shot.dialogueText,
          speakerCharacterId: shot.speakerCharacterId,
          visualCarrier: shot.visualCarrier,
          offscreenRationale: shot.offscreenRationale,
          visibleCharacterIds: JSON.stringify(shot.visibleCharacterIds),
          offscreenCharacterIds: JSON.stringify(shot.offscreenCharacterIds),
          staticIntent: JSON.stringify(shot.staticIntent),
          dynamicIntent: JSON.stringify(shot.dynamicIntent),
          initialState: JSON.stringify(shot.initialState),
          finalState: JSON.stringify(shot.finalState),
          continuation: JSON.stringify(shot.continuation),
          plannedDurationMs: shot.plannedDurationMs,
          variationIntent: shot.variationIntent,
          inputFingerprint: input.inputFingerprint,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      return this.getById(input.projectId, id)!;
    })();
  }

  getCurrent(projectId: Id, sceneRevisionId: Id): ShotPlanDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,stable_id as stableId,project_id as projectId,chapter_id as chapterId,scene_stable_id as sceneId,scene_revision_id as sceneRevisionId,revision,status,template_version as templateVersion,schema_version as schemaVersion,input_fingerprint as inputFingerprint,generation_id as generationId,issues,review_status as reviewStatus,review_notes as reviewNotes,row_version as rowVersion,is_current as isCurrent,created_at as createdAt,updated_at as updatedAt
         FROM shot_plans WHERE project_id=? AND scene_revision_id=? AND is_current=1`,
      )
      .get(projectId, sceneRevisionId) as PlanRow | undefined;
    return row ? this.parsePlan(row) : null;
  }

  getById(projectId: Id, id: Id): ShotPlanDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,stable_id as stableId,project_id as projectId,chapter_id as chapterId,scene_stable_id as sceneId,scene_revision_id as sceneRevisionId,revision,status,template_version as templateVersion,schema_version as schemaVersion,input_fingerprint as inputFingerprint,generation_id as generationId,issues,review_status as reviewStatus,review_notes as reviewNotes,row_version as rowVersion,is_current as isCurrent,created_at as createdAt,updated_at as updatedAt
         FROM shot_plans WHERE project_id=? AND id=?`,
      )
      .get(projectId, id) as PlanRow | undefined;
    return row ? this.parsePlan(row) : null;
  }
  listCurrentForChapter(projectId: Id, chapterId: Id, limit = 100, offset = 0): ShotPlanDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,stable_id as stableId,project_id as projectId,chapter_id as chapterId,scene_stable_id as sceneId,scene_revision_id as sceneRevisionId,revision,status,template_version as templateVersion,schema_version as schemaVersion,input_fingerprint as inputFingerprint,generation_id as generationId,issues,review_status as reviewStatus,review_notes as reviewNotes,row_version as rowVersion,is_current as isCurrent,created_at as createdAt,updated_at as updatedAt
         FROM shot_plans WHERE project_id=? AND chapter_id=? AND is_current=1 ORDER BY scene_stable_id LIMIT ? OFFSET ?`,
      )
      .all(
        projectId,
        chapterId,
        Math.min(200, Math.max(1, limit)),
        Math.max(0, offset),
      ) as PlanRow[];
    return rows.map((row) => this.parsePlan(row));
  }

  review(projectId: Id, id: Id, request: ShotPlanReviewRequest): ShotPlanDto {
    const result = this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          `UPDATE shot_plans SET review_status=?,review_notes=?,row_version=row_version+1,updated_at=?
           WHERE project_id=? AND id=? AND is_current=1 AND row_version=?`,
        )
        .run(request.status, request.notes, now(), projectId, id, request.expectedRowVersion);
      if (result.changes !== 1)
        throw new AppError('CONFLICT', 'Shot plan changed; reload and retry', 409);
      if (request.status === 'REJECTED') {
        const plan = this.database.sqlite
          .prepare(
            'SELECT scene_revision_id as sceneRevisionId FROM shot_plans WHERE project_id=? AND id=?',
          )
          .get(projectId, id) as { sceneRevisionId: Id } | undefined;
        if (plan) this.invalidatePlanDescendants(projectId, id, plan.sceneRevisionId, now());
      }
      return result;
    })();
    if (result.changes !== 1)
      throw new AppError('CONFLICT', 'Shot plan changed; reload and retry', 409);
    return this.getById(projectId, id)!;
  }

  private parsePlan(row: PlanRow): ShotPlanDto {
    const beats = this.database.sqlite
      .prepare(
        `SELECT stable_id as stableId,ordinal,source_start_offset as sourceStartOffset,source_end_offset as sourceEndOffset,kind,meaning,importance,turning_point as turningPoint,timing_group_key as timingGroupKey
         FROM narrative_beats WHERE shot_plan_id=? ORDER BY ordinal`,
      )
      .all(row.id) as BeatRow[];
    const shots = this.database.sqlite
      .prepare(
        `SELECT s.stable_id as stableId,b.stable_id as narrativeBeatStableId,s.ordinal,s.source_start_offset as sourceStartOffset,s.source_end_offset as sourceEndOffset,s.primary_beat as primaryBeat,s.event_kinds as eventKinds,s.event_count as eventCount,s.importance,s.is_hero as isHero,s.identity_sensitive as identitySensitive,s.dialogue_mode as dialogueMode,s.dialogue_text as dialogueText,s.speaker_character_id as speakerCharacterId,s.visual_carrier as visualCarrier,s.offscreen_rationale as offscreenRationale,s.visible_character_ids as visibleCharacterIds,s.offscreen_character_ids as offscreenCharacterIds,s.static_intent as staticIntent,s.dynamic_intent as dynamicIntent,s.initial_state as initialState,s.final_state as finalState,s.continuation,s.planned_duration_ms as plannedDurationMs,s.variation_intent as variationIntent
         FROM shots s JOIN narrative_beats b ON b.id=s.narrative_beat_id WHERE s.shot_plan_id=? ORDER BY s.ordinal`,
      )
      .all(row.id) as ShotRow[];
    return shotPlanDtoSchema.parse({
      ...row,
      isCurrent: row.isCurrent === 1,
      candidate: {
        beats: beats.map((beat) => ({
          id: beat.stableId,
          ordinal: beat.ordinal,
          sourceRange: { startOffset: beat.sourceStartOffset, endOffset: beat.sourceEndOffset },
          kind: beat.kind,
          meaning: beat.meaning,
          importance: beat.importance,
          turningPoint: beat.turningPoint === 1,
          timingGroupKey: beat.timingGroupKey,
        })),
        shots: shots.map((shot) => ({
          id: shot.stableId,
          beatId: shot.narrativeBeatStableId,
          ordinal: shot.ordinal,
          sourceRange: { startOffset: shot.sourceStartOffset, endOffset: shot.sourceEndOffset },
          primaryBeat: shot.primaryBeat,
          eventKinds: JSON.parse(shot.eventKinds) as unknown,
          importance: shot.importance,
          eventCount: shot.eventCount,
          hero: shot.isHero === 1,
          identitySensitive: shot.identitySensitive === 1,
          dialogueMode: shot.dialogueMode,
          dialogueText: shot.dialogueText,
          speakerCharacterId: shot.speakerCharacterId,
          visualCarrier: shot.visualCarrier,
          offscreenRationale: shot.offscreenRationale,
          visibleCharacterIds: JSON.parse(shot.visibleCharacterIds) as unknown,
          offscreenCharacterIds: JSON.parse(shot.offscreenCharacterIds) as unknown,
          staticIntent: JSON.parse(shot.staticIntent) as unknown,
          dynamicIntent: JSON.parse(shot.dynamicIntent) as unknown,
          initialState: JSON.parse(shot.initialState) as unknown,
          finalState: JSON.parse(shot.finalState) as unknown,
          continuation: JSON.parse(shot.continuation) as unknown,
          plannedDurationMs: shot.plannedDurationMs,
          variationIntent: shot.variationIntent,
        })),
      },
      issues: JSON.parse(row.issues) as unknown,
    });
  }
  private invalidatePlanDescendants(
    projectId: Id,
    planId: Id,
    sceneRevisionId: Id,
    stamp: string,
  ): void {
    const assets = this.database.sqlite
      .prepare(
        `SELECT DISTINCT a.id
         FROM assets a
         LEFT JOIN scene_image_generations ig ON ig.asset_id=a.id
         LEFT JOIN scene_video_generations vg ON vg.asset_id=a.id
         WHERE a.project_id=? AND a.is_current=1 AND (
           ig.shot_plan_id=? OR
           vg.shot_plan_id=? OR
           (a.type='SHOT_CONTINUATION_FRAME' AND a.source_entity_id IN (
             SELECT id FROM scene_video_generations WHERE project_id=? AND shot_plan_id=?
           ))
         )`,
      )
      .all(projectId, planId, planId, projectId, planId) as Array<{ id: Id }>;
    for (const asset of assets)
      invalidateAssetDependents(this.database, projectId, asset.id, stamp);
    this.database.sqlite
      .prepare(
        "UPDATE visual_prompt_packages SET status='STALE',is_current=0,updated_at=? WHERE project_id=? AND shot_plan_id=? AND is_current=1",
      )
      .run(stamp, projectId, planId);
    this.database.sqlite
      .prepare(
        'UPDATE scene_image_generations SET is_current=0,updated_at=? WHERE project_id=? AND shot_plan_id=? AND is_current=1',
      )
      .run(stamp, projectId, planId);
    this.database.sqlite
      .prepare(
        'UPDATE scene_video_generations SET is_current=0,updated_at=? WHERE project_id=? AND shot_plan_id=? AND is_current=1',
      )
      .run(stamp, projectId, planId);
    this.database.sqlite
      .prepare(
        `UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND id IN (
           SELECT a.id FROM assets a
           LEFT JOIN scene_image_generations ig ON ig.asset_id=a.id
           LEFT JOIN scene_video_generations vg ON vg.asset_id=a.id
           WHERE a.project_id=? AND a.is_current=1 AND (
             ig.shot_plan_id=? OR vg.shot_plan_id=? OR
             (a.type='SHOT_CONTINUATION_FRAME' AND a.source_entity_id IN (
               SELECT id FROM scene_video_generations WHERE project_id=? AND shot_plan_id=?
             ))
           )
         )`,
      )
      .run(stamp, projectId, projectId, planId, planId, projectId, planId);
    const types = [
      'BUILD_VISUAL_PROMPT',
      'GENERATE_SHOT_IMAGE',
      'EXTRACT_SHOT_CONTINUATION_FRAME',
      'GENERATE_AI_SHOT_VIDEO',
    ];
    const placeholders = types.map(() => '?').join(',');
    this.database.sqlite
      .prepare(
        `UPDATE workflow_steps SET status='INVALIDATED',error=?,cancellation_requested_at=?,
           lease_owner=NULL,lease_expires_at=NULL,updated_at=?
         WHERE entity_id=? AND type IN (${placeholders}) AND status IN ('PENDING','RUNNING')`,
      )
      .run('Shot plan rejected', stamp, stamp, sceneRevisionId, ...types);
    this.database.sqlite
      .prepare(
        `UPDATE jobs SET status='INVALIDATED',error=?,completed_at=NULL WHERE step_id IN (
           SELECT id FROM workflow_steps WHERE entity_id=? AND type IN (${placeholders})
         ) AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')`,
      )
      .run('Shot plan rejected', sceneRevisionId, ...types);
  }
}
