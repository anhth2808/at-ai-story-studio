import { MediaCriticEvaluationRepository } from '@studio/database';
import {
  AppError,
  imageCriticResultSchema,
  videoCriticResultSchema,
  type CriticEvidence,
  type Id,
  type ImageCandidateRanking,
  type ImageCriticEvaluation,
  type Shot,
  type ImageQualityIssue,
  type VideoCriticEvaluation,
  type VideoGenerationIssue,
} from '@studio/shared';
import type { AiAgent } from './omp-agent.js';
import { fingerprintValue, stableSerialize } from './story-prompts.js';
import { imageQualityScore } from './quality-policy.js';
const IMAGE_CRITIC_VERSION = 'image-critic-v2';
const VIDEO_CRITIC_VERSION = 'video-critic-v2';

export type ImageCriticInput = {
  projectId: Id;
  generationId: Id;
  candidateSetId: Id | null;
  shot: Shot | null;
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
    const { imagePaths, shot, ...durableInput } = input;
    const inputFingerprint = fingerprintValue({
      version: IMAGE_CRITIC_VERSION,
      input: durableInput,
    });
    const existing = this.evaluations.getImage(input.generationId, inputFingerprint);
    if (existing) return existing;
    const prompt = [
      'Return JSON only with exact keys status, scores, issues, hardFailure, confidence, explanation, guidance.',
      'Status must be PASSED, REJECTED, MANUAL_REVIEW_REQUIRED, or UNAVAILABLE.',
      'The scores object must use exactly these uppercase keys: IDENTITY, FACE_CONSISTENCY, HAIR, CLOTHING_STAGE, VISIBLE_CHARACTER_COUNT, PROMPT_ADHERENCE, COMPOSITION, POSE_ACTION, CAMERA_FRAMING, LOCATION, IMPORTANT_OBJECTS, ANATOMY, HANDS, STYLE, ARTIFACTS, OVERALL. Each value must be an integer from 1 to 5; do not use lowercase keys.',
      'Issues must be an array containing only these uppercase values: WRONG_FACE, WRONG_HAIR, WRONG_CLOTHING, STAGE_MISMATCH, MISSING_CHARACTER, EXTRA_CHARACTER, WRONG_POSE, WRONG_COMPOSITION, WRONG_CAMERA, WRONG_LOCATION, MISSING_OBJECT, EXTRA_OBJECT, DUPLICATE_OBJECT, BAD_HANDS, ANATOMY_DEFECT, BAD_TEXT, STYLE_DRIFT, REFERENCE_POSE_BLEED, OTHER.',
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
        ...durableInput,
        shotId: shot?.id ?? null,
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
        ...durableInput,
        shotId: shot?.id ?? null,
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

export function rankImageCandidates(
  candidates: Array<{
    generationId: Id;
    candidateIndex: number;
    evaluation: ImageCriticEvaluation;
  }>,
  minimumScore = 0,
): ImageCandidateRanking {
  const entries = candidates
    .map(({ generationId, candidateIndex, evaluation }) => {
      const score = imageQualityScore(evaluation.scores);
      const hardFailure = evaluation.hardFailure || evaluation.status !== 'PASSED';
      const belowThreshold = score < minimumScore;
      const excluded = hardFailure || belowThreshold;
      return {
        generationId,
        candidateIndex,
        score,
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
        reason: hardFailure
          ? 'Excluded by automatic hard failure'
          : belowThreshold
            ? `Excluded below automatic score threshold ${minimumScore}`
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

const IMAGE_RETRY_GUIDANCE: Record<ImageQualityIssue, string> = {
  WRONG_FACE: 'Preserve the exact approved face identity.',
  WRONG_HAIR: 'Preserve the approved hair shape and color.',
  WRONG_CLOTHING: 'Preserve the approved clothing and accessories.',
  STAGE_MISMATCH: 'Use the exact approved appearance stage.',
  MISSING_CHARACTER: 'Keep every required visible Character in frame.',
  EXTRA_CHARACTER: 'Do not introduce an unintended primary Character.',
  WRONG_POSE: 'Follow the requested pose and visible action.',
  WRONG_COMPOSITION: 'Follow the requested composition and subject placement.',
  WRONG_CAMERA: 'Follow the requested framing and camera angle.',
  WRONG_LOCATION: 'Preserve the approved Location geometry.',
  MISSING_OBJECT: 'Include every required visible object.',
  EXTRA_OBJECT: 'Remove unrequested visible objects.',
  DUPLICATE_OBJECT: 'Keep each visible object singular and distinct.',
  BAD_HANDS: 'Keep hands anatomically coherent and visible only when intended.',
  ANATOMY_DEFECT: 'Keep anatomy and body proportions coherent.',
  BAD_TEXT: 'Remove unintended text and lettering artifacts.',
  STYLE_DRIFT: 'Preserve the current Style Bible appearance.',
  REFERENCE_POSE_BLEED: 'Use references for identity, not their source pose or framing.',
  OTHER: 'Preserve the exact Shot composition and visible intent.',
};

export function imageRetryGuidance(
  issues: ImageQualityIssue[],
  providerGuidance = '',
  providerExplanation = '',
): string {
  const deterministic = [...new Set(issues)].sort().map((issue) => IMAGE_RETRY_GUIDANCE[issue]);
  return [...deterministic, providerGuidance.trim(), providerExplanation.trim()]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2_000);
}

const TEMPORAL_RETRY_GUIDANCE: Record<VideoGenerationIssue, string> = {
  IDENTITY_DRIFT: 'Preserve the established character identity from the source frame.',
  FACE_DISTORTION: 'Keep facial structure stable throughout the clip.',
  MISSING_PRIMARY_PERSON: 'Keep every required primary person visible.',
  EXTRA_PRIMARY_PERSON: 'Do not introduce additional primary people.',
  FABRICATED_FACE: 'Do not generate faces for background figures or objects.',
  BODY_DISTORTION: 'Keep body proportions and anatomy stable.',
  EXTRA_LIMBS: 'Do not add limbs or duplicate body parts.',
  MOTION_TOO_STRONG: 'Reduce motion amplitude and keep the camera move restrained.',
  CLOTHING_DRIFT: 'Keep clothing, accessories, and equipment unchanged.',
  MOTION_TOO_WEAK: 'Make the requested subject motion visible but controlled.',
  CAMERA_WRONG: 'Follow the requested camera direction and framing.',
  OBJECT_MORPHING: 'Keep held and nearby objects rigid and consistent.',
  BACKGROUND_MORPHING: 'Keep the background geometry stable.',
  FLICKER: 'Remove temporal flicker and keep illumination stable.',
  LOOP_BAD: 'Avoid visible loop seams and abrupt resets.',
  OTHER: 'Preserve the source composition and requested motion.',
  TEMPORAL_INSTABILITY: 'Keep identity, geometry, and motion temporally stable.',
};

export function temporalRetryGuidance(
  issues: VideoGenerationIssue[],
  providerGuidance = '',
  providerExplanation = '',
): string {
  const deterministic = [...new Set(issues)].sort().map((issue) => TEMPORAL_RETRY_GUIDANCE[issue]);
  return [...deterministic, providerGuidance.trim(), providerExplanation.trim()]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2_000);
}

export type VideoCriticInput = {
  projectId: Id;
  generationId: Id;
  shot: Shot | null;
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
    const shotFingerprint = input.shot ? fingerprintValue(input.shot) : 'scene';
    const { imagePaths, shot, ...durableInput } = input;
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
            'Status must be PASSED, REJECTED, MANUAL_REVIEW_REQUIRED, or UNAVAILABLE.',
            'Issues must be an array containing only these uppercase values: IDENTITY_DRIFT, FACE_DISTORTION, MISSING_PRIMARY_PERSON, EXTRA_PRIMARY_PERSON, FABRICATED_FACE, BODY_DISTORTION, EXTRA_LIMBS, MOTION_TOO_STRONG, CLOTHING_DRIFT, MOTION_TOO_WEAK, CAMERA_WRONG, OBJECT_MORPHING, BACKGROUND_MORPHING, FLICKER, LOOP_BAD, OTHER, TEMPORAL_INSTABILITY.',
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
        ...durableInput,
        shotId: shot?.id ?? null,
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
        ...durableInput,
        shotId: shot?.id ?? null,
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
