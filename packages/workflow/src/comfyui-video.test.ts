import { describe, expect, it } from 'vitest';
import {
  IMAGE_TO_VIDEO_V1_MAPPING_VERSION,
  WAN22_DEFAULT_NEGATIVE_PROMPT,
  buildComfyUiVideoPrompt,
  validateComfyUiVideoPrompt,
} from './comfyui-video.js';
import { videoGenerationRequestSchema } from '@studio/shared';

const baseRequest = videoGenerationRequestSchema.parse({
  projectId: '11111111-1111-4111-8111-111111111111',
  sceneId: 'scene-stable-1',
  sceneRevisionId: '44444444-4444-4444-8444-444444444444',
  providerJobId: '55555555-5555-4555-8555-555555555555',
  sourceImageAssetId: '66666666-6666-4666-8666-666666666666',
  sourceImageSha256: 'a'.repeat(64),
  sourceImagePath: 'projects/p/images/scenes/s/current.png',
  motionPrompt: 'the river flows gently; the camera stays locked',
  negativePrompt: null,
  width: 832,
  height: 480,
  frameCount: 81,
  fps: 24,
  seed: 42,
  providerSettings: {
    provider: 'COMFYUI',
    baseUrl: 'http://127.0.0.1:8188',
    workflowTemplate: 'image-to-video-v1',
    diffusionModel: 'wan2.2_ti2v_5B_fp16.safetensors',
    textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    vaeName: 'wan2.2_vae.safetensors',
    sampler: 'uni_pc',
    scheduler: 'simple',
    steps: 20,
    guidance: 5,
    shift: 8,
    preset: 'BALANCED',
    connectionTimeoutMs: 5_000,
    generationTimeoutMs: 3_600_000,
  },
});

describe('buildComfyUiVideoPrompt', () => {
  it('builds and validates the approved Wan 2.2 TI2V-5B graph', () => {
    const prompt = buildComfyUiVideoPrompt(baseRequest, 'upload.png');
    expect(Object.keys(prompt).sort()).toEqual(
      ['3', '37', '38', '39', '48', '55', '56', '57', '58', '6', '7', '8'].sort(),
    );
    expect(prompt['55']).toMatchObject({
      class_type: 'Wan22ImageToVideoLatent',
      inputs: expect.objectContaining({ width: 832, height: 480, length: 81, batch_size: 1 }),
    });
    expect(prompt['56']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'upload.png' } });
    expect(prompt['7']).toMatchObject({
      class_type: 'CLIPTextEncode',
      inputs: { text: WAN22_DEFAULT_NEGATIVE_PROMPT },
    });
    expect(() => validateComfyUiVideoPrompt(prompt)).not.toThrow();
  });

  it('detects tampered graphs before submission', () => {
    const prompt = buildComfyUiVideoPrompt(baseRequest, 'upload.png');
    const tampered = structuredClone(prompt);
    delete tampered['48'];
    expect(() => validateComfyUiVideoPrompt(tampered)).toThrowError(/unknown or missing nodes/);
    const rewired = structuredClone(prompt);
    rewired['3']!.inputs.model = ['37', 0];
    expect(() => validateComfyUiVideoPrompt(rewired)).toThrowError(/link/);
  });

  it('keeps the mapping version stable for fingerprints', () => {
    expect(IMAGE_TO_VIDEO_V1_MAPPING_VERSION).toBe('image-to-video-v1-mapping-1');
  });
});
