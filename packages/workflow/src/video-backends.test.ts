import { describe, expect, it } from 'vitest';
import { videoGenerationRequestSchema } from '@studio/shared';
import { buildLtx2VideoPrompt, validateLtx2VideoPrompt } from './ltx-video.js';
import {
  allocateFramePlans,
  ltx2_19bDistilledBackend,
  selectVideoBackend,
  wan22Ti2v5bBackend,
} from './video-backends.js';

const request = videoGenerationRequestSchema.parse({
  projectId: '11111111-1111-4111-8111-111111111111',
  sceneId: 'scene-1',
  sceneRevisionId: '22222222-2222-4222-8222-222222222222',
  providerJobId: '33333333-3333-4333-8333-333333333333',
  sourceImageAssetId: '44444444-4444-4444-8444-444444444444',
  sourceImageSha256: 'a'.repeat(64),
  sourceImagePath: 'projects/p/image.png',
  motionPrompt: 'slow push in, subtle breathing, preserve face and clothing',
  negativePrompt: null,
  width: 768,
  height: 512,
  frameCount: 97,
  fps: 25,
  seed: 42,
  providerSettings: {
    backend: 'LTX2_19B_DISTILLED',
    workflowTemplate: 'ltx2-image-to-video-v1',
    ltxFps: 25,
    sampler: 'uni_pc',
    scheduler: 'simple',
    steps: 8,
    guidance: 1,
  },
});

describe('video backends', () => {
  it('keeps backend frame lattices separate and rounds to nearest legal duration', () => {
    expect(wan22Ti2v5bBackend.legalFrameCount(13)).toBe(true);
    expect(ltx2_19bDistilledBackend.legalFrameCount(13)).toBe(false);
    expect(ltx2_19bDistilledBackend.legalFrameCount(97)).toBe(true);
    expect(ltx2_19bDistilledBackend.framePlan(4_000, 25)).toMatchObject({
      frameCount: 97,
      actualDurationMs: 3_880,
    });
    expect(ltx2_19bDistilledBackend.framePlan(1, 25).frameCount).toBe(9);
    expect(ltx2_19bDistilledBackend.framePlan(99_999, 25).frameCount).toBe(1001);
  });

  it('uses explicit readiness and fallback without silent backend substitution', () => {
    expect(
      selectVideoBackend(
        'LTX2_19B_DISTILLED',
        { LTX2_19B_DISTILLED: false, WAN22_TI2V_5B: true },
        'NONE',
      ),
    ).toBeNull();
    expect(
      selectVideoBackend(
        'LTX2_19B_DISTILLED',
        { LTX2_19B_DISTILLED: false, WAN22_TI2V_5B: true },
        'WAN22_TI2V_5B',
      ),
    ).toEqual({ backend: 'WAN22_TI2V_5B', fallbackUsed: true });
  });

  it('builds a portable native LTX graph from one FPS source', () => {
    const graph = buildLtx2VideoPrompt(request, 'upload.png');
    expect(graph['1']).toMatchObject({
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'ltx-2-19b-distilled-fp8.safetensors' },
    });
    expect(graph['2']).toMatchObject({
      class_type: 'LTXAVTextEncoderLoader',
      inputs: expect.objectContaining({ text_encoder: 'gemma_3_12B_it_fp4_mixed.safetensors' }),
    });
    expect(graph['5']?.inputs.frame_rate).toBe(25);
    expect(graph['7']?.inputs.length).toBe(97);
    expect(graph['11']?.inputs.fps).toBe(25);
    expect(() => validateLtx2VideoPrompt(graph)).not.toThrow();
    const tampered = structuredClone(graph);
    delete tampered['5'];
    expect(() => validateLtx2VideoPrompt(tampered)).toThrow(/unknown or missing nodes/);
  });

  it('allocates child frame counts with one bounded parent residual', () => {
    const plans = allocateFramePlans('LTX2_19B_DISTILLED', [1_200, 1_200, 1_600], 25);
    expect(plans.every((plan) => ltx2_19bDistilledBackend.legalFrameCount(plan.frameCount))).toBe(
      true,
    );
    const total = plans.reduce((sum, plan) => sum + plan.actualDurationMs, 0);
    expect(Math.abs(total - 4_000)).toBeLessThanOrEqual(320);
  });
});
