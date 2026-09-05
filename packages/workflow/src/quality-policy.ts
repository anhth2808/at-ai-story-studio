import type {
  ImageConditioningMode,
  ImageCriticEvaluation,
  ImageQualityScores,
  ProductionProfileSettings,
  Shot,
} from '@studio/shared';

export function imageCandidateCount(
  settings: Pick<ProductionProfileSettings, 'imageCandidatePolicy' | 'imageCandidateCount'>,
  shot?: Pick<Shot, 'importance' | 'hero' | 'identitySensitive' | 'dialogueMode' | 'staticIntent'>,
): number {
  if (settings.imageCandidatePolicy === 'FAST') return 1;
  if (!shot) return Math.min(3, settings.imageCandidateCount);
  const important =
    shot.importance === 'HIGH' ||
    shot.hero ||
    shot.identitySensitive ||
    shot.staticIntent.framing === 'CLOSE_UP' ||
    shot.staticIntent.framing === 'EXTREME_CLOSE_UP' ||
    shot.dialogueMode === 'SPOKEN';
  if (settings.imageCandidatePolicy === 'BALANCED') return important ? 2 : 1;
  if (!important) return Math.min(2, settings.imageCandidateCount);
  return Math.max(2, Math.min(3, settings.imageCandidateCount));
}
export function imageConditioningModeForShot(
  settings: Pick<ProductionProfileSettings, 'imageCandidatePolicy' | 'strictReferenceRequirement'>,
  shot: Pick<
    Shot,
    | 'visibleCharacterIds'
    | 'importance'
    | 'hero'
    | 'identitySensitive'
    | 'dialogueMode'
    | 'staticIntent'
  >,
): ImageConditioningMode | undefined {
  if (!shot.visibleCharacterIds.length) return undefined;
  const important =
    shot.importance === 'HIGH' ||
    shot.hero ||
    shot.identitySensitive ||
    shot.staticIntent.framing === 'CLOSE_UP' ||
    shot.staticIntent.framing === 'EXTREME_CLOSE_UP' ||
    shot.dialogueMode === 'SPOKEN';
  return settings.strictReferenceRequirement ||
    (settings.imageCandidatePolicy === 'QUALITY' && important)
    ? 'REFERENCE_CONDITIONED'
    : undefined;
}

const imageQualityWeights: Partial<Record<keyof ImageQualityScores, number>> = {
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

export function imageQualityScore(scores: ImageQualityScores): number {
  const values = Object.entries(scores).filter(
    (entry): entry is [keyof ImageQualityScores, number] => typeof entry[1] === 'number',
  );
  const weighted = values.reduce(
    (sum, [key, value]) => sum + value * (imageQualityWeights[key] ?? 1),
    0,
  );
  const weight = values.reduce((sum, [key]) => sum + (imageQualityWeights[key] ?? 1), 0);
  return weight ? Number((weighted / weight).toFixed(6)) : 0;
}

export function imageQualityEligible(
  evaluation: Pick<ImageCriticEvaluation, 'status' | 'hardFailure' | 'scores'>,
  threshold: number,
): boolean {
  return (
    evaluation.status === 'PASSED' &&
    !evaluation.hardFailure &&
    imageQualityScore(evaluation.scores) >= threshold
  );
}

export function automaticQualityAction(
  status: 'PASSED' | 'REJECTED' | 'UNAVAILABLE' | 'MANUAL_REVIEW_REQUIRED',
  fallback: ProductionProfileSettings['qualityFallback'],
): 'ACCEPT' | 'RETRY' | 'REVIEW' | 'BLOCK' {
  if (status === 'PASSED') return 'ACCEPT';
  if (status === 'REJECTED') return 'RETRY';
  if (fallback === 'ALLOW_DEGRADED_WITH_REVIEW' || fallback === 'MANUAL_REVIEW') return 'REVIEW';
  return 'BLOCK';
}

export function resolveReferenceFallback(
  requiredCharacterIds: string[],
  boundCharacterIds: string[],
  strict: boolean,
): { mode: 'REFERENCE_CONDITIONED' | 'TEXT_ONLY'; audit: 'NONE' | 'REFERENCE_FALLBACK_TEXT_ONLY' } {
  const bound = new Set(boundCharacterIds);
  const missing = requiredCharacterIds.filter((id) => !bound.has(id));
  if (!missing.length) return { mode: 'REFERENCE_CONDITIONED', audit: 'NONE' };
  if (strict) throw new Error(`Missing required Character references: ${missing.join(', ')}`);
  return { mode: 'TEXT_ONLY', audit: 'REFERENCE_FALLBACK_TEXT_ONLY' };
}
