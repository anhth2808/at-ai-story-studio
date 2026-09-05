import { describe, expect, it } from 'vitest';
import {
  defaultProductionProfileSettings,
  productionPlanRequestSchema,
  productionProfileCreateSchema,
  productionProfileSettingsSchema,
  productionScopeSchema,
} from './production.js';
import { publicationManifestSchema, publicationMetadataUpdateSchema } from './publication.js';

const id = '00000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);

function validAsset(exportName: string) {
  return {
    assetId: id,
    sha256: hash,
    mediaType: 'video/mp4',
    bytes: 10,
    durationMs: 1_000,
    exportName,
    url: `/api/assets/${id}`,
  };
}

describe('production contracts', () => {
  it('rejects invalid scope and profile bounds', () => {
    expect(() =>
      productionScopeSchema.parse({ type: 'CHAPTER_RANGE', startChapter: 4, endChapter: 2 }),
    ).toThrow();
    expect(() =>
      productionProfileSettingsSchema.parse({
        ...defaultProductionProfileSettings,
        imageBatchSize: 65,
      }),
    ).toThrow();
    expect(() =>
      productionProfileCreateSchema.parse({ key: 'BALANCED', settings: { unknown: true } }),
    ).toThrow();
    expect(() =>
      productionProfileSettingsSchema.parse({
        ...defaultProductionProfileSettings,
        temporalRetryLimit: 4,
      }),
    ).toThrow();
    expect(() =>
      productionProfileSettingsSchema.parse({
        ...defaultProductionProfileSettings,
        providerGraph: {},
      }),
    ).toThrow();
  });

  it('accepts a bounded plan request', () => {
    expect(
      productionPlanRequestSchema.parse({
        scope: { type: 'CHAPTER_RANGE', startChapter: 1, endChapter: 3 },
      }).scope,
    ).toEqual({ type: 'CHAPTER_RANGE', startChapter: 1, endChapter: 3 });
  });

  it('defaults production profiles to explicit bounded quality policy', () => {
    expect(defaultProductionProfileSettings).toMatchObject({
      imageCandidatePolicy: 'BALANCED',
      imageQualityGate: 'REQUIRED',
      imageAutoAcceptThreshold: 4,
      videoBackendPreference: 'WAN22_TI2V_5B',
      videoQualityGate: 'REQUIRED',
      temporalRetryLimit: 2,
      qualityFallback: 'MANUAL_REVIEW',
      strictReferenceRequirement: false,
      allowedVideoFallback: 'WAN22_TI2V_5B',
    });
  });
});

describe('publication contracts', () => {
  it('rejects unsafe manifest paths and malformed metadata updates', () => {
    const marker = { chapterId: id, chapterNumber: 1, title: 'Chapter 1', offsetMs: 0 };
    const manifest = {
      format: 'ai-story-studio-publication',
      formatVersion: 1,
      projectId: id,
      runId: id,
      packageId: id,
      packageRevision: 1,
      packageFingerprint: 'fingerprint',
      scope: { type: 'FULL_PROJECT', startChapter: null, endChapter: null },
      video: validAsset('../video.mp4'),
      subtitles: [],
      thumbnail: null,
      metadata: {
        title: 'Title',
        description: 'Description',
        shortDescription: '',
        tags: [],
        contentWarning: null,
        language: 'vi-VN',
      },
      chapterMarkers: [marker],
      validation: [],
      metrics: {},
      generatedAt: new Date().toISOString(),
    };
    expect(() => publicationManifestSchema.parse(manifest)).toThrow();
    const safeManifest = { ...manifest, video: validAsset('video.mp4') };
    expect(() =>
      publicationManifestSchema.parse({ ...safeManifest, generatedAt: 'not-a-date' }),
    ).toThrow();
    expect(() =>
      publicationManifestSchema.parse({ ...safeManifest, metrics: { apiKey: 'secret' } }),
    ).toThrow();
    expect(() =>
      publicationManifestSchema.parse({ ...safeManifest, binary: new Uint8Array([1]) }),
    ).toThrow();
    expect(() => publicationMetadataUpdateSchema.parse({})).toThrow();
  });
});
