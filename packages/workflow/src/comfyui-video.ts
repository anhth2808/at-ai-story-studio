import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  videoGenerationRequestSchema,
  videoGenerationResultSchema,
  videoReadinessSchema,
  type VideoGenerationErrorCode,
  type VideoGenerationRequest,
  type VideoGenerationResult,
  type VideoProviderSettings,
  type VideoReadiness,
} from '@studio/shared';
import { safeWorkspacePath } from '@studio/media';

export type VideoProviderFailure = {
  code: VideoGenerationErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: string;
};

export class VideoProviderError extends Error implements VideoProviderFailure {
  constructor(
    public readonly code: VideoGenerationErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly diagnostics?: string,
  ) {
    super(message);
    this.name = 'VideoProviderError';
  }
}

export type VideoGenerationProvider = {
  generate(
    request: VideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<VideoGenerationResult>;
  readiness(settings: VideoProviderSettings, signal?: AbortSignal): Promise<VideoReadiness>;
  cancel(
    providerJobId: string,
    settings: VideoProviderSettings,
    signal?: AbortSignal,
  ): Promise<void>;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

type ComfyNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};
export type ComfyUiVideoPrompt = Record<string, ComfyNode>;

// Mirrors the official ComfyUI video_wan2_2_5B_ti2v template graph so the
// Studio mapping stays auditable against the upstream example.
export const IMAGE_TO_VIDEO_V1_NODE_IDS = Object.freeze({
  unet: '37',
  clip: '38',
  vae: '39',
  modelSampling: '48',
  positive: '6',
  negative: '7',
  loadImage: '56',
  latent: '55',
  sampler: '3',
  decode: '8',
  createVideo: '57',
  saveVideo: '58',
});

export const IMAGE_TO_VIDEO_V1_MAPPING_VERSION = 'image-to-video-v1-mapping-1';

// English rendering of the standard Wan negative prompt; the umt5 encoder is
// multilingual so semantics match the official Chinese default.
export const WAN22_DEFAULT_NEGATIVE_PROMPT =
  'Oversaturated colors, overexposed, static, blurry details, subtitles, style, works, paintings, images, still frames, overall grayish, worst quality, low quality, JPEG compression artifacts, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, deformed limbs, fused fingers, motionless scene, cluttered background, three legs, crowded background, walking backwards';

const REQUIRED_NATIVE_NODE_CLASSES = Object.freeze([
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'ModelSamplingSD3',
  'CLIPTextEncode',
  'LoadImage',
  'Wan22ImageToVideoLatent',
  'KSampler',
  'VAEDecode',
  'CreateVideo',
  'SaveVideo',
]);

const SUPPORTED_VIDEO_EXTENSIONS: Record<string, true> = {
  '.mp4': true,
  '.webm': true,
};

const MEDIA_TYPE_BY_EXTENSION: Record<string, 'video/mp4' | 'video/webm'> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

type GraphSpec = {
  classes: Record<string, string>;
  requiredInputs: Record<string, string[]>;
  links: Array<[target: string, input: string, source: string]>;
};

const ids = IMAGE_TO_VIDEO_V1_NODE_IDS;

function videoGraphSpec(): GraphSpec {
  const classes: Record<string, string> = {
    [ids.unet]: 'UNETLoader',
    [ids.clip]: 'CLIPLoader',
    [ids.vae]: 'VAELoader',
    [ids.modelSampling]: 'ModelSamplingSD3',
    [ids.positive]: 'CLIPTextEncode',
    [ids.negative]: 'CLIPTextEncode',
    [ids.loadImage]: 'LoadImage',
    [ids.latent]: 'Wan22ImageToVideoLatent',
    [ids.sampler]: 'KSampler',
    [ids.decode]: 'VAEDecode',
    [ids.createVideo]: 'CreateVideo',
    [ids.saveVideo]: 'SaveVideo',
  };
  const requiredInputs: Record<string, string[]> = {
    UNETLoader: ['unet_name'],
    CLIPLoader: ['clip_name', 'type'],
    VAELoader: ['vae_name'],
    ModelSamplingSD3: ['model', 'shift'],
    CLIPTextEncode: ['text', 'clip'],
    LoadImage: ['image'],
    Wan22ImageToVideoLatent: ['vae', 'width', 'height', 'length', 'batch_size'],
    KSampler: [
      'model',
      'positive',
      'negative',
      'latent_image',
      'seed',
      'steps',
      'cfg',
      'sampler_name',
      'scheduler',
      'denoise',
    ],
    VAEDecode: ['samples', 'vae'],
    CreateVideo: ['images', 'fps'],
    SaveVideo: ['video', 'filename_prefix'],
  };
  const links: Array<[string, string, string]> = [
    [ids.modelSampling, 'model', ids.unet],
    [ids.sampler, 'model', ids.modelSampling],
    [ids.positive, 'clip', ids.clip],
    [ids.negative, 'clip', ids.clip],
    [ids.latent, 'vae', ids.vae],
    [ids.latent, 'start_image', ids.loadImage],
    [ids.sampler, 'positive', ids.positive],
    [ids.sampler, 'negative', ids.negative],
    [ids.sampler, 'latent_image', ids.latent],
    [ids.decode, 'samples', ids.sampler],
    [ids.decode, 'vae', ids.vae],
    [ids.createVideo, 'images', ids.decode],
    [ids.saveVideo, 'video', ids.createVideo],
  ];
  return { classes, requiredInputs, links };
}

export function buildComfyUiVideoPrompt(
  request: VideoGenerationRequest,
  uploadedImageName: string,
): ComfyUiVideoPrompt {
  const graph: ComfyUiVideoPrompt = {
    [ids.unet]: {
      class_type: 'UNETLoader',
      inputs: { unet_name: request.providerSettings.diffusionModel, weight_dtype: 'default' },
    },
    [ids.clip]: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: request.providerSettings.textEncoder, type: 'wan', device: 'default' },
    },
    [ids.vae]: {
      class_type: 'VAELoader',
      inputs: { vae_name: request.providerSettings.vaeName },
    },
    [ids.modelSampling]: {
      class_type: 'ModelSamplingSD3',
      inputs: { model: [ids.unet, 0], shift: request.providerSettings.shift },
    },
    [ids.positive]: {
      class_type: 'CLIPTextEncode',
      inputs: { text: request.motionPrompt, clip: [ids.clip, 0] },
    },
    [ids.negative]: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: request.negativePrompt ?? WAN22_DEFAULT_NEGATIVE_PROMPT,
        clip: [ids.clip, 0],
      },
    },
    [ids.loadImage]: {
      class_type: 'LoadImage',
      inputs: { image: uploadedImageName },
    },
    [ids.latent]: {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: {
        vae: [ids.vae, 0],
        width: request.width,
        height: request.height,
        length: request.frameCount,
        batch_size: 1,
        start_image: [ids.loadImage, 0],
      },
    },
    [ids.sampler]: {
      class_type: 'KSampler',
      inputs: {
        model: [ids.modelSampling, 0],
        positive: [ids.positive, 0],
        negative: [ids.negative, 0],
        latent_image: [ids.latent, 0],
        seed: request.seed,
        steps: request.providerSettings.steps,
        cfg: request.providerSettings.guidance,
        sampler_name: request.providerSettings.sampler,
        scheduler: request.providerSettings.scheduler,
        denoise: 1,
      },
    },
    [ids.decode]: {
      class_type: 'VAEDecode',
      inputs: { samples: [ids.sampler, 0], vae: [ids.vae, 0] },
    },
    [ids.createVideo]: {
      class_type: 'CreateVideo',
      inputs: { images: [ids.decode, 0], fps: request.fps },
    },
    [ids.saveVideo]: {
      class_type: 'SaveVideo',
      inputs: {
        video: [ids.createVideo, 0],
        filename_prefix: 'studio/motion',
        format: 'auto',
        codec: 'auto',
      },
    },
  };
  validateComfyUiVideoPrompt(graph);
  return graph;
}

export function validateComfyUiVideoPrompt(prompt: ComfyUiVideoPrompt): void {
  const spec = videoGraphSpec();
  const keys = Object.keys(prompt).sort();
  const expected = Object.keys(spec.classes).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]))
    throw new VideoProviderError(
      'WORKFLOW_INVALID',
      'ComfyUI video workflow contains unknown or missing nodes',
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
      throw new VideoProviderError('WORKFLOW_INVALID', `ComfyUI node ${id} is invalid`, false);
  }
  for (const [target, input, source] of spec.links) {
    const value = prompt[target]?.inputs[input];
    if (!Array.isArray(value) || value[0] !== source || value[1] !== 0)
      throw new VideoProviderError(
        'WORKFLOW_INVALID',
        `ComfyUI link ${target}.${input} is invalid`,
        false,
      );
  }
}

const sleepDefault: Sleep = async (milliseconds) => {
  await delay(milliseconds);
};

type ComfyHistoryRecord = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown;
  };
  outputs?: Record<string, unknown>;
};

type ComfyOutputFile = {
  filename?: unknown;
  subfolder?: unknown;
  type?: unknown;
};

export class ComfyUiVideoProvider implements VideoGenerationProvider {
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

  async readiness(
    settings: VideoProviderSettings,
    signal?: AbortSignal,
  ): Promise<VideoReadiness> {
    const checkedAt = new Date(this.clock()).toISOString();
    if (!settings.diffusionModel || !settings.textEncoder || !settings.vaeName)
      return videoReadinessSchema.parse({
        provider: 'COMFYUI',
        status: 'NOT_CONFIGURED',
        message: 'ComfyUI video model components are not configured',
        details: { required: ['diffusionModel', 'textEncoder', 'vaeName'] },
      });
    try {
      const system = await this.json(settings, '/system_stats', settings.connectionTimeoutMs, signal);
      if (!system || typeof system !== 'object')
        return this.parseReadiness(checkedAt, 'ERROR', 'ComfyUI system_stats is invalid');
      const objectInfo = await this.loadObjectInfo(settings, signal);
      const missingNodes = REQUIRED_NATIVE_NODE_CLASSES.filter(
        (classType) => !objectInfo[classType] || typeof objectInfo[classType] !== 'object',
      );
      if (missingNodes.length)
        return videoReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'WORKFLOW_MISSING',
          message: 'ComfyUI does not expose the native nodes required by image-to-video-v1',
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
        return videoReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'VIDEO_MODEL_MISSING',
          message: 'Required Wan 2.2 video model files are missing on the ComfyUI server',
          checkedAt,
          details: { missingModels },
        });
      const samplerChoices = this.choiceList(objectInfo, 'KSampler', 'sampler_name');
      const schedulerChoices = this.choiceList(objectInfo, 'KSampler', 'scheduler');
      if (
        (samplerChoices.length && !samplerChoices.includes(settings.sampler)) ||
        (schedulerChoices.length && !schedulerChoices.includes(settings.scheduler))
      )
        return videoReadinessSchema.parse({
          provider: 'COMFYUI',
          status: 'INSUFFICIENT_CONFIGURATION',
          message: 'Configured sampler or scheduler is not offered by this ComfyUI server',
          checkedAt,
          details: {
            sampler: settings.sampler,
            scheduler: settings.scheduler,
            samplerChoices,
            schedulerChoices,
          },
        });
      this.supportsTargetedCancellation = await this.hasTargetedCancellation(settings, signal);
      return videoReadinessSchema.parse({
        provider: 'COMFYUI',
        status: 'READY',
        message: 'ComfyUI is ready for Wan 2.2 TI2V-5B image-to-video generation',
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
          schedulerChoices,
        },
      });
    } catch (error) {
      if (error instanceof VideoProviderError) {
        const status =
          error.code === 'WORKFLOW_INVALID'
            ? 'WORKFLOW_MISSING'
            : error.code === 'CONFIGURATION_ERROR'
              ? 'ERROR'
              : 'COMFYUI_UNAVAILABLE';
        return this.parseReadiness(checkedAt, status, error.message);
      }
      return videoReadinessSchema.parse({
        provider: 'COMFYUI',
        status: 'COMFYUI_UNAVAILABLE',
        message: error instanceof Error ? error.message.slice(0, 1_000) : 'ComfyUI is unreachable',
        checkedAt,
      });
    }
  }

  private parseReadiness(
    checkedAt: string,
    status: VideoReadiness['status'],
    message: string,
  ): VideoReadiness {
    return videoReadinessSchema.parse({
      provider: 'COMFYUI',
      status,
      message: message.slice(0, 1_000),
      checkedAt,
    });
  }

  async generate(
    request: VideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<VideoGenerationResult> {
    const started = this.clock();
    const parsedRequest = videoGenerationRequestSchema.parse(request);
    const readiness = await this.readiness(parsedRequest.providerSettings, signal);
    if (readiness.status !== 'READY') throw readinessError(readiness);
    const uploadedImage = await this.uploadSourceImage(parsedRequest, signal);
    const prompt = buildComfyUiVideoPrompt(parsedRequest, uploadedImage);
    let record = await this.history(
      parsedRequest.providerSettings,
      parsedRequest.providerJobId,
      signal,
    );
    if (!record) {
      const queued = await this.queueContains(
        parsedRequest.providerSettings,
        parsedRequest.providerJobId,
        signal,
      );
      if (!queued)
        await this.submit(
          parsedRequest.providerSettings,
          parsedRequest.providerJobId,
          prompt,
          signal,
        );
    }
    const deadline = this.clock() + parsedRequest.providerSettings.generationTimeoutMs;
    while (!record) {
      if (signal?.aborted)
        throw new VideoProviderError('CANCELLED', 'Video generation cancelled', false);
      if (this.clock() >= deadline)
        throw new VideoProviderError('TIMEOUT', 'ComfyUI video generation timed out', true);
      record = await this.history(
        parsedRequest.providerSettings,
        parsedRequest.providerJobId,
        signal,
      );
      if (record) break;
      await this.sleep(2_000);
    }
    const output = this.completedOutput(record, parsedRequest.providerJobId);
    const video = await this.downloadVideo(
      parsedRequest.providerSettings,
      parsedRequest.providerJobId,
      output,
      signal,
    );
    return videoGenerationResultSchema.parse({
      provider: 'COMFYUI',
      providerJobId: parsedRequest.providerJobId,
      seed: parsedRequest.seed,
      width: parsedRequest.width,
      height: parsedRequest.height,
      fps: parsedRequest.fps,
      frameCount: parsedRequest.frameCount,
      durationMs: Math.max(0, this.clock() - started),
      clipDurationMs: Math.round((parsedRequest.frameCount / parsedRequest.fps) * 1_000),
      videos: [video],
      metadata: {
        workflowTemplate: parsedRequest.providerSettings.workflowTemplate,
        mappingVersion: IMAGE_TO_VIDEO_V1_MAPPING_VERSION,
        model: parsedRequest.providerSettings.diffusionModel,
      },
    });
  }

  // Streams the source image through a multipart body; the provider-returned
  // name is what LoadImage references.
  private async uploadSourceImage(
    request: VideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<string> {
    const absolute = safeWorkspacePath(this.resolveWorkspaceRoot(), request.sourceImagePath);
    const info = await stat(absolute).catch(() => null);
    if (!info || !info.isFile())
      throw new VideoProviderError(
        'SOURCE_UPLOAD_FAILED',
        'The accepted scene image file is unavailable for upload',
        true,
      );
    const extension = extname(absolute).toLowerCase() || '.png';
    const formName = `${randomUUID()}${extension}`;
    const boundary = `studio-video-${randomUUID()}`;
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
      throw new VideoProviderError(
        'SOURCE_UPLOAD_FAILED',
        'ComfyUI rejected the source image upload',
        response.status >= 500,
        `HTTP ${response.status}`,
      );
    const payload = await this.responseJson(response);
    const name = (payload as Record<string, unknown> | null)?.name;
    if (typeof name !== 'string' || !name || name.length > 300)
      throw new VideoProviderError(
        'SOURCE_UPLOAD_FAILED',
        'ComfyUI returned an invalid source image upload response',
        false,
      );
    return name;
  }

  async cancel(
    providerJobId: string,
    settings: VideoProviderSettings,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.supportsTargetedCancellation) {
      const response = await this.raw(
        settings,
        `/api/jobs/${encodeURIComponent(providerJobId)}/cancel`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        settings.connectionTimeoutMs,
        signal,
      );
      if (response.ok || response.status === 404) return;
      if (response.status !== 405)
        throw new VideoProviderError('CANCELLED', 'ComfyUI cancellation failed', true);
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
        throw new VideoProviderError('CANCELLED', 'ComfyUI queue cancellation failed', true);
      return;
    }
    if (running)
      throw new VideoProviderError(
        'CONFIGURATION_ERROR',
        'ComfyUI cannot safely cancel a running video job on this server; generation continues remotely',
        false,
      );
  }

  private async submit(
    settings: VideoProviderSettings,
    providerJobId: string,
    prompt: ComfyUiVideoPrompt,
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
    if (!response.ok)
      throw new VideoProviderError(
        'SUBMISSION_FAILED',
        'ComfyUI rejected the video workflow',
        response.status >= 500,
        `HTTP ${response.status}`,
      );
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as Record<string, unknown>).prompt_id !== providerJobId
    )
      throw new VideoProviderError(
        'SUBMISSION_FAILED',
        'ComfyUI did not preserve the provider job ID',
        false,
      );
  }

  private async history(
    settings: VideoProviderSettings,
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
      throw new VideoProviderError(
        'PROVIDER_UNAVAILABLE',
        'ComfyUI history request failed',
        response.status >= 500,
      );
    const payload = await this.responseJson(response);
    if (!payload || typeof payload !== 'object')
      throw new VideoProviderError('OUTCOME_UNKNOWN', 'ComfyUI history response is invalid', false);
    const value = (payload as Record<string, unknown>)[providerJobId];
    if (!value || typeof value !== 'object') return null;
    const record = value as ComfyHistoryRecord;
    const status = record.status;
    const statusValue =
      status && typeof status.status_str === 'string' ? status.status_str.toLowerCase() : '';
    if (status?.completed === true || ['success', 'completed', 'error', 'failed'].includes(statusValue))
      return record;
    return null;
  }

  // SaveVideo output containers have moved between ComfyUI releases, so scan
  // the output record for the first array of files instead of pinning one key.
  private completedOutput(record: ComfyHistoryRecord, providerJobId: string): ComfyOutputFile {
    const status = record.status;
    const statusValue =
      status && typeof status.status_str === 'string' ? status.status_str.toLowerCase() : '';
    if (statusValue && !['success', 'completed'].includes(statusValue)) {
      const oom = detectOutOfMemory(record);
      throw new VideoProviderError(
        oom ? 'OUT_OF_MEMORY' : 'GENERATION_FAILED',
        oom
          ? 'ComfyUI ran out of VRAM during video generation'
          : `ComfyUI video generation ${statusValue}`,
        false,
        oom ? 'OUT_OF_MEMORY' : undefined,
      );
    }
    const output = record.outputs?.[ids.saveVideo];
    if (output && typeof output === 'object') {
      for (const value of Object.values(output as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        const file = value.find(
          (entry): entry is ComfyOutputFile =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof (entry as Record<string, unknown>).filename === 'string',
        );
        if (file) return file;
      }
    }
    throw new VideoProviderError(
      'OUTPUT_MISSING',
      `ComfyUI returned no video output for ${providerJobId}`,
      false,
    );
  }

  private async downloadVideo(
    settings: VideoProviderSettings,
    providerJobId: string,
    output: ComfyOutputFile,
    signal?: AbortSignal,
  ): Promise<VideoGenerationResult['videos'][number]> {
    const directory = join(resolve(this.outputRoot), `comfyui-video-${providerJobId}`);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    try {
      if (typeof output.filename !== 'string' || !output.filename || output.filename.length > 300)
        throw new VideoProviderError(
          'OUTPUT_INVALID',
          'ComfyUI returned an invalid video filename',
          false,
        );
      const extension = extname(output.filename).toLowerCase();
      if (!SUPPORTED_VIDEO_EXTENSIONS[extension])
        throw new VideoProviderError(
          'OUTPUT_INVALID',
          'ComfyUI returned an unsupported video format',
          false,
        );
      const response = await this.raw(
        settings,
        `/view?${new URLSearchParams({
          filename: output.filename,
          subfolder: typeof output.subfolder === 'string' ? output.subfolder : '',
          type: typeof output.type === 'string' ? output.type : 'output',
        }).toString()}`,
        {},
        settings.connectionTimeoutMs,
        signal,
      );
      if (!response.ok || !response.body)
        throw new VideoProviderError(
          'DOWNLOAD_FAILED',
          'ComfyUI video download failed',
          response.status >= 500,
        );
      const filename = join(directory, `motion${extension}`);
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filename));
      return { mediaType: MEDIA_TYPE_BY_EXTENSION[extension]!, stagingPath: filename };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      if (error instanceof VideoProviderError) throw error;
      throw new VideoProviderError(
        'DOWNLOAD_FAILED',
        error instanceof Error ? error.message : 'ComfyUI video download failed',
        true,
      );
    }
  }

  private async queueContains(
    settings: VideoProviderSettings,
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
    settings: VideoProviderSettings,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const payload = await this.json(settings, '/object_info', settings.connectionTimeoutMs, signal);
    if (!payload || typeof payload !== 'object') return {};
    const objectInfo = { ...(payload as Record<string, unknown>) };
    for (const classType of REQUIRED_NATIVE_NODE_CLASSES) {
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
        if (!(error instanceof VideoProviderError) || error.code !== 'CONFIGURATION_ERROR')
          throw error;
      }
    }
    return objectInfo;
  }

  private choiceList(
    objectInfo: Record<string, unknown>,
    className: string,
    inputName: string,
  ): string[] {
    const node = objectInfo[className];
    if (!node || typeof node !== 'object') return [];
    const input = (node as Record<string, unknown>).input;
    const required = input && typeof input === 'object' ? (input as Record<string, unknown>).required : null;
    const entry =
      required && typeof required === 'object' ? (required as Record<string, unknown>)[inputName] : null;
    return Array.isArray(entry) && Array.isArray(entry[0])
      ? entry[0].filter((value): value is string => typeof value === 'string')
      : [];
  }

  private async hasTargetedCancellation(
    settings: VideoProviderSettings,
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

  private baseUrl(settings: VideoProviderSettings): string {
    const value = new URL(settings.baseUrl);
    if (value.username || value.password)
      throw new VideoProviderError(
        'CONFIGURATION_ERROR',
        'ComfyUI URL cannot contain credentials',
        false,
      );
    return value.toString().replace(/\/$/u, '');
  }

  private async raw(
    settings: VideoProviderSettings,
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
        throw new VideoProviderError('CANCELLED', 'ComfyUI request cancelled', false);
      if (timedOut) throw new VideoProviderError('TIMEOUT', 'ComfyUI request timed out', true);
      throw new VideoProviderError(
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
    settings: VideoProviderSettings,
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.raw(settings, path, {}, timeoutMs, signal);
    if (response.status === 404)
      throw new VideoProviderError(
        'CONFIGURATION_ERROR',
        `ComfyUI endpoint not found: ${path}`,
        false,
      );
    if (!response.ok)
      throw new VideoProviderError(
        'PROVIDER_UNAVAILABLE',
        `ComfyUI endpoint failed: ${path}`,
        response.status >= 500,
      );
    return await this.responseJson(response);
  }

  private async array(
    settings: VideoProviderSettings,
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const payload = await this.json(settings, path, timeoutMs, signal);
    if (!Array.isArray(payload))
      throw new VideoProviderError(
        'CONFIGURATION_ERROR',
        'ComfyUI endpoint is not an array',
        false,
      );
    return payload.filter((item): item is string => typeof item === 'string');
  }
}

function detectOutOfMemory(record: ComfyHistoryRecord): boolean {
  try {
    return JSON.stringify(record).toLowerCase().includes('out of memory');
  } catch {
    return false;
  }
}

function readinessError(readiness: VideoReadiness): VideoProviderError {
  const code: VideoProviderFailure['code'] =
    readiness.status === 'NOT_CONFIGURED' || readiness.status === 'INSUFFICIENT_CONFIGURATION'
      ? 'CONFIGURATION_ERROR'
      : readiness.status === 'WORKFLOW_MISSING'
        ? 'WORKFLOW_INVALID'
        : readiness.status === 'VIDEO_MODEL_MISSING'
          ? 'MODEL_MISSING'
          : 'PROVIDER_UNAVAILABLE';
  return new VideoProviderError(
    code,
    readiness.message,
    readiness.status === 'COMFYUI_UNAVAILABLE' || readiness.status === 'VIDEO_MODEL_MISSING',
  );
}
