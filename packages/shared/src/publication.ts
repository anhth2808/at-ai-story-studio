import { z } from 'zod';

const idSchema = z.string().uuid();
const safeText = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => safeText(max).min(1);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a SHA-256 hash');
const publicationTimestampSchema = z.string().datetime({ offset: true });
const publicationMetricValueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const publicationMetricsSchema = z
  .record(z.string().max(100), publicationMetricValueSchema)
  .superRefine((metrics, context) => {
    for (const key of Object.keys(metrics)) {
      if (/(?:api[_-]?key|credential|password|secret|token)/iu.test(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Credentials are not allowed in publication metrics',
        });
      }
    }
  });

export const publicationPackageStatusSchema = z.enum(['DRAFT', 'INCOMPLETE', 'READY', 'STALE']);
export type PublicationPackageStatus = z.infer<typeof publicationPackageStatusSchema>;

export const publicationValidationSeveritySchema = z.enum(['INFO', 'WARNING', 'BLOCKING']);
export type PublicationValidationSeverity = z.infer<typeof publicationValidationSeveritySchema>;

export const publicationMetadataSchema = z
  .object({
    title: requiredText(200),
    description: requiredText(5_000),
    shortDescription: safeText(500),
    tags: z.array(requiredText(80)).max(50),
    contentWarning: safeText(500).nullable(),
    language: requiredText(20),
  })
  .strict();
export type PublicationMetadata = z.infer<typeof publicationMetadataSchema>;

export const publicationMetadataUpdateSchema = z
  .object({
    expectedRevision: z.number().int().positive().optional(),
    title: requiredText(200).optional(),
    description: requiredText(5_000).optional(),
    shortDescription: safeText(500).optional(),
    tags: z.array(requiredText(80)).max(50).optional(),
    contentWarning: safeText(500).nullable().optional(),
    language: requiredText(20).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.shortDescription !== undefined ||
      value.tags !== undefined ||
      value.contentWarning !== undefined ||
      value.language !== undefined,
    { message: 'At least one metadata field is required' },
  );
export type PublicationMetadataUpdate = z.infer<typeof publicationMetadataUpdateSchema>;

export const publicationAssetReferenceSchema = z
  .object({
    assetId: idSchema,
    sha256: hashSchema,
    mediaType: requiredText(120),
    bytes: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().nullable(),
    exportName: requiredText(180).regex(/^[A-Za-z0-9._-]+$/u, 'Export name is unsafe'),
    url: requiredText(500).refine(
      (value) =>
        value.startsWith('/') &&
        !value.startsWith('//') &&
        !value.includes('\\') &&
        !value.includes('..'),
      {
        message: 'Asset URLs must be relative API URLs',
      },
    ),
  })
  .strict();
export type PublicationAssetReference = z.infer<typeof publicationAssetReferenceSchema>;

export const publicationChapterMarkerSchema = z
  .object({
    chapterId: idSchema,
    chapterNumber: z.number().int().positive(),
    title: requiredText(200),
    offsetMs: z.number().int().nonnegative(),
  })
  .strict();
export type PublicationChapterMarker = z.infer<typeof publicationChapterMarkerSchema>;

export const publicationValidationIssueSchema = z
  .object({
    code: requiredText(120),
    severity: publicationValidationSeveritySchema,
    message: requiredText(500),
    action: requiredText(500),
  })
  .strict();
export type PublicationValidationIssue = z.infer<typeof publicationValidationIssueSchema>;

export const publicationManifestSchema = z
  .object({
    format: z.literal('ai-story-studio-publication'),
    formatVersion: z.literal(1),
    projectId: idSchema,
    runId: idSchema,
    packageId: idSchema,
    packageRevision: z.number().int().positive(),
    packageFingerprint: requiredText(128),
    scope: z
      .object({
        type: z.enum(['FULL_PROJECT', 'CHAPTER_RANGE']),
        startChapter: z.number().int().positive().nullable(),
        endChapter: z.number().int().positive().nullable(),
      })
      .strict(),
    video: publicationAssetReferenceSchema,
    subtitles: z.array(publicationAssetReferenceSchema).max(500),
    thumbnail: publicationAssetReferenceSchema.nullable(),
    metadata: publicationMetadataSchema,
    chapterMarkers: z.array(publicationChapterMarkerSchema).max(500),
    validation: z.array(publicationValidationIssueSchema).max(200),
    metrics: publicationMetricsSchema,
    generatedAt: publicationTimestampSchema,
  })
  .strict();
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;

export const publicationPackageDtoSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    runId: idSchema,
    revision: z.number().int().positive(),
    status: publicationPackageStatusSchema,
    fingerprint: requiredText(128),
    video: publicationAssetReferenceSchema.nullable(),
    subtitles: z.array(publicationAssetReferenceSchema).max(500),
    thumbnail: publicationAssetReferenceSchema.nullable(),
    metadata: publicationMetadataSchema.nullable(),
    chapterMarkers: z.array(publicationChapterMarkerSchema).max(500),
    validation: z.array(publicationValidationIssueSchema).max(200),
    manifest: publicationManifestSchema.nullable(),
    createdAt: requiredText(64),
    updatedAt: requiredText(64),
  })
  .strict();
export type PublicationPackageDto = z.infer<typeof publicationPackageDtoSchema>;

export const publicationThumbnailSelectionSchema = z
  .object({
    assetId: idSchema,
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export type PublicationThumbnailSelection = z.infer<typeof publicationThumbnailSelectionSchema>;

export const publicationExportRequestSchema = z
  .object({
    directoryName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/u, 'Export directory name is unsafe'),
  })
  .strict();
export type PublicationExportRequest = z.infer<typeof publicationExportRequestSchema>;

export const publicationExportDtoSchema = z
  .object({
    id: idSchema,
    packageId: idSchema,
    status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
    directoryName: requiredText(120),
    manifest: publicationManifestSchema.nullable(),
    error: z
      .object({ code: requiredText(120), message: requiredText(500) })
      .strict()
      .nullable(),
  })
  .strict();
export type PublicationExportDto = z.infer<typeof publicationExportDtoSchema>;
