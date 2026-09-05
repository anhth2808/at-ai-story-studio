import { MediaCriticEvaluationRepository } from '@studio/database';
import {
  AppError,
  imageCriticResultSchema,
  videoCriticResultSchema,
  type CriticEvidence,
  type Id,
  type ImageCandidateRanking,
  type ImageCriticEvaluation,
  type ImageQualityScores,
  type Shot,
  type VideoCriticEvaluation,
} from '@studio/shared';
import type { AiAgent } from './omp-agent.js';
import { fingerprintValue, stableSerialize } from './story-prompts.js';

const IMAGE_CRITIC_VERSION = 'image-critic-v1';
const VIDEO_CRITIC_VERSION = 'video-critic-v1';

export type ImageCriticInput = {
  projectId: Id;
  generationId: Id;
  candidateSetId: Id | null;
  shot: Shot;
  sceneRevisionId: Id;
  assetId: Id;
  assetSha256: string;
  packageFingerprint: string;
  referenceFingerprint: string;
  evidence: CriticEvidence[];
  imagePaths: string[];
};

export class ImageCritic {
  constructor(
    private readonly agent: AiAgent,
    private readonly evaluations: MediaCriticEvaluationRepository,
  ) {}

  async evaluate(input: ImageCriticInput, signal?: AbortSignal): Promise<ImageCriticEvaluation> {
    const { imagePaths, ...durableInput } = input;
    const inputFingerprint = fingerprintValue({
      version: IMAGE_CRITIC_VERSION,
      input: durableInput,
    });
    const existing = this.evaluations.getImage(input.generationId, inputFingerprint);
    if (existing) return existing;
    const prompt = [
      'Return JSON only with exact keys status, scores, issues, hardFailure, confidence, explanation, guidance.',
      'Status must be PASSED, REJECTED, MANUAL_REVIEW_REQUIRED, or UNAVAILABLE.',
      'Score identity, face consistency, hair, clothing stage, visible Character count, prompt adherence, composition, pose/action, camera framing, Location, important objects, anatomy, hands, style, artifacts, and overall from 1 to 5.',
      'Reject wrong identity, stage mismatch, missing or extra primary Characters, severe anatomy, or missing required reference evidence.',
      stableSerialize({
        shot: input.shot,
        evidence: input.evidence,
        packageFingerprint: input.packageFingerprint,
        referenceFingerprint: input.referenceFingerprint,
      }),
    ].join('\n');
    try {
      const result = await this.agent.generate(
        {
          operation: 'IMAGE_CRITIC',
          model: null,
          promptVersion: IMAGE_CRITIC_VERSION,
          schemaVersion: IMAGE_CRITIC_VERSION,
          inputFingerprint,
          systemPrompt:
            'You are an automatic image quality critic. Evaluate only; never mutate canonical data.',
          userPrompt: prompt,
          imagePaths,
        },
        signal,
      );
      const verdict = imageCriticResultSchema.parse(JSON.parse(result.text));
      return this.evaluations.saveImage({
        ...input,
        shotId: input.shot.id,
        inputFingerprint,
        status: verdict.status,
        critic: {
          provider: result.provider ?? 'OMP',
          model: result.model ?? 'unknown',
          version: IMAGE_CRITIC_VERSION,
        },
        scores: verdict.scores,
        issues: verdict.issues,
        hardFailure: verdict.hardFailure,
        confidence: verdict.confidence,
        explanation: verdict.explanation,
        guidance: verdict.guidance,
        attempt: 1,
      });
    } catch (error) {
      if (signal?.aborted) throw new AppError('CANCELLED', 'Image critic cancelled', 409);
      return this.evaluations.saveImage({
        ...input,
        shotId: input.shot.id,
        inputFingerprint,
        status: 'UNAVAILABLE',
        critic: { provider: 'OMP', model: 'unknown', version: IMAGE_CRITIC_VERSION },
        scores: {},
        issues: [],
        hardFailure: false,
        confidence: 0,
        explanation:
          error instanceof Error ? error.message.slice(0, 2_000) : 'Image critic unavailable',
        guidance: 'Retry the critic or request manual review',
        attempt: 1,
      });
    }
  }
}

const weights: Partial<Record<keyof ImageQualityScores, number>> = {
  IDENTITY: 3,
  FACE_CONSISTENCY: 3,
  CLOTHING_STAGE: 2,
  VISIBLE_CHARACTER_COUNT: 3,
  PROMPT_ADHERENCE: 2,
  COMPOSITION: 1,
  CAMERA_FRAMING: 1,
  LOCATION: 2,
  ANATOMY: 2,
  HANDS: 1,
  STYLE: 1,
  OVERALL: 2,
};

export function rankImageCandidates(
  candidates: Array<{
    generationId: Id;
    candidateIndex: number;
    evaluation: ImageCriticEvaluation;
  }>,
): ImageCandidateRanking {
  const entries = candidates
    .map(({ generationId, candidateIndex, evaluation }) => {
      const values = Object.entries(evaluation.scores).filter(
        (entry): entry is [keyof ImageQualityScores, number] => typeof entry[1] === 'number',
      );
      const weighted = values.reduce((sum, [key, value]) => sum + value * (weights[key] ?? 1), 0);
      const weight = values.reduce((sum, [key]) => sum + (weights[key] ?? 1), 0);
      const excluded = evaluation.hardFailure || evaluation.status !== 'PASSED';
      return {
        generationId,
        candidateIndex,
        score: weight ? Number((weighted / weight).toFixed(6)) : 0,
        severeIssueCount: evaluation.issues.filter((value) =>
          [
            'WRONG_FACE',
            'STAGE_MISMATCH',
            'MISSING_CHARACTER',
            'EXTRA_CHARACTER',
            'ANATOMY_DEFECT',
          ].includes(value),
        ).length,
        excluded,
        reason: excluded
          ? 'Excluded by automatic hard failure'
          : 'Weighted automatic quality score',
      };
    })
    .sort(
      (left, right) =>
        Number(left.excluded) - Number(right.excluded) ||
        right.score - left.score ||
        left.severeIssueCount - right.severeIssueCount ||
        left.candidateIndex - right.candidateIndex ||
        left.generationId.localeCompare(right.generationId),
    );
  const winner = entries.find((entry) => !entry.excluded) ?? null;
  return {
    version: 'image-ranking-v1',
    entries,
    winnerGenerationId: winner?.generationId ?? null,
    reason: winner
      ? 'Highest eligible deterministic weighted score'
      : 'Every candidate failed quality gates',
  };
}

export type VideoCriticInput = {
  projectId: Id;
  generationId: Id;
  shot: Shot;
  sceneRevisionId: Id;
  clipAssetId: Id;
  clipSha256: string;
  keyframeAssetId: Id;
  keyframeSha256: string;
  evidence: CriticEvidence[];
  imagePaths: string[];
};

export class VideoCritic {
  constructor(
    private readonly agent: AiAgent,
    private readonly evaluations: MediaCriticEvaluationRepository,
  ) {}

  async evaluate(input: VideoCriticInput, signal?: AbortSignal): Promise<VideoCriticEvaluation> {
    const shotFingerprint = fingerprintValue(input.shot);
    const { imagePaths, ...durableInput } = input;
    const inputFingerprint = fingerprintValue({
      version: VIDEO_CRITIC_VERSION,
      input: durableInput,
      shotFingerprint,
    });
    const existing = this.evaluations.getVideo(input.generationId, inputFingerprint);
    if (existing) return existing;
    try {
      const result = await this.agent.generate(
        {
          operation: 'VIDEO_CRITIC',
          model: null,
          promptVersion: VIDEO_CRITIC_VERSION,
          schemaVersion: VIDEO_CRITIC_VERSION,
          inputFingerprint,
          systemPrompt:
            'You are an automatic temporal quality critic. Evaluate only; never mutate canonical data.',
          userPrompt: [
            'Return JSON only with exact keys status, issues, confidence, explanation, guidance.',
            'Check identity drift, missing or extra primary person, fabricated face, face/body distortion, extra limbs, clothing drift, object/background morphing, flicker, camera behavior, motion strength, and temporal instability.',
            'Background extras are not primary people. Reject a new frontal face when the source face is back-facing or occluded.',
            stableSerialize({ shot: input.shot, evidence: input.evidence }),
          ].join('\n'),
          imagePaths,
        },
        signal,
      );
      const verdict = videoCriticResultSchema.parse(JSON.parse(result.text));
      return this.evaluations.saveVideo({
        ...input,
        shotId: input.shot.id,
        shotFingerprint,
        inputFingerprint,
        status: verdict.status,
        critic: {
          provider: result.provider ?? 'OMP',
          model: result.model ?? 'unknown',
          version: VIDEO_CRITIC_VERSION,
        },
        issues: verdict.issues,
        confidence: verdict.confidence,
        explanation: verdict.explanation,
        guidance: verdict.guidance,
        attempt: 1,
      });
    } catch (error) {
      if (signal?.aborted) throw new AppError('CANCELLED', 'Video critic cancelled', 409);
      return this.evaluations.saveVideo({
        ...input,
        shotId: input.shot.id,
        shotFingerprint,
        inputFingerprint,
        status: 'UNAVAILABLE',
        critic: { provider: 'OMP', model: 'unknown', version: VIDEO_CRITIC_VERSION },
        issues: [],
        confidence: 0,
        explanation:
          error instanceof Error ? error.message.slice(0, 2_000) : 'Video critic unavailable',
        guidance: 'Retry the critic or request manual review',
        attempt: 1,
      });
    }
  }
}
