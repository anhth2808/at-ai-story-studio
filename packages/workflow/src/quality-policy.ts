import type { ProductionProfileSettings, Shot } from '@studio/shared';

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
