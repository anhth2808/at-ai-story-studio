import { describe, expect, it } from 'vitest';
import {
  imageGenerationFingerprint,
  imageSettingsFingerprint,
  resolveImageSeed,
} from './image-generation.js';

const settings = {
  provider: 'COMFYUI' as const,
  baseUrl: 'http://127.0.0.1:8188',
  workflowTemplate: 'text-to-image-v1' as const,
  diffusionModel: 'model.safetensors',
  textEncoder: 'encoder.safetensors',
  vaeName: 'vae.safetensors',
  sampler: 'euler',
  connectionTimeoutMs: 5000,
  generationTimeoutMs: 60000,
  width: 1024,
  height: 576,
  steps: 20,
  guidance: 5,
  seedMode: 'FIXED' as const,
  fixedSeed: 42,
};

describe('image generation helpers', () => {
  it('fingerprints output-affecting inputs deterministically', () => {
    expect(imageGenerationFingerprint({ prompt: 'river', seed: 42 })).toBe(
      imageGenerationFingerprint({ seed: 42, prompt: 'river' }),
    );
    expect(imageGenerationFingerprint({ prompt: 'river', seed: 43 })).not.toBe(
      imageGenerationFingerprint({ prompt: 'river', seed: 42 }),
    );
    expect(imageSettingsFingerprint(settings)).not.toBe(
      imageSettingsFingerprint({ ...settings, guidance: 6 }),
    );
  });

  it('keeps fixed seeds and creates concrete random seeds', () => {
    expect(resolveImageSeed('FIXED', 42)).toBe(42);
    const seed = resolveImageSeed('RANDOM', null);
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('rejects missing or unsafe fixed seeds', () => {
    expect(() => resolveImageSeed('FIXED', null)).toThrow();
    expect(() => resolveImageSeed('FIXED', Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
