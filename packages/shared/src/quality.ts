import { z } from 'zod';

const idSchema = z.string().uuid();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const automaticQualityStatusSchema = z.enum([
  'NOT_RUN',
  'RUNNING',
  'PASSED',
  'REJECTED',
  'UNAVAILABLE',
  'DEGRADED_ACCEPTED',
  'MANUAL_REVIEW_REQUIRED',
]);
export type AutomaticQualityStatus = z.infer<typeof automaticQualityStatusSchema>;

export const criticKindSchema = z.enum(['IMAGE', 'VIDEO']);
export type CriticKind = z.infer<typeof criticKindSchema>;

export const criticIdentitySchema = z
  .object({
    provider: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(300),
    version: z.string().trim().min(1).max(80),
  })
  .strict();
export type CriticIdentity = z.infer<typeof criticIdentitySchema>;

export const criticEvidenceSchema = z
  .object({
    assetId: idSchema,
    sha256: hashSchema,
    role: z.enum(['CANDIDATE', 'REFERENCE', 'KEYFRAME', 'SAMPLE']),
    samplePosition: z.number().min(0).max(1).nullable().default(null),
  })
  .strict();
export type CriticEvidence = z.infer<typeof criticEvidenceSchema>;

export const mediaCriticEvaluationBaseSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    kind: criticKindSchema,
    status: automaticQualityStatusSchema,
    critic: criticIdentitySchema,
    inputFingerprint: z.string().trim().min(1).max(128),
    evidence: z.array(criticEvidenceSchema).min(1).max(20),
    confidence: z.number().min(0).max(1),
    explanation: z.string().trim().max(2_000),
    guidance: z.string().trim().max(2_000),
    attempt: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
export type MediaCriticEvaluationBase = z.infer<typeof mediaCriticEvaluationBaseSchema>;

export const qualityFallbackSchema = z.enum([
  'BLOCK',
  'MANUAL_REVIEW',
  'ALLOW_DEGRADED_WITH_REVIEW',
]);
export type QualityFallback = z.infer<typeof qualityFallbackSchema>;
