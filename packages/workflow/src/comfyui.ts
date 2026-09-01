import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  imageReadinessSchema,
  imageProviderResultSchema,
  type ImageGenerationErrorCode,
  type ImageGenerationRequest,
  type ImageProviderResult,
  type ImageProviderSettings,
  type ImageReadiness,
} from '@studio/shared';

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

export type ImageProvider = {
  generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageProviderResult>;
  readiness(settings: ImageProviderSettings, signal?: AbortSignal): Promise<ImageReadiness>;
  cancel(providerJobId: string, settings: ImageProviderSettings, signal?: AbortSignal): Promise<void>;
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

const TEXT_TO_IMAGE_V1_CLASSES: Record<string, string> = {
  [TEXT_TO_IMAGE_V1_NODE_IDS.unet]: 'UNETLoader',
  [TEXT_TO_IMAGE_V1_NODE_IDS.clip]: 'CLIPLoader',
  [TEXT_TO_IMAGE_V1_NODE_IDS.vae]: 'VAELoader',
  [TEXT_TO_IMAGE_V1_NODE_IDS.positive]: 'CLIPTextEncode',
  [TEXT_TO_IMAGE_V1_NODE_IDS.negative]: 'CLIPTextEncode',
  [TEXT_TO_IMAGE_V1_NODE_IDS.noise]: 'RandomNoise',
  [TEXT_TO_IMAGE_V1_NODE_IDS.sampler]: 'KSamplerSelect',
  [TEXT_TO_IMAGE_V1_NODE_IDS.scheduler]: 'Flux2Scheduler',
  [TEXT_TO_IMAGE_V1_NODE_IDS.latent]: 'EmptyFlux2LatentImage',
  [TEXT_TO_IMAGE_V1_NODE_IDS.guider]: 'CFGGuider',
  [TEXT_TO_IMAGE_V1_NODE_IDS.samplerAdvanced]: 'SamplerCustomAdvanced',
  [TEXT_TO_IMAGE_V1_NODE_IDS.decode]: 'VAEDecode',
  [TEXT_TO_IMAGE_V1_NODE_IDS.save]: 'SaveImage',
};

const TEXT_TO_IMAGE_V1_REQUIRED_INPUTS: Record<string, string[]> = {
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

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const normalizeDimension = (value: number): number => Math.max(16, Math.min(16_384, Math.round(value / 16) * 16));
const sleepDefault: Sleep = async (milliseconds) => {
  await delay(milliseconds);
};

export function buildComfyUiPrompt(request: ImageGenerationRequest): ComfyUiPrompt {
  const width = normalizeDimension(request.width);
  const height = normalizeDimension(request.height);
  const prompt = request.generationInstructions
    ? `${request.prompt}\n\nGeneration instructions: ${request.generationInstructions}`
    : request.prompt;
  const graph: ComfyUiPrompt = {
    [TEXT_TO_IMAGE_V1_NODE_IDS.unet]: {
      class_type: 'UNETLoader',
      inputs: { unet_name: request.providerSettings.diffusionModel, weight_dtype: 'default' },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.clip]: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: request.providerSettings.textEncoder, type: 'flux2', device: 'default' },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.vae]: {
      class_type: 'VAELoader',
      inputs: { vae_name: request.providerSettings.vaeName },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.positive]: {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: [TEXT_TO_IMAGE_V1_NODE_IDS.clip, 0] },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.negative]: {
      class_type: 'CLIPTextEncode',
      inputs: { text: request.negativePrompt ?? '', clip: [TEXT_TO_IMAGE_V1_NODE_IDS.clip, 0] },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.noise]: {
      class_type: 'RandomNoise',
      inputs: { noise_seed: request.seed },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.sampler]: {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: request.samplerHint },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.scheduler]: {
      class_type: 'Flux2Scheduler',
      inputs: { steps: request.steps, width, height },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.latent]: {
      class_type: 'EmptyFlux2LatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.guider]: {
      class_type: 'CFGGuider',
      inputs: {
        model: [TEXT_TO_IMAGE_V1_NODE_IDS.unet, 0],
        positive: [TEXT_TO_IMAGE_V1_NODE_IDS.positive, 0],
        negative: [TEXT_TO_IMAGE_V1_NODE_IDS.negative, 0],
        cfg: request.guidance,
      },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.samplerAdvanced]: {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: [TEXT_TO_IMAGE_V1_NODE_IDS.noise, 0],
        guider: [TEXT_TO_IMAGE_V1_NODE_IDS.guider, 0],
        sampler: [TEXT_TO_IMAGE_V1_NODE_IDS.sampler, 0],
        sigmas: [TEXT_TO_IMAGE_V1_NODE_IDS.scheduler, 0],
        latent_image: [TEXT_TO_IMAGE_V1_NODE_IDS.latent, 0],
      },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.decode]: {
      class_type: 'VAEDecode',
      inputs: {
        samples: [TEXT_TO_IMAGE_V1_NODE_IDS.samplerAdvanced, 0],
        vae: [TEXT_TO_IMAGE_V1_NODE_IDS.vae, 0],
      },
    },
    [TEXT_TO_IMAGE_V1_NODE_IDS.save]: {
      class_type: 'SaveImage',
      inputs: { images: [TEXT_TO_IMAGE_V1_NODE_IDS.decode, 0], filename_prefix: 'studio/scenes' },
    },
  };
  validateComfyUiPrompt(graph);
  return graph;
}

export function validateComfyUiPrompt(prompt: ComfyUiPrompt): void {
  const keys = Object.keys(prompt).sort();
  const expected = Object.keys(TEXT_TO_IMAGE_V1_CLASSES).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]))
    throw new ImageProviderError('WORKFLOW_INVALID', 'ComfyUI workflow contains unknown or missing nodes', false);
  for (const [id, classType] of Object.entries(TEXT_TO_IMAGE_V1_CLASSES)) {
    const node = prompt[id];
    const required = TEXT_TO_IMAGE_V1_REQUIRED_INPUTS[classType] ?? [];
    if (
      !node ||
      node.class_type !== classType ||
      !node.inputs ||
      typeof node.inputs !== 'object' ||
      required.some((name) => !(name in node.inputs))
    )
      throw new ImageProviderError('WORKFLOW_INVALID', `ComfyUI node ${id} is invalid`, false);
  }
  const links: Array<[string, string, string]> = [
    ['4', 'clip', '2'],
    ['5', 'clip', '2'],
    ['10', 'model', '1'],
    ['10', 'positive', '4'],
    ['10', 'negative', '5'],
    ['11', 'noise', '6'],
    ['11', 'guider', '10'],
    ['11', 'sampler', '7'],
    ['11', 'sigmas', '8'],
    ['11', 'latent_image', '9'],
    ['12', 'samples', '11'],
    ['12', 'vae', '3'],
    ['13', 'images', '12'],
  ];
  for (const [target, input, source] of links) {
    const value = prompt[target]?.inputs[input];
    if (!Array.isArray(value) || value[0] !== source || value[1] !== 0)
      throw new ImageProviderError('WORKFLOW_INVALID', `ComfyUI link ${target}.${input} is invalid`, false);
  }
}

export class ComfyUiImageProvider implements ImageProvider {
  private supportsTargetedCancellation = false;

  constructor(
    private readonly outputRoot: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: Sleep = sleepDefault,
    private readonly clock: () => number = Date.now,
  ) {}

  async readiness(settings: ImageProviderSettings, signal?: AbortSignal): Promise<ImageReadiness> {
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
      const system = await this.json(settings, '/system_stats', settings.connectionTimeoutMs, signal);
      if (!system || typeof system !== 'object') return this.incompatible(checkedAt, 'ComfyUI system_stats is invalid');
      const objectInfo = await this.loadObjectInfo(settings, signal);
      const missingNodes = this.missingNodes(objectInfo);
      if (missingNodes.length)
        return imageReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'INVALID_WORKFLOW',
          message: 'ComfyUI does not expose the required native nodes',
          checkedAt,
          details: { missingNodes },
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
        message: 'ComfyUI is ready for native text-to-image generation',
        checkedAt,
        supportsCancellation: this.supportsTargetedCancellation,
        details: {
          systemKeys: Object.keys(system),
          modelCounts: { diffusion: diffusionModels.length, textEncoder: textEncoders.length, vae: vaes.length },
          samplerChoices,
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

  async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageProviderResult> {
    const started = this.clock();
    const readiness = await this.readiness(request.providerSettings, signal);
    if (readiness.status !== 'READY') throw readinessError(readiness);
    const prompt = buildComfyUiPrompt(request);
    const history = await this.history(request.providerSettings, request.providerJobId, signal);
    let record = history;
    if (!record) {
      const queued = await this.queueContains(request.providerSettings, request.providerJobId, signal);
      if (!queued) await this.submit(request.providerSettings, request.providerJobId, prompt, signal);
    }
    const deadline = this.clock() + request.providerSettings.generationTimeoutMs;
    while (!record) {
      if (signal?.aborted) throw new ImageProviderError('CANCELLED', 'Image generation cancelled', false);
      if (this.clock() >= deadline) throw new ImageProviderError('TIMEOUT', 'ComfyUI image generation timed out', true);
      record = await this.history(request.providerSettings, request.providerJobId, signal);
      if (record) break;
      await this.sleep(1_000);
    }
    const output = this.completedOutput(record, request.providerJobId);
    const images = await this.downloadImages(request.providerSettings, request.providerJobId, output, signal);
    const result = imageProviderResultSchema.parse({
      provider: 'COMFYUI',
      providerJobId: request.providerJobId,
      seed: request.seed,
      width: normalizeDimension(request.width),
      height: normalizeDimension(request.height),
      durationMs: Math.max(0, this.clock() - started),
      images,
      warnings: request.referenceImages.length ? ['REFERENCE_IMAGES_UNUSED'] : [],
      metadata: { workflowTemplate: request.providerSettings.workflowTemplate, mappingVersion: 'text-to-image-v1-mapping-1' },
    });
    return result;
  }

  async cancel(providerJobId: string, settings: ImageProviderSettings, signal?: AbortSignal): Promise<void> {
    if (this.supportsTargetedCancellation) {
      const response = await this.raw(settings, `/api/jobs/${encodeURIComponent(providerJobId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }, settings.connectionTimeoutMs, signal);
      if (response.ok || response.status === 404) return;
      if (response.status !== 405) throw new ImageProviderError('CANCELLED', 'ComfyUI cancellation failed', true);
      this.supportsTargetedCancellation = false;
    }
    const queue = await this.json(settings, '/queue', settings.connectionTimeoutMs, signal);
    const pending = this.queueIds(queue, 'queue_pending').includes(providerJobId);
    const running = this.queueIds(queue, 'queue_running').includes(providerJobId);
    if (pending) {
      const response = await this.raw(settings, '/queue', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delete: [providerJobId] }),
      }, settings.connectionTimeoutMs, signal);
      if (!response.ok) throw new ImageProviderError('CANCELLED', 'ComfyUI queue cancellation failed', true);
      return;
    }
    if (running) throw new ImageProviderError('CONFIGURATION_ERROR', 'ComfyUI cannot safely cancel a running job on this server', false);
  }

  private async submit(
    settings: ImageProviderSettings,
    providerJobId: string,
    prompt: ComfyUiPrompt,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.raw(settings, '/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: providerJobId, prompt_id: providerJobId }),
    }, settings.connectionTimeoutMs, signal);
    const payload = await this.responseJson(response);
    if (!response.ok) {
      throw new ImageProviderError(
        'SUBMISSION_FAILED',
        'ComfyUI rejected the image workflow',
        response.status >= 500,
        `HTTP ${response.status}`,
      );
    }
    if (!payload || typeof payload !== 'object' || (payload as Record<string, unknown>).prompt_id !== providerJobId)
      throw new ImageProviderError('SUBMISSION_FAILED', 'ComfyUI did not preserve the provider job ID', false);
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
      throw new ImageProviderError('PROVIDER_UNAVAILABLE', 'ComfyUI history request failed', response.status >= 500);
    const payload = await this.responseJson(response);
    if (!payload || typeof payload !== 'object')
      throw new ImageProviderError('OUTCOME_UNKNOWN', 'ComfyUI history response is invalid', false);
    const value = (payload as Record<string, unknown>)[providerJobId];
    if (!value || typeof value !== 'object') return null;
    const record = value as ComfyHistoryRecord;
    const status = record.status;
    const statusValue = status && typeof status.status_str === 'string' ? status.status_str.toLowerCase() : '';
    if (status?.completed === true || ['success', 'completed', 'error', 'failed'].includes(statusValue)) return record;
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
      output && typeof output === 'object' && Array.isArray((output as Record<string, unknown>).images)
        ? ((output as Record<string, unknown>).images as ComfyOutputImage[])
        : [];
    if (!images.length)
      throw new ImageProviderError('OUTPUT_MISSING', `ComfyUI returned no images for ${providerJobId}`, false);
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
          throw new ImageProviderError('OUTPUT_INVALID', 'ComfyUI returned an invalid image filename', false);
        const extension = extname(output.filename).toLowerCase();
        if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension))
          throw new ImageProviderError('OUTPUT_INVALID', 'ComfyUI returned an unsupported image format', false);
        const response = await this.raw(settings, `/view?${new URLSearchParams({ filename: output.filename, subfolder: typeof output.subfolder === 'string' ? output.subfolder : '', type: typeof output.type === 'string' ? output.type : 'output' }).toString()}`, {}, settings.connectionTimeoutMs, signal);
        if (!response.ok || !response.body)
          throw new ImageProviderError('DOWNLOAD_FAILED', 'ComfyUI image download failed', response.status >= 500);
        const filename = join(directory, `${index}${extension}`);
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filename));
        images.push({
          mediaType: extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg',
          stagingPath: filename,
          width: 16,
          height: 16,
        });
      }
      return images;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      if (error instanceof ImageProviderError) throw error;
      throw new ImageProviderError('DOWNLOAD_FAILED', error instanceof Error ? error.message : 'ComfyUI image download failed', true);
    }
  }

  private async queueContains(settings: ImageProviderSettings, providerJobId: string, signal?: AbortSignal): Promise<boolean> {
    const queue = await this.json(settings, '/queue', settings.connectionTimeoutMs, signal);
    return this.queueIds(queue, 'queue_pending').includes(providerJobId) || this.queueIds(queue, 'queue_running').includes(providerJobId);
  }

  private queueIds(payload: unknown, key: 'queue_pending' | 'queue_running'): string[] {
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>)[key])) return [];
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
    for (const classType of Object.values(TEXT_TO_IMAGE_V1_CLASSES)) {
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
        if (!(error instanceof ImageProviderError) || error.code !== 'CONFIGURATION_ERROR') throw error;
      }
    }
    return objectInfo;
  }

  private missingNodes(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') return Object.values(TEXT_TO_IMAGE_V1_CLASSES);
    const objectInfo = payload as Record<string, unknown>;
    return Object.entries(TEXT_TO_IMAGE_V1_CLASSES)
      .filter(([, classType]) => {
        const value = objectInfo[classType];
        if (!value || typeof value !== 'object') return true;
        const required = (value as Record<string, unknown>).input;
        return !required || typeof required !== 'object' || !(required as Record<string, unknown>).required;
      })
      .map(([, classType]) => classType);
  }

  private samplerChoices(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') return [];
    const node = (payload as Record<string, unknown>).KSamplerSelect;
    if (!node || typeof node !== 'object') return [];
    const input = (node as Record<string, unknown>).input;
    const required = input && typeof input === 'object' ? (input as Record<string, unknown>).required : null;
    const sampler = required && typeof required === 'object' ? (required as Record<string, unknown>).sampler_name : null;
    const choices = Array.isArray(sampler) && Array.isArray(sampler[0]) ? sampler[0] : [];
    return choices.filter((value): value is string => typeof value === 'string');
  }

  private async hasTargetedCancellation(settings: ImageProviderSettings, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.raw(settings, '/api/jobs?limit=1', {}, settings.connectionTimeoutMs, signal);
      if (!response.ok) return false;
      const payload = await this.responseJson(response);
      return Boolean(payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).jobs));
    } catch {
      return false;
    }
  }

  private incompatible(checkedAt: string, message: string): ImageReadiness {
    return imageReadinessSchema.parse({ provider: 'COMFYUI', status: 'INCOMPATIBLE_API', message, checkedAt });
  }

  private baseUrl(settings: ImageProviderSettings): string {
    const value = new URL(settings.baseUrl);
    if (value.username || value.password) throw new ImageProviderError('CONFIGURATION_ERROR', 'ComfyUI URL cannot contain credentials', false);
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
      return await this.fetchImpl(`${this.baseUrl(settings)}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (signal?.aborted) throw new ImageProviderError('CANCELLED', 'ComfyUI request cancelled', false);
      if (timedOut) throw new ImageProviderError('TIMEOUT', 'ComfyUI request timed out', true);
      throw new ImageProviderError('PROVIDER_UNAVAILABLE', error instanceof Error ? error.message : 'ComfyUI request failed', true);
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

  private async json(settings: ImageProviderSettings, path: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const response = await this.raw(settings, path, {}, timeoutMs, signal);
    if (response.status === 404) throw new ImageProviderError('CONFIGURATION_ERROR', `ComfyUI endpoint not found: ${path}`, false);
    if (!response.ok) throw new ImageProviderError('PROVIDER_UNAVAILABLE', `ComfyUI endpoint failed: ${path}`, response.status >= 500);
    return await this.responseJson(response);
  }

  private async array(settings: ImageProviderSettings, path: string, timeoutMs: number, signal?: AbortSignal): Promise<string[]> {
    const payload = await this.json(settings, path, timeoutMs, signal);
    if (!Array.isArray(payload)) throw new ImageProviderError('CONFIGURATION_ERROR', `ComfyUI endpoint is not an array: ${path}`, false);
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
  return new ImageProviderError(code, readiness.message, readiness.status === 'UNREACHABLE' || readiness.status === 'ERROR');
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
