import { randomUUID } from 'node:crypto';
import {
  imageCriticEvaluationSchema,
  videoCriticEvaluationSchema,
  type Id,
  type ImageCriticEvaluation,
  type VideoCriticEvaluation,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';

const now = (): string => new Date().toISOString();

type ImageInput = Omit<ImageCriticEvaluation, 'id' | 'createdAt' | 'completedAt'> & {
  workflowStepId?: Id | null;
};
type VideoInput = Omit<VideoCriticEvaluation, 'id' | 'createdAt' | 'completedAt'> & {
  workflowStepId?: Id | null;
};

export class MediaCriticEvaluationRepository {
  constructor(private readonly database: DatabaseHandle) {}

  saveImage(input: ImageInput): ImageCriticEvaluation {
    const existing = this.getImage(input.generationId, input.inputFingerprint);
    if (existing) return existing;
    const timestamp = now();
    const value = imageCriticEvaluationSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: timestamp,
      completedAt: timestamp,
    });
    this.database.sqlite
      .prepare(
        `INSERT INTO image_critic_evaluations(id,project_id,generation_id,candidate_set_id,shot_stable_id,scene_revision_id,asset_id,asset_sha256,package_fingerprint,reference_fingerprint,critic_provider,critic_model,critic_version,status,scores,issues,hard_failure,confidence,explanation,guidance,evidence,input_fingerprint,workflow_step_id,attempt,created_at,completed_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        value.id,
        value.projectId,
        value.generationId,
        value.candidateSetId,
        value.shotId,
        value.sceneRevisionId,
        value.assetId,
        value.assetSha256,
        value.packageFingerprint,
        value.referenceFingerprint,
        value.critic.provider,
        value.critic.model,
        value.critic.version,
        value.status,
        JSON.stringify(value.scores),
        JSON.stringify(value.issues),
        value.hardFailure ? 1 : 0,
        value.confidence,
        value.explanation,
        value.guidance,
        JSON.stringify(value.evidence),
        value.inputFingerprint,
        input.workflowStepId ?? null,
        value.attempt,
        value.createdAt,
        value.completedAt,
      );
    return value;
  }

  getImage(generationId: Id, inputFingerprint: string): ImageCriticEvaluation | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,generation_id as generationId,candidate_set_id as candidateSetId,shot_stable_id as shotId,scene_revision_id as sceneRevisionId,asset_id as assetId,asset_sha256 as assetSha256,package_fingerprint as packageFingerprint,reference_fingerprint as referenceFingerprint,critic_provider as criticProvider,critic_model as criticModel,critic_version as criticVersion,status,scores,issues,hard_failure as hardFailure,confidence,explanation,guidance,evidence,input_fingerprint as inputFingerprint,attempt,created_at as createdAt,completed_at as completedAt
         FROM image_critic_evaluations WHERE generation_id=? AND input_fingerprint=?`,
      )
      .get(generationId, inputFingerprint) as Record<string, unknown> | undefined;
    return row ? this.parseImage(row) : null;
  }

  latestImage(generationId: Id): ImageCriticEvaluation | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,generation_id as generationId,candidate_set_id as candidateSetId,shot_stable_id as shotId,scene_revision_id as sceneRevisionId,asset_id as assetId,asset_sha256 as assetSha256,package_fingerprint as packageFingerprint,reference_fingerprint as referenceFingerprint,critic_provider as criticProvider,critic_model as criticModel,critic_version as criticVersion,status,scores,issues,hard_failure as hardFailure,confidence,explanation,guidance,evidence,input_fingerprint as inputFingerprint,attempt,created_at as createdAt,completed_at as completedAt
         FROM image_critic_evaluations WHERE generation_id=? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(generationId) as Record<string, unknown> | undefined;
    return row ? this.parseImage(row) : null;
  }

  private parseImage(row: Record<string, unknown>): ImageCriticEvaluation {
    return imageCriticEvaluationSchema.parse({
      ...row,
      critic: {
        provider: row.criticProvider,
        model: row.criticModel,
        version: row.criticVersion,
      },
      scores: JSON.parse(row.scores as string),
      issues: JSON.parse(row.issues as string),
      evidence: JSON.parse(row.evidence as string),
      hardFailure: row.hardFailure === 1,
    });
  }

  saveVideo(input: VideoInput): VideoCriticEvaluation {
    const existing = this.getVideo(input.generationId, input.inputFingerprint);
    if (existing) return existing;
    const timestamp = now();
    const value = videoCriticEvaluationSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: timestamp,
      completedAt: timestamp,
    });
    this.database.sqlite
      .prepare(
        `INSERT INTO video_critic_evaluations(id,project_id,generation_id,shot_stable_id,scene_revision_id,clip_asset_id,clip_sha256,keyframe_asset_id,keyframe_sha256,shot_fingerprint,critic_provider,critic_model,critic_version,status,issues,confidence,explanation,guidance,evidence,input_fingerprint,workflow_step_id,attempt,created_at,completed_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        value.id,
        value.projectId,
        value.generationId,
        value.shotId,
        value.sceneRevisionId,
        value.clipAssetId,
        value.clipSha256,
        value.keyframeAssetId,
        value.keyframeSha256,
        value.shotFingerprint,
        value.critic.provider,
        value.critic.model,
        value.critic.version,
        value.status,
        JSON.stringify(value.issues),
        value.confidence,
        value.explanation,
        value.guidance,
        JSON.stringify(value.evidence),
        value.inputFingerprint,
        input.workflowStepId ?? null,
        value.attempt,
        value.createdAt,
        value.completedAt,
      );
    return value;
  }

  getVideo(generationId: Id, inputFingerprint: string): VideoCriticEvaluation | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,generation_id as generationId,shot_stable_id as shotId,scene_revision_id as sceneRevisionId,clip_asset_id as clipAssetId,clip_sha256 as clipSha256,keyframe_asset_id as keyframeAssetId,keyframe_sha256 as keyframeSha256,shot_fingerprint as shotFingerprint,critic_provider as criticProvider,critic_model as criticModel,critic_version as criticVersion,status,issues,confidence,explanation,guidance,evidence,input_fingerprint as inputFingerprint,attempt,created_at as createdAt,completed_at as completedAt
         FROM video_critic_evaluations WHERE generation_id=? AND input_fingerprint=?`,
      )
      .get(generationId, inputFingerprint) as Record<string, unknown> | undefined;
    return row
      ? videoCriticEvaluationSchema.parse({
          ...row,
          critic: {
            provider: row.criticProvider,
            model: row.criticModel,
            version: row.criticVersion,
          },
          issues: JSON.parse(row.issues as string),
          evidence: JSON.parse(row.evidence as string),
        })
      : null;
  }
}
