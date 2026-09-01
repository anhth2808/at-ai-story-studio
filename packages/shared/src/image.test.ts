import { describe, expect, it } from 'vitest';
import {
  imageGenerationSettingsSchema,
  imageGenerationSettingsUpdateSchema,
  imageGenerationRequestSchema,
  sceneImageGenerationDtoSchema,
} from './image.js';

const settings = {
  diffusionModel: 'flux.safetensors',
  textEncoder: 'clip.safetensors',
  vaeName: 'vae.safetensors',
};

const generation = {
  projectId: '11111111-1111-4111-8111-111111111111',
  sceneId: '22222222-2222-4222-8222-222222222222',
  visualPromptPackageId: '33333333-3333-4333-8333-333333333333',
  providerJobId: '44444444-4444-4444-8444-444444444444',
  prompt: 'A quiet river at dawn',
  negativePrompt: 'blurry',
  width: 1024,
  height: 576,
  seed: 42,
  steps: 20,
  guidance: 5,
  samplerHint: 'euler',
  referenceImages: [],
  providerSettings: { ...settings },
};

describe('image contracts', () => {
  it('normalizes settings and requires a fixed seed in fixed mode', () => {
    expect(imageGenerationSettingsSchema.parse(settings)).toMatchObject({
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplate: 'text-to-image-v1',
      seedMode: 'RANDOM',
    });
    expect(() => imageGenerationSettingsSchema.parse({ ...settings, seedMode: 'FIXED' })).toThrow();
    expect(
      imageGenerationSettingsUpdateSchema.parse({
        ...settings,
        seedMode: 'FIXED',
        fixedSeed: 42,
        expectedRowVersion: 1,
      }).fixedSeed,
    ).toBe(42);
  });

  it('keeps the request provider-neutral and bounded', () => {
    expect(imageGenerationRequestSchema.parse(generation).generationInstructions).toBe('');
    expect(() => imageGenerationRequestSchema.parse({ ...generation, workflow: {} })).toThrow();
    expect(() => imageGenerationRequestSchema.parse({ ...generation, seed: -1 })).toThrow();
  });

  it('rejects unknown generation fields', () => {
    expect(() =>
      sceneImageGenerationDtoSchema.parse({
        id: generation.projectId,
        projectId: generation.projectId,
        sceneId: generation.sceneId,
        sceneRevisionId: generation.sceneId,
        visualPromptPackageId: generation.visualPromptPackageId,
        revision: 1,
        source: 'GENERATED',
        provider: 'COMFYUI',
        status: 'COMPLETED',
        freshness: 'CURRENT',
        reviewStatus: 'UNREVIEWED',
        isCurrent: true,
        requestedSeed: 42,
        actualSeed: 42,
        requestedWidth: 1024,
        requestedHeight: 576,
        actualWidth: 1024,
        actualHeight: 576,
        providerJobId: generation.projectId,
        workflowTemplate: 'text-to-image-v1',
        inputFingerprint: 'a'.repeat(64),
        assetId: null,
        assetUrl: null,
        durationMs: 1,
        errorCode: null,
        error: null,
        notes: '',
        generationInstructions: null,
        metadata: {},
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString(),
        workflow: {},
      }),
    ).toThrow();
  });
});
