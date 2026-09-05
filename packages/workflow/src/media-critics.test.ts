import { describe, expect, it } from 'vitest';
import { imageCriticEvaluationSchema } from '@studio/shared';
import type { Shot } from '@studio/shared';
import { rankImageCandidates, temporalRetryGuidance } from './media-critics.js';
import { automaticQualityAction, imageCandidateCount } from './quality-policy.js';

const ids = {
  project: '11111111-1111-4111-8111-111111111111',
  scene: '22222222-2222-4222-8222-222222222222',
  asset: '33333333-3333-4333-8333-333333333333',
  first: '44444444-4444-4444-8444-444444444444',
  second: '55555555-5555-4555-8555-555555555555',
  set: '66666666-6666-4666-8666-666666666666',
  evaluation: '77777777-7777-4777-8777-777777777777',
};

function evaluation(
  generationId: string,
  options: {
    hardFailure?: boolean;
    status?: 'PASSED' | 'REJECTED' | 'MANUAL_REVIEW_REQUIRED' | 'UNAVAILABLE';
  } = {},
) {
  const hardFailure = options.hardFailure ?? false;
  return imageCriticEvaluationSchema.parse({
    id: ids.evaluation,
    projectId: ids.project,
    generationId,
    candidateSetId: ids.set,
    shotId: 'shot-1',
    sceneRevisionId: ids.scene,
    assetId: ids.asset,
    assetSha256: 'a'.repeat(64),
    packageFingerprint: 'package',
    referenceFingerprint: 'references',
    inputFingerprint: generationId,
    status: options.status ?? (hardFailure ? 'REJECTED' : 'PASSED'),
    critic: { provider: 'OMP', model: 'critic', version: 'v1' },
    evidence: [
      { assetId: ids.asset, sha256: 'a'.repeat(64), role: 'CANDIDATE', samplePosition: null },
    ],
    scores: { IDENTITY: 5, OVERALL: 4 },
    issues: hardFailure ? ['WRONG_FACE'] : [],
    hardFailure,
    confidence: 0.9,
    explanation: 'deterministic fixture',
    guidance: '',
    attempt: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
  });
}

const shot = {
  importance: 'HIGH',
  hero: true,
  identitySensitive: true,
  dialogueMode: 'SPOKEN',
  staticIntent: { framing: 'CLOSE_UP' },
} as Pick<Shot, 'importance' | 'hero' | 'identitySensitive' | 'dialogueMode' | 'staticIntent'>;

describe('automatic media quality policy', () => {
  it('uses deterministic candidate counts by profile and importance', () => {
    expect(
      imageCandidateCount({ imageCandidatePolicy: 'FAST', imageCandidateCount: 3 }, shot),
    ).toBe(1);
    expect(
      imageCandidateCount({ imageCandidatePolicy: 'BALANCED', imageCandidateCount: 2 }, shot),
    ).toBe(2);
    expect(
      imageCandidateCount({ imageCandidatePolicy: 'QUALITY', imageCandidateCount: 3 }, shot),
    ).toBe(3);
    expect(
      imageCandidateCount(
        { imageCandidatePolicy: 'QUALITY', imageCandidateCount: 3 },
        {
          ...shot,
          importance: 'LOW',
          hero: false,
          identitySensitive: false,
          dialogueMode: 'NONE',
          staticIntent: { ...shot.staticIntent, framing: 'WIDE' },
        },
      ),
    ).toBe(2);
  });

  it('excludes any non-passed verdict and resolves stable ties by candidate index', () => {
    const ranking = rankImageCandidates([
      {
        generationId: ids.second,
        candidateIndex: 2,
        evaluation: evaluation(ids.second, { status: 'MANUAL_REVIEW_REQUIRED' }),
      },
      { generationId: ids.first, candidateIndex: 1, evaluation: evaluation(ids.first) },
    ]);
    expect(ranking.winnerGenerationId).toBe(ids.first);
    const failed = rankImageCandidates([
      {
        generationId: ids.first,
        candidateIndex: 1,
        evaluation: evaluation(ids.first, { hardFailure: true }),
      },
    ]);
    expect(failed.winnerGenerationId).toBeNull();
  });

  it('applies the automatic score threshold before selecting a winner', () => {
    const ranking = rankImageCandidates(
      [{ generationId: ids.first, candidateIndex: 1, evaluation: evaluation(ids.first) }],
      5,
    );
    expect(ranking.winnerGenerationId).toBeNull();
    expect(ranking.entries[0]?.reason).toContain('threshold');
  });

  it('never converts critic unavailability into a pass', () => {
    expect(automaticQualityAction('UNAVAILABLE', 'BLOCK')).toBe('BLOCK');
    expect(automaticQualityAction('UNAVAILABLE', 'MANUAL_REVIEW')).toBe('REVIEW');
    expect(automaticQualityAction('REJECTED', 'ALLOW_DEGRADED_WITH_REVIEW')).toBe('RETRY');
  });
  it('builds stable temporal retry guidance from every supported issue class', () => {
    const first = temporalRetryGuidance(
      [
        'BACKGROUND_MORPHING',
        'CLOTHING_DRIFT',
        'EXTRA_PRIMARY_PERSON',
        'FABRICATED_FACE',
        'FLICKER',
        'IDENTITY_DRIFT',
        'MISSING_PRIMARY_PERSON',
      ],
      'keep it subtle',
      'The source face is stable.',
    );
    const second = temporalRetryGuidance(
      [
        'MISSING_PRIMARY_PERSON',
        'IDENTITY_DRIFT',
        'FLICKER',
        'FABRICATED_FACE',
        'EXTRA_PRIMARY_PERSON',
        'CLOTHING_DRIFT',
        'BACKGROUND_MORPHING',
      ],
      'keep it subtle',
      'The source face is stable.',
    );
    expect(first).toBe(second);
    expect(first).toContain('Keep every required primary person visible.');
    expect(first).toContain('Do not introduce additional primary people.');
    expect(first).toContain('Do not generate faces for background figures or objects.');
    expect(first).toContain('Keep clothing, accessories, and equipment unchanged.');
    expect(first).toContain('Keep the background geometry stable.');
    expect(first).toContain('Preserve the established character identity from the source frame.');
    expect(first).toContain('The source face is stable.');
  });
});
