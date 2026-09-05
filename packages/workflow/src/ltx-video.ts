import { ltxVideoFrameCountSchema, videoGenerationRequestSchema } from '@studio/shared';
import type { VideoGenerationRequest } from '@studio/shared';
import { VideoProviderError, type ComfyUiVideoPrompt } from './comfyui-video.js';

export const LTX2_19B_MAPPING_VERSION = 'ltx2-19b-distilled-i2v-mapping-1';
export const LTX2_REQUIRED_NODE_CLASSES = Object.freeze([
  'CheckpointLoaderSimple',
  'LTXAVTextEncoderLoader',
  'CLIPTextEncode',
  'LTXVConditioning',
  'LoadImage',
  'LTXVImgToVideo',
  'ModelSamplingLTXV',
  'KSampler',
  'VAEDecode',
  'CreateVideo',
  'SaveVideo',
]);

const ids = {
  checkpoint: '1',
  textEncoder: '2',
  positive: '3',
  negative: '4',
  conditioning: '5',
  image: '6',
  latent: '7',
  model: '8',
  sampler: '9',
  decode: '10',
  video: '11',
  save: '12',
} as const;

export function buildLtx2VideoPrompt(
  requestInput: VideoGenerationRequest,
  uploadedImageName: string,
): ComfyUiVideoPrompt {
  const request = videoGenerationRequestSchema.parse(requestInput);
  if (request.providerSettings.backend !== 'LTX2_19B_DISTILLED')
    throw new VideoProviderError(
      'LTX_WORKFLOW_INVALID',
      'LTX graph requires the LTX backend',
      false,
    );
  ltxVideoFrameCountSchema.parse(request.frameCount);
  if (request.fps !== request.providerSettings.ltxFps)
    throw new VideoProviderError(
      'FRAME_GEOMETRY_INVALID',
      'LTX request FPS must match its descriptor',
      false,
    );
  const graph: ComfyUiVideoPrompt = {
    [ids.checkpoint]: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: request.providerSettings.ltxCheckpoint },
    },
    [ids.textEncoder]: {
      class_type: 'LTXAVTextEncoderLoader',
      inputs: {
        text_encoder: request.providerSettings.ltxTextEncoder,
        ckpt_name: request.providerSettings.ltxCheckpoint,
        device: 'default',
      },
    },
    [ids.positive]: {
      class_type: 'CLIPTextEncode',
      inputs: { text: request.motionPrompt, clip: [ids.textEncoder, 0] },
    },
    [ids.negative]: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: request.negativePrompt ?? 'text, watermark, distorted face, extra limbs, flicker',
        clip: [ids.textEncoder, 0],
      },
    },
    [ids.conditioning]: {
      class_type: 'LTXVConditioning',
      inputs: {
        positive: [ids.positive, 0],
        negative: [ids.negative, 0],
        frame_rate: request.providerSettings.ltxFps,
      },
    },
    [ids.image]: { class_type: 'LoadImage', inputs: { image: uploadedImageName } },
    [ids.latent]: {
      class_type: 'LTXVImgToVideo',
      inputs: {
        positive: [ids.conditioning, 0],
        negative: [ids.conditioning, 1],
        vae: [ids.checkpoint, 2],
        image: [ids.image, 0],
        width: request.width,
        height: request.height,
        length: request.frameCount,
        batch_size: 1,
        strength: 1,
      },
    },
    [ids.model]: {
      class_type: 'ModelSamplingLTXV',
      inputs: {
        model: [ids.checkpoint, 0],
        latent: [ids.latent, 2],
        max_shift: 2.05,
        base_shift: 0.95,
      },
    },
    [ids.sampler]: {
      class_type: 'KSampler',
      inputs: {
        model: [ids.model, 0],
        seed: request.seed,
        steps: request.providerSettings.steps,
        cfg: request.providerSettings.guidance,
        sampler_name: request.providerSettings.sampler,
        scheduler: request.providerSettings.scheduler,
        positive: [ids.latent, 0],
        negative: [ids.latent, 1],
        latent_image: [ids.latent, 2],
        denoise: 1,
      },
    },
    [ids.decode]: {
      class_type: 'VAEDecode',
      inputs: { samples: [ids.sampler, 0], vae: [ids.checkpoint, 2] },
    },
    [ids.video]: {
      class_type: 'CreateVideo',
      inputs: { images: [ids.decode, 0], fps: request.providerSettings.ltxFps },
    },
    [ids.save]: {
      class_type: 'SaveVideo',
      inputs: {
        video: [ids.video, 0],
        filename_prefix: 'studio/motion-ltx2',
        format: 'auto',
        codec: 'auto',
      },
    },
  };
  validateLtx2VideoPrompt(graph);
  return graph;
}

export function validateLtx2VideoPrompt(graph: ComfyUiVideoPrompt): void {
  const classes = Object.values(graph).map((node) => node.class_type);
  if (
    classes.length !== 12 ||
    LTX2_REQUIRED_NODE_CLASSES.some((classType) => !classes.includes(classType))
  )
    throw new VideoProviderError(
      'LTX_WORKFLOW_INVALID',
      'LTX workflow contains unknown or missing nodes',
      false,
    );
  for (const node of Object.values(graph)) {
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && !graph[value[0]])
        throw new VideoProviderError(
          'LTX_WORKFLOW_INVALID',
          'LTX workflow contains a broken link',
          false,
        );
    }
  }
}
