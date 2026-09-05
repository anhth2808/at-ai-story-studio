import { describe, expect, it } from 'vitest';
import {
  ltx2_19bDistilledDefaults,
  ltxVideoFrameCountSchema,
  videoBackendSchema,
  videoGenerationRequestSchema,
  videoProviderSettingsBaseSchema,
} from './video.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('video backend contracts', () => {
  it('keeps legacy Wan requests valid and provider-neutral', () => {
    const request = videoGenerationRequestSchema.parse({
      projectId: id,
      sceneId: 'scene-1',
      sceneRevisionId: id,
      providerJobId: id,
      sourceImageAssetId: id,
      sourceImageSha256: 'a'.repeat(64),
      sourceImagePath: 'projects/project/scene.png',
      motionPrompt: 'A slow push toward the subject',
      negativePrompt: null,
      width: 768,
      height: 448,
      frameCount: 81,
      fps: 24,
      seed: 42,
      providerSettings: {},
    });
    expect(request.providerSettings).toMatchObject({
      backend: 'WAN22_TI2V_5B',
      workflowTemplate: 'image-to-video-v1',
    });
    expect(request).not.toHaveProperty('workflowGraph');
  });

  it('keeps LTX identity and frame geometry closed and portable', () => {
    expect(ltxVideoFrameCountSchema.parse(97)).toBe(97);
    expect(() => ltxVideoFrameCountSchema.parse(93)).toThrow();
    expect(videoBackendSchema.parse('LTX2_19B_DISTILLED')).toBe('LTX2_19B_DISTILLED');
    expect(() => videoBackendSchema.parse('arbitrary-backend')).toThrow();
    expect(videoProviderSettingsBaseSchema.parse({ backend: 'LTX2_19B_DISTILLED' })).toMatchObject({
      ltxCheckpoint: ltx2_19bDistilledDefaults.checkpoint,
      ltxTextEncoder: ltx2_19bDistilledDefaults.textEncoder,
      ltxFps: 25,
    });
  });
});
