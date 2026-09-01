import { randomInt } from 'node:crypto';
import { AppError, type ImageGenerationSettings, type ImageSeedMode } from '@studio/shared';
import { fingerprintValue } from './story-prompts.js';

export const IMAGE_WORKFLOW_TEMPLATE_VERSION = 'text-to-image-v1';
export const IMAGE_WORKFLOW_MAPPING_VERSION = 'text-to-image-v1-mapping-1';

export function imageGenerationFingerprint(input: unknown): string {
  return fingerprintValue({ version: IMAGE_WORKFLOW_MAPPING_VERSION, input });
}

export function resolveImageSeed(seedMode: ImageSeedMode, fixedSeed: number | null): number {
  if (seedMode === 'FIXED') {
    if (fixedSeed === null || !Number.isSafeInteger(fixedSeed) || fixedSeed < 0)
      throw new AppError('INVALID_INPUT', 'A valid fixed image seed is required', 400);
    return fixedSeed;
  }
  return randomInt(0, 2_147_483_647);
}

export function imageSettingsFingerprint(settings: ImageGenerationSettings): string {
  return imageGenerationFingerprint({
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    workflowTemplate: settings.workflowTemplate,
    diffusionModel: settings.diffusionModel,
    textEncoder: settings.textEncoder,
    vaeName: settings.vaeName,
    sampler: settings.sampler,
    width: settings.width,
    height: settings.height,
    steps: settings.steps,
    guidance: settings.guidance,
  });
}
