import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  imageReadinessSchema,
  imageProviderResultSchema,
  type ImageConditioningReadiness,
  type ImageGenerationErrorCode,
  type ImageGenerationRequest,
  type ImageProviderResult,
  type ImageProviderSettings,
  type ImageReadiness,
  type ImageWorkflowTemplate,
} from '@studio/shared';
import { safeWorkspacePath } from '@studio/media';

export type ImageProviderFailure = {
  code: ImageGenerationErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: string;
};

export class ImageProviderError extends Error implements ImageProviderFailure {
  constructor(
    public readonly code: ImageGenerationErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly diagnostics?: string,
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}

export type ImageReadinessInput = ImageProviderSettings & {
  /** Project conditioning mode; the provider only reports diagnostics for it. */
  conditioningMode?: 'TEXT_ONLY' | 'REFERENCE_CONDITIONED';
};

export type ImageProvider = {
  generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageProviderResult>;
  readiness(settings: ImageReadinessInput, signal?: AbortSignal): Promise<ImageReadiness>;
  cancel(
    providerJobId: string,
    settings: ImageProviderSettings,
    signal?: AbortSignal,
  ): Promise<void>;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

type ComfyNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};
export type ComfyUiPrompt = Record<string, ComfyNode>;

export const TEXT_TO_IMAGE_V1_NODE_IDS = Object.freeze({
  unet: '1',
  clip: '2',
  vae: '3',
  positive: '4',
  negative: '5',
  noise: '6',
  sampler: '7',
  scheduler: '8',
  latent: '9',
  guider: '10',
  samplerAdvanced: '11',
  decode: '12',
  save: '13',
});

export const REFERENCE_CHARACTER_V1_MAX_REFERENCES = 4;
export const TEXT_TO_IMAGE_V1_MAPPING_VERSION = 'text-to-image-v1-mapping-1';
export const REFERENCE_CHARACTER_V1_MAPPING_VERSION = 'reference-character-v1-mapping-1';

const BASE_NODE_IDS = TEXT_TO_IMAGE_V1_NODE_IDS;

// Verified against ComfyUI /object_info on the tested server (0.33.1):
// LoadImage{image}, ImageScaleToTotalPixels{image,upscale_method,megapixels,resolution_steps},
// VAEEncode{pixels,vae}, ReferenceLatent{conditioning,latent?}.
const referenceNodeIds = (index: number) => ({
  loadImage: String(20 + index),
  scale: String(30 + index),
  encode: String(40 + index),
  refPositive: String(50 + index),
  refNegative: String(60 + index),
});

type GraphSpec = {
  classes: Record<string, string>;
  requiredInputs: Record<string, string[]>;
  links: Array<[target: string, input: string, source: string]>;
};

function baseGraphSpec(): GraphSpec {
  const classes: Record<string, string> = {
    [BASE_NODE_IDS.unet]: 'UNETLoader',
    [BASE_NODE_IDS.clip]: 'CLIPLoader',
    [BASE_NODE_IDS.vae]: 'VAELoader',
    [BASE_NODE_IDS.positive]: 'CLIPTextEncode',
    [BASE_NODE_IDS.negative]: 'CLIPTextEncode',
    [BASE_NODE_IDS.noise]: 'RandomNoise',
    [BASE_NODE_IDS.sampler]: 'KSamplerSelect',
    [BASE_NODE_IDS.scheduler]: 'Flux2Scheduler',
    [BASE_NODE_IDS.latent]: 'EmptyFlux2LatentImage',
    [BASE_NODE_IDS.guider]: 'CFGGuider',
    [BASE_NODE_IDS.samplerAdvanced]: 'SamplerCustomAdvanced',
    [BASE_NODE_IDS.decode]: 'VAEDecode',
    [BASE_NODE_IDS.save]: 'SaveImage',
  };
  const requiredInputs: Record<string, string[]> = {
    UNETLoader: ['unet_name'],
    CLIPLoader: ['clip_name', 'type', 'device'],
    VAELoader: ['vae_name'],
    CLIPTextEncode: ['text', 'clip'],
    RandomNoise: ['noise_seed'],
    KSamplerSelect: ['sampler_name'],
    Flux2Scheduler: ['steps', 'width', 'height'],
    EmptyFlux2LatentImage: ['width', 'height', 'batch_size'],
    CFGGuider: ['model', 'positive', 'negative', 'cfg'],
    SamplerCustomAdvanced: ['noise', 'guider', 'sampler', 'sigmas', 'latent_image'],
    VAEDecode: ['samples', 'vae'],
    SaveImage: ['images', 'filename_prefix'],
  };
  const links: Array<[string, string, string]> = [
    [BASE_NODE_IDS.positive, 'clip', BASE_NODE_IDS.clip],
    [BASE_NODE_IDS.negative, 'clip', BASE_NODE_IDS.clip],
    [BASE_NODE_IDS.guider, 'model', BASE_NODE_IDS.unet],
    [BASE_NODE_IDS.guider, 'positive', BASE_NODE_IDS.positive],
    [BASE_NODE_IDS.guider, 'negative', BASE_NODE_IDS.negative],
    [BASE_NODE_IDS.samplerAdvanced, 'noise', BASE_NODE_IDS.noise],
    [BASE_NODE_IDS.samplerAdvanced, 'guider', BASE_NODE_IDS.guider],
    [BASE_NODE_IDS.samplerAdvanced, 'sampler', BASE_NODE_IDS.sampler],
    [BASE_NODE_IDS.samplerAdvanced, 'sigmas', BASE_NODE_IDS.scheduler],
    [BASE_NODE_IDS.samplerAdvanced, 'latent_image', BASE_NODE_IDS.latent],
    [BASE_NODE_IDS.decode, 'samples', BASE_NODE_IDS.samplerAdvanced],
    [BASE_NODE_IDS.decode, 'vae', BASE_NODE_IDS.vae],
    [BASE_NODE_IDS.save, 'images', BASE_NODE_IDS.decode],
  ];
  return { classes, requiredInputs, links };
}

// Shape follows the official ComfyUI klein-base reference template: the same
// VAEEncode reference latent feeds both the positive and the negative
// ReferenceLatent chain, and the last chain output feeds the CFGGuider.
function referenceGraphSpec(referenceCount: number): GraphSpec {
  const spec = baseGraphSpec();
  const classes = { ...spec.classes };
  const requiredInputs = { ...spec.requiredInputs };
  const links = spec.links
    .filter(
      ([target, input]) =>
        !(target === BASE_NODE_IDS.guider && (input === 'positive' || input === 'negative')),
    )
    .map(([target, input, source]) => [target, input, source] as [string, string, string]);
  let previousPositive: string = BASE_NODE_IDS.positive;
  let previousNegative: string = BASE_NODE_IDS.negative;
  for (let index = 0; index < referenceCount; index += 1) {
    const ids = referenceNodeIds(index);
    classes[ids.loadImage] = 'LoadImage';
    requiredInputs.LoadImage = ['image'];
    classes[ids.scale] = 'ImageScaleToTotalPixels';
    requiredInputs.ImageScaleToTotalPixels = [
      'image',
      'upscale_method',
      'megapixels',
      'resolution_steps',
    ];
    classes[ids.encode] = 'VAEEncode';
    requiredInputs.VAEEncode = ['pixels', 'vae'];
    classes[ids.refPositive] = 'ReferenceLatent';
    classes[ids.refNegative] = 'ReferenceLatent';
    requiredInputs.ReferenceLatent = ['conditioning'];
    links.push(
      [ids.scale, 'image', ids.loadImage],
      [ids.encode, 'pixels', ids.scale],
      [ids.encode, 'vae', BASE_NODE_IDS.vae],
      [ids.refPositive, 'conditioning', previousPositive],
      [ids.refNegative, 'conditioning', previousNegative],
    );
    previousPositive = ids.refPositive;
    previousNegative = ids.refNegative;
  }
  links.push(
    [BASE_NODE_IDS.guider, 'positive', previousPositive],
    [BASE_NODE_IDS.guider, 'negative', previousNegative],
  );
  return { classes, requiredInputs, links };
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const normalizeDimension = (value: number): number =>
  Math.max(16, Math.min(16_384, Math.round(value / 16) * 16));
const sleepDefault: Sleep = async (milliseconds) => {
  await delay(milliseconds);
};

function baseGraph(request: ImageGenerationRequest): ComfyUiPrompt {
  const width = normalizeDimension(request.width);
  const height = normalizeDimension(request.height);
  const prompt = request.generationInstructions
    ? `${request.prompt}\n\nGeneration instructions: ${request.generationInstructions}`
    : request.prompt;
  const ids = BASE_NODE_IDS;
  return {
    [ids.unet]: {
      class_type: 'UNETLoader',
      inputs: { unet_name: request.providerSettings.diffusionModel, weight_dtype: 'default' },
    },
    [ids.clip]: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: request.providerSettings.textEncoder, type: 'flux2', device: 'default' },
    },
    [ids.vae]: {
      class_type: 'VAELoader',
      inputs: { vae_name: request.providerSettings.vaeName },
    },
    [ids.positive]: {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: [ids.clip, 0] },
    },
    [ids.negative]: {
      class_type: 'CLIPTextEncode',
      inputs: { text: request.negativePrompt ?? '', clip: [ids.clip, 0] },
    },
    [ids.noise]: {
      class_type: 'RandomNoise',
      inputs: { noise_seed: request.seed },
    },
    [ids.sampler]: {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: request.samplerHint },
    },
    [ids.scheduler]: {
      class_type: 'Flux2Scheduler',
      inputs: { steps: request.steps, width, height },
    },
    [ids.latent]: {
      class_type: 'EmptyFlux2LatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    [ids.guider]: {
      class_type: 'CFGGuider',
      inputs: {
        model: [ids.unet, 0],
        positive: [ids.positive, 0],
        negative: [ids.negative, 0],
        cfg: request.guidance,
      },
    },
    [ids.samplerAdvanced]: {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: [ids.noise, 0],
        guider: [ids.guider, 0],
        sampler: [ids.sampler, 0],
        sigmas: [ids.scheduler, 0],
        latent_image: [ids.latent, 0],
      },
    },
    [ids.decode]: {
      class_type: 'VAEDecode',
      inputs: {
        samples: [ids.samplerAdvanced, 0],
        vae: [ids.vae, 0],
      },
    },
    [ids.save]: {
      class_type: 'SaveImage',
      inputs: { images: [ids.decode, 0], filename_prefix: 'studio/scenes' },
    },
  };
}

function referenceGraph(request: ImageGenerationRequest, referenceFiles: string[]): ComfyUiPrompt {
  const graph = baseGraph(request);
  const ids = BASE_NODE_IDS;
  let previousPositive: string = ids.positive;
  let previousNegative: string = ids.negative;
  referenceFiles.forEach((filename, index) => {
    const refs = referenceNodeIds(index);
    graph[refs.loadImage] = { class_type: 'LoadImage', inputs: { image: filename } };
    graph[refs.scale] = {
      class_type: 'ImageScaleToTotalPixels',
      inputs: {
        image: [refs.loadImage, 0],
        upscale_method: 'lanczos',
        megapixels: 1.0,
        resolution_steps: 1,
      },
    };
    graph[refs.encode] = {
      class_type: 'VAEEncode',
      inputs: { pixels: [refs.scale, 0], vae: [ids.vae, 0] },
    };
    graph[refs.refPositive] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: [previousPositive, 0], latent: [refs.encode, 0] },
    };
    graph[refs.refNegative] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: [previousNegative, 0], latent: [refs.encode, 0] },
    };
    previousPositive = refs.refPositive;
    previousNegative = refs.refNegative;
  });
  graph[ids.guider]!.inputs.positive = [previousPositive, 0];
  graph[ids.guider]!.inputs.negative = [previousNegative, 0];
  return graph;
}

export function buildComfyUiPrompt(
  request: ImageGenerationRequest,
  referenceFiles?: string[],
): ComfyUiPrompt {
  if (request.providerSettings.workflowTemplate === 'reference-character-v1') {
    if (
      !referenceFiles ||
      referenceFiles.length !== request.conditioning.characters.length ||
      !request.conditioning.characters.length
    )
      throw new ImageProviderError(
        'WORKFLOW_INVALID',
        'Reference-conditioned generation requires one uploaded reference file per conditioned character',
        false,
      );
    const graph = referenceGraph(request, referenceFiles);
    validateComfyUiPrompt(graph, 'reference-character-v1');
    return graph;
  }
  const graph = baseGraph(request);
  validateComfyUiPrompt(graph, 'text-to-image-v1');
  return graph;
}

export function validateComfyUiPrompt(
  prompt: ComfyUiPrompt,
  template: ImageWorkflowTemplate = 'text-to-image-v1',
): void {
  const spec =
    template === 'reference-character-v1'
      ? referenceGraphSpec(Object.keys(prompt).length ? countReferenceNodes(prompt) : 0)
      : baseGraphSpec();
  const keys = Object.keys(prompt).sort();
  const expected = Object.keys(spec.classes).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]))
    throw new ImageProviderError(
      'WORKFLOW_INVALID',
      'ComfyUI workflow contains unknown or missing nodes',
      false,
    );
  for (const [id, classType] of Object.entries(spec.classes)) {
    const node = prompt[id];
    const required = spec.requiredInputs[classType] ?? [];
    if (
      !node ||
      node.class_type !== classType ||
      !node.inputs ||
      typeof node.inputs !== 'object' ||
      required.some((name) => !(name in node.inputs))
    )
      throw new ImageProviderError('WORKFLOW_INVALID', `ComfyUI node ${id} is invalid`, false);
  }
  for (const [target, input, source] of spec.links) {
    const value = prompt[target]?.inputs[input];
    if (!Array.isArray(value) || value[0] !== source || value[1] !== 0)
      throw new ImageProviderError(
        'WORKFLOW_INVALID',
        `ComfyUI link ${target}.${input} is invalid`,
        false,
      );
  }
}

function countReferenceNodes(prompt: ComfyUiPrompt): number {
  return Object.values(prompt).filter((node) => node.class_type === 'ReferenceLatent').length / 2;
}

export class ComfyUiImageProvider implements ImageProvider {
  private supportsTargetedCancellation = false;

  constructor(
    private readonly outputRoot: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: Sleep = sleepDefault,
    private readonly clock: () => number = Date.now,
    private readonly workspaceRoot?: string,
  ) {}

  private resolveWorkspaceRoot(): string {
    return this.workspaceRoot ?? resolve(this.outputRoot ?? '.', '..');
  }

  async readiness(input: ImageReadinessInput, signal?: AbortSignal): Promise<ImageReadiness> {
    const settings: ImageProviderSettings = input;
    const conditioningRequested = input.conditioningMode === 'REFERENCE_CONDITIONED';
    const checkedAt = new Date(this.clock()).toISOString();
    if (!settings.diffusionModel || !settings.textEncoder || !settings.vaeName)
      return imageReadinessSchema.parse({
        provider: 'COMFYUI',
        status: 'NOT_CONFIGURED',
        message: 'ComfyUI model components are not configured',
        checkedAt,
        details: { required: ['diffusionModel', 'textEncoder', 'vaeName'] },
      });
    try {
      const system = await this.json(
        settings,
        '/system_stats',
        settings.connectionTimeoutMs,
        signal,
      );
      if (!system || typeof system !== 'object')
        return this.incompatible(checkedAt, 'ComfyUI system_stats is invalid');
      const objectInfo = await this.loadObjectInfo(settings, signal);
      const baseSpec = baseGraphSpec();
      const missingNodes = this.missingNodes(objectInfo, Object.values(baseSpec.classes));
      if (missingNodes.length)
        return imageReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'INVALID_WORKFLOW',
          message: 'ComfyUI does not expose the required native nodes',
          checkedAt,
          details: { missingNodes },
        });
      const conditioningReadiness = this.conditioningReadiness(objectInfo);
      if (conditioningRequested && conditioningReadiness.status !== 'CONDITIONING_READY')
        return imageReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'INVALID_WORKFLOW',
          message: 'ComfyUI cannot run the reference-conditioned workflow',
          checkedAt,
          details: { conditioning: conditioningReadiness },
        });
      const [diffusionModels, textEncoders, vaes] = await Promise.all([
        this.array(settings, '/models/diffusion_models', settings.connectionTimeoutMs, signal),
        this.array(settings, '/models/text_encoders', settings.connectionTimeoutMs, signal),
        this.array(settings, '/models/vae', settings.connectionTimeoutMs, signal),
      ]);
      const modelChecks = [
        ['diffusionModel', settings.diffusionModel, diffusionModels],
        ['textEncoder', settings.textEncoder, textEncoders],
        ['vaeName', settings.vaeName, vaes],
      ] as const;
      const missingModels = modelChecks
        .filter(([, expected, available]) => !available.includes(expected))
        .map(([name, expected]) => `${name}:${expected}`);
      if (missingModels.length)
        return imageReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'ERROR',
          message: 'Configured ComfyUI model is missing',
          checkedAt,
          details: { missingModels },
        });
      const samplerChoices = this.samplerChoices(objectInfo);
      if (samplerChoices.length && !samplerChoices.includes(settings.sampler))
        return imageReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'INVALID_WORKFLOW',
          message: 'Configured sampler is not supported by ComfyUI',
          checkedAt,
          details: { sampler: settings.sampler, choices: samplerChoices },
        });
      this.supportsTargetedCancellation = await this.hasTargetedCancellation(settings, signal);
      return imageReadinessSchema.parse({
        provider: 'COMFYUI',
        status: 'READY',
        message: conditioningRequested
          ? 'ComfyUI is ready for text-to-image and reference-conditioned generation'
          : 'ComfyUI is ready for native text-to-image generation',
        checkedAt,
        supportsCancellation: this.supportsTargetedCancellation,
        details: {
          systemKeys: Object.keys(system),
          modelCounts: {
            diffusion: diffusionModels.length,
            textEncoder: textEncoders.length,
            vae: vaes.length,
          },
          samplerChoices,
          conditioning: conditioningReadiness,
          advancedControl: {
            status: 'NOT_ADOPTED',
            technique: null,
            reasonCode: 'NO_COMPATIBLE_CONTROL_MODEL',
            message:
              'No ControlNet-compatible model for FLUX.2 Klein is installed; candidate review and feedback regeneration remain available',
          },
        },
      });
    } catch (error) {
      if (error instanceof ImageProviderError) {
        const status =
          error.code === 'WORKFLOW_INVALID'
            ? 'INVALID_WORKFLOW'
            : error.code === 'CONFIGURATION_ERROR'
              ? 'INCOMPATIBLE_API'
              : 'UNREACHABLE';
        return imageReadinessSchema.parse({
          provider: 'COMFYUI',
          status,
          message: error.message,
          checkedAt,
          details: error.diagnostics ? { diagnostics: error.diagnostics } : {},
        });
      }
      return imageReadinessSchema.parse({
        provider: 'COMFYUI',
        status: 'UNREACHABLE',
        message: error instanceof Error ? error.message.slice(0, 1_000) : 'ComfyUI is unreachable',
        checkedAt,
      });
    }
  }

  private conditioningReadiness(objectInfo: Record<string, unknown>): {
    status: ImageConditioningReadiness;
    missingNodes: string[];
  } {
    const required = ['LoadImage', 'ImageScaleToTotalPixels', 'VAEEncode', 'ReferenceLatent'];
    const missingNodes = required.filter(
      (classType) => !objectInfo[classType] || typeof objectInfo[classType] !== 'object',
    );
    if (missingNodes.length) return { status: 'REFERENCE_NODE_MISSING', missingNodes };
    return { status: 'CONDITIONING_READY', missingNodes: [] };
  }

  async generate(
    request: ImageGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ImageProviderResult> {
    const started = this.clock();
    const readiness = await this.readiness(request.providerSettings, signal);
    if (readiness.status !== 'READY') throw readinessError(readiness);
    const referenceFiles =
      request.providerSettings.workflowTemplate === 'reference-character-v1'
        ? await this.uploadReferences(request, signal)
        : undefined;
    const prompt =
      referenceFiles === undefined
        ? buildComfyUiPrompt(request)
        : buildComfyUiPrompt(request, referenceFiles);
    const history = await this.history(request.providerSettings, request.providerJobId, signal);
    let record = history;
    if (!record) {
      const queued = await this.queueContains(
        request.providerSettings,
        request.providerJobId,
        signal,
      );
      if (!queued)
        await this.submit(request.providerSettings, request.providerJobId, prompt, signal);
    }
    const deadline = this.clock() + request.providerSettings.generationTimeoutMs;
    while (!record) {
      if (signal?.aborted)
        throw new ImageProviderError('CANCELLED', 'Image generation cancelled', false);
      if (this.clock() >= deadline)
        throw new ImageProviderError('TIMEOUT', 'ComfyUI image generation timed out', true);
      record = await this.history(request.providerSettings, request.providerJobId, signal);
      if (record) break;
      await this.sleep(1_000);
    }
    const output = this.completedOutput(record, request.providerJobId);
    const images = await this.downloadImages(
      request.providerSettings,
      request.providerJobId,
      output,
      signal,
    );
    const conditioned = referenceFiles !== undefined;
    const result = imageProviderResultSchema.parse({
      provider: 'COMFYUI',
      providerJobId: request.providerJobId,
      seed: request.seed,
      width: normalizeDimension(request.width),
      height: normalizeDimension(request.height),
      durationMs: Math.max(0, this.clock() - started),
      images,
      warnings: !conditioned && request.referenceImages.length ? ['REFERENCE_IMAGES_UNUSED'] : [],
      metadata: {
        workflowTemplate: request.providerSettings.workflowTemplate,
        mappingVersion:
          request.providerSettings.workflowTemplate === 'reference-character-v1'
            ? REFERENCE_CHARACTER_V1_MAPPING_VERSION
            : TEXT_TO_IMAGE_V1_MAPPING_VERSION,
        conditioning: {
          mode: request.conditioning.mode,
          characters: request.conditioning.characters.map((character) => ({
            characterId: character.characterId,
            referenceAssetId: character.referenceAssetId,
          })),
        },
      },
    });
    return result;
  }

  // Streams the reference bytes through a multipart body without buffering the
  // whole file; the generated internal name is only a form value, and the
  // provider-returned name is what the workflow references.
  private async uploadReferences(
    request: ImageGenerationRequest,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const uploaded: string[] = [];
    for (const character of request.conditioning.characters) {
      const absolute = safeWorkspacePath(this.resolveWorkspaceRoot(), character.referencePath);
      const info = await stat(absolute).catch(() => null);
      if (!info || !info.isFile())
        throw new ImageProviderError(
          'REFERENCE_UPLOAD_FAILED',
          `Reference image is unavailable for character ${character.characterId}`,
          true,
        );
      const formName = `${randomUUID()}.png`;
      const boundary = `studio-${randomUUID()}`;
      const head = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="image"; filename="${formName}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const fileStream = createReadStream(absolute);
      const response = await this.raw(
        request.providerSettings,
        '/upload/image',
        {
          method: 'POST',
          headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'content-length': String(head.length + info.size + tail.length),
          },
          // undici requires duplex for streaming request bodies.
          duplex: 'half',
          body: (async function* () {
            yield head;
            for await (const chunk of fileStream) yield chunk as Buffer;
            yield tail;
          })(),
        } as unknown as RequestInit,
        request.providerSettings.connectionTimeoutMs,
        signal,
      );
      if (!response.ok)
        throw new ImageProviderError(
          'REFERENCE_UPLOAD_FAILED',
          `ComfyUI rejected the reference upload for character ${character.characterId}`,
          response.status >= 500,
          `HTTP ${response.status}`,
        );
      const payload = await this.responseJson(response);
      const name = (payload as Record<string, unknown> | null)?.name;
      if (typeof name !== 'string' || !name || name.length > 300)
        throw new ImageProviderError(
          'REFERENCE_UPLOAD_FAILED',
          'ComfyUI returned an invalid reference upload response',
          false,
        );
      uploaded.push(name);
    }
    return uploaded;
  }

  async cancel(
    providerJobId: string,
    settings: ImageProviderSettings,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.supportsTargetedCancellation) {
      const response = await this.raw(
        settings,
        `/api/jobs/${encodeURIComponent(providerJobId)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
        settings.connectionTimeoutMs,
        signal,
      );
      if (response.ok || response.status === 404) return;
      if (response.status !== 405)
        throw new ImageProviderError('CANCELLED', 'ComfyUI cancellation failed', true);
      this.supportsTargetedCancellation = false;
    }
    const queue = await this.json(settings, '/queue', settings.connectionTimeoutMs, signal);
    const pending = this.queueIds(queue, 'queue_pending').includes(providerJobId);
    const running = this.queueIds(queue, 'queue_running').includes(providerJobId);
    if (pending) {
      const response = await this.raw(
        settings,
        '/queue',
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ delete: [providerJobId] }),
        },
        settings.connectionTimeoutMs,
        signal,
      );
      if (!response.ok)
        throw new ImageProviderError('CANCELLED', 'ComfyUI queue cancellation failed', true);
      return;
    }
    if (running)
      throw new ImageProviderError(
        'CONFIGURATION_ERROR',
        'ComfyUI cannot safely cancel a running job on this server',
        false,
      );
  }

  private async submit(
    settings: ImageProviderSettings,
    providerJobId: string,
    prompt: ComfyUiPrompt,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.raw(
      settings,
      '/prompt',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: providerJobId, prompt_id: providerJobId }),
      },
      settings.connectionTimeoutMs,
      signal,
    );
    const payload = await this.responseJson(response);
    if (!response.ok) {
      throw new ImageProviderError(
        'SUBMISSION_FAILED',
        'ComfyUI rejected the image workflow',
        response.status >= 500,
        `HTTP ${response.status}`,
      );
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as Record<string, unknown>).prompt_id !== providerJobId
    )
      throw new ImageProviderError(
        'SUBMISSION_FAILED',
        'ComfyUI did not preserve the provider job ID',
        false,
      );
  }

  private async history(
    settings: ImageProviderSettings,
    providerJobId: string,
    signal?: AbortSignal,
  ): Promise<ComfyHistoryRecord | null> {
    const response = await this.raw(
      settings,
      `/history/${encodeURIComponent(providerJobId)}`,
      {},
      settings.connectionTimeoutMs,
      signal,
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new ImageProviderError(
        'PROVIDER_UNAVAILABLE',
        'ComfyUI history request failed',
        response.status >= 500,
      );
    const payload = await this.responseJson(response);
    if (!payload || typeof payload !== 'object')
      throw new ImageProviderError('OUTCOME_UNKNOWN', 'ComfyUI history response is invalid', false);
    const value = (payload as Record<string, unknown>)[providerJobId];
    if (!value || typeof value !== 'object') return null;
    const record = value as ComfyHistoryRecord;
    const status = record.status;
    const statusValue =
      status && typeof status.status_str === 'string' ? status.status_str.toLowerCase() : '';
    if (
      status?.completed === true ||
      ['success', 'completed', 'error', 'failed'].includes(statusValue)
    )
      return record;
    return null;
  }

  private completedOutput(record: ComfyHistoryRecord, providerJobId: string): ComfyOutputImage[] {
    const status = record.status;
    const statusValue =
      status && typeof status.status_str === 'string' ? status.status_str.toLowerCase() : '';
    if (statusValue && !['success', 'completed'].includes(statusValue))
      throw new ImageProviderError('GENERATION_FAILED', `ComfyUI generation ${statusValue}`, false);
    const output = record.outputs?.[TEXT_TO_IMAGE_V1_NODE_IDS.save];
    const images =
      output &&
      typeof output === 'object' &&
      Array.isArray((output as Record<string, unknown>).images)
        ? ((output as Record<string, unknown>).images as ComfyOutputImage[])
        : [];
    if (!images.length)
      throw new ImageProviderError(
        'OUTPUT_MISSING',
        `ComfyUI returned no images for ${providerJobId}`,
        false,
      );
    return images.slice(0, 8);
  }

  private async downloadImages(
    settings: ImageProviderSettings,
    providerJobId: string,
    outputs: ComfyOutputImage[],
    signal?: AbortSignal,
  ): Promise<ImageProviderResult['images']> {
    const directory = join(resolve(this.outputRoot), `comfyui-${providerJobId}`);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const images: ImageProviderResult['images'] = [];
    try {
      for (const [index, output] of outputs.entries()) {
        if (!output || typeof output.filename !== 'string' || output.filename.length > 300)
          throw new ImageProviderError(
            'OUTPUT_INVALID',
            'ComfyUI returned an invalid image filename',
            false,
          );
        const extension = extname(output.filename).toLowerCase();
        if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension))
          throw new ImageProviderError(
            'OUTPUT_INVALID',
            'ComfyUI returned an unsupported image format',
            false,
          );
        const response = await this.raw(
          settings,
          `/view?${new URLSearchParams({ filename: output.filename, subfolder: typeof output.subfolder === 'string' ? output.subfolder : '', type: typeof output.type === 'string' ? output.type : 'output' }).toString()}`,
          {},
          settings.connectionTimeoutMs,
          signal,
        );
        if (!response.ok || !response.body)
          throw new ImageProviderError(
            'DOWNLOAD_FAILED',
            'ComfyUI image download failed',
            response.status >= 500,
          );
        const filename = join(directory, `${index}${extension}`);
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filename));
        images.push({
          mediaType:
            extension === '.png'
              ? 'image/png'
              : extension === '.webp'
                ? 'image/webp'
                : 'image/jpeg',
          stagingPath: filename,
          width: 16,
          height: 16,
        });
      }
      return images;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      if (error instanceof ImageProviderError) throw error;
      throw new ImageProviderError(
        'DOWNLOAD_FAILED',
        error instanceof Error ? error.message : 'ComfyUI image download failed',
        true,
      );
    }
  }

  private async queueContains(
    settings: ImageProviderSettings,
    providerJobId: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const queue = await this.json(settings, '/queue', settings.connectionTimeoutMs, signal);
    return (
      this.queueIds(queue, 'queue_pending').includes(providerJobId) ||
      this.queueIds(queue, 'queue_running').includes(providerJobId)
    );
  }

  private queueIds(payload: unknown, key: 'queue_pending' | 'queue_running'): string[] {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as Record<string, unknown>)[key])
    )
      return [];
    return ((payload as Record<string, unknown>)[key] as unknown[]).flatMap((entry) => {
      if (Array.isArray(entry) && typeof entry[1] === 'string') return [entry[1]];
      if (!entry || typeof entry !== 'object') return [];
      const promptId = (entry as Record<string, unknown>).prompt_id;
      return typeof promptId === 'string' ? [promptId] : [];
    });
  }

  private async loadObjectInfo(
    settings: ImageProviderSettings,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const payload = await this.json(settings, '/object_info', settings.connectionTimeoutMs, signal);
    if (!payload || typeof payload !== 'object') return {};
    const objectInfo = { ...(payload as Record<string, unknown>) };
    const expectedClasses = new Set([
      ...Object.values(baseGraphSpec().classes),
      'LoadImage',
      'ImageScaleToTotalPixels',
      'VAEEncode',
      'ReferenceLatent',
    ]);
    for (const classType of expectedClasses) {
      if (classType in objectInfo) continue;
      try {
        const nodePayload = await this.json(
          settings,
          `/object_info/${encodeURIComponent(classType)}`,
          settings.connectionTimeoutMs,
          signal,
        );
        if (nodePayload && typeof nodePayload === 'object') Object.assign(objectInfo, nodePayload);
      } catch (error) {
        if (!(error instanceof ImageProviderError) || error.code !== 'CONFIGURATION_ERROR')
          throw error;
      }
    }
    return objectInfo;
  }

  private missingNodes(payload: unknown, classTypes: string[]): string[] {
    if (!payload || typeof payload !== 'object') return classTypes;
    const objectInfo = payload as Record<string, unknown>;
    return classTypes.filter((classType) => {
      const value = objectInfo[classType];
      if (!value || typeof value !== 'object') return true;
      const required = (value as Record<string, unknown>).input;
      return (
        !required || typeof required !== 'object' || !(required as Record<string, unknown>).required
      );
    });
  }

  private samplerChoices(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') return [];
    const node = (payload as Record<string, unknown>).KSamplerSelect;
    if (!node || typeof node !== 'object') return [];
    const input = (node as Record<string, unknown>).input;
    const required =
      input && typeof input === 'object' ? (input as Record<string, unknown>).required : null;
    const sampler =
      required && typeof required === 'object'
        ? (required as Record<string, unknown>).sampler_name
        : null;
    const choices = Array.isArray(sampler) && Array.isArray(sampler[0]) ? sampler[0] : [];
    return choices.filter((value): value is string => typeof value === 'string');
  }

  private async hasTargetedCancellation(
    settings: ImageProviderSettings,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const response = await this.raw(
        settings,
        '/api/jobs?limit=1',
        {},
        settings.connectionTimeoutMs,
        signal,
      );
      if (!response.ok) return false;
      const payload = await this.responseJson(response);
      return Boolean(
        payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as Record<string, unknown>).jobs),
      );
    } catch {
      return false;
    }
  }

  private incompatible(checkedAt: string, message: string): ImageReadiness {
    return imageReadinessSchema.parse({
      provider: 'COMFYUI',
      status: 'INCOMPATIBLE_API',
      message,
      checkedAt,
    });
  }

  private baseUrl(settings: ImageProviderSettings): string {
    const value = new URL(settings.baseUrl);
    if (value.username || value.password)
      throw new ImageProviderError(
        'CONFIGURATION_ERROR',
        'ComfyUI URL cannot contain credentials',
        false,
      );
    return value.toString().replace(/\/$/u, '');
  }

  private async raw(
    settings: ImageProviderSettings,
    path: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = (): void => controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.fetchImpl(`${this.baseUrl(settings)}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted)
        throw new ImageProviderError('CANCELLED', 'ComfyUI request cancelled', false);
      if (timedOut) throw new ImageProviderError('TIMEOUT', 'ComfyUI request timed out', true);
      throw new ImageProviderError(
        'PROVIDER_UNAVAILABLE',
        error instanceof Error ? error.message : 'ComfyUI request failed',
        true,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  private async responseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text.slice(0, 1_000) };
    }
  }

  private async json(
    settings: ImageProviderSettings,
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.raw(settings, path, {}, timeoutMs, signal);
    if (response.status === 404)
      throw new ImageProviderError(
        'CONFIGURATION_ERROR',
        `ComfyUI endpoint not found: ${path}`,
        false,
      );
    if (!response.ok)
      throw new ImageProviderError(
        'PROVIDER_UNAVAILABLE',
        `ComfyUI endpoint failed: ${path}`,
        response.status >= 500,
      );
    return await this.responseJson(response);
  }

  private async array(
    settings: ImageProviderSettings,
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const payload = await this.json(settings, path, timeoutMs, signal);
    if (!Array.isArray(payload))
      throw new ImageProviderError(
        'CONFIGURATION_ERROR',
        'ComfyUI endpoint is not an array',
        false,
      );
    return payload.filter((item): item is string => typeof item === 'string');
  }
}

function readinessError(readiness: ImageReadiness): ImageProviderError {
  const code: ImageGenerationErrorCode =
    readiness.status === 'NOT_CONFIGURED'
      ? 'CONFIGURATION_ERROR'
      : readiness.status === 'INVALID_WORKFLOW'
        ? 'WORKFLOW_INVALID'
        : readiness.status === 'ERROR'
          ? 'MODEL_MISSING'
          : 'PROVIDER_UNAVAILABLE';
  return new ImageProviderError(
    code,
    readiness.message,
    readiness.status === 'UNREACHABLE' || readiness.status === 'ERROR',
  );
}

type ComfyHistoryRecord = {
  status?: { status_str?: string; completed?: boolean };
  outputs?: Record<string, unknown>;
};

type ComfyOutputImage = {
  filename?: unknown;
  subfolder?: unknown;
  type?: unknown;
};
