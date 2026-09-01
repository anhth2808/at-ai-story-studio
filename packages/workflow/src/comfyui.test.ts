import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageGenerationRequestSchema, type ImageProviderSettings } from '@studio/shared';
import {
  buildComfyUiPrompt,
  ComfyUiImageProvider,
  TEXT_TO_IMAGE_V1_NODE_IDS,
  validateComfyUiPrompt,
} from './comfyui.js';

const settings: ImageProviderSettings = {
  provider: 'COMFYUI',
  baseUrl: 'http://127.0.0.1:8188',
  workflowTemplate: 'text-to-image-v1',
  diffusionModel: 'flux.safetensors',
  textEncoder: 'qwen.safetensors',
  vaeName: 'vae.safetensors',
  sampler: 'euler',
  connectionTimeoutMs: 1_000,
  generationTimeoutMs: 10_000,
};

const stagingRoot = mkdtempSync(join(tmpdir(), 'comfyui-test-'));

const request = imageGenerationRequestSchema.parse({
  projectId: '11111111-1111-4111-8111-111111111111',
  sceneId: '22222222-2222-4222-8222-222222222222',
  visualPromptPackageId: '33333333-3333-4333-8333-333333333333',
  providerJobId: '44444444-4444-4444-8444-444444444444',
  prompt: 'A quiet river at dawn',
  negativePrompt: 'text',
  width: 1023,
  height: 577,
  seed: 42,
  steps: 20,
  guidance: 5,
  samplerHint: 'euler',
  referenceImages: [{ assetId: '55555555-5555-4555-8555-555555555555' }],
  providerSettings: settings,
});

function objectInfo(): Record<string, unknown> {
  const classes = [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'CLIPTextEncode',
    'RandomNoise',
    'KSamplerSelect',
    'Flux2Scheduler',
    'EmptyFlux2LatentImage',
    'CFGGuider',
    'SamplerCustomAdvanced',
    'VAEDecode',
    'SaveImage',
  ];
  return Object.fromEntries(
    classes.map((name) => [
      name,
      { input: { required: name === 'KSamplerSelect' ? { sampler_name: [['euler']] } : { value: ['STRING'] } } },
    ]),
  );
}

function fakeFetchFactory() {
  let submitted = false;
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const pathname = new URL(url).pathname;
    if (pathname === '/system_stats') return Response.json({ devices: [] });
    if (pathname === '/object_info') return Response.json(objectInfo());
    if (pathname === '/models/diffusion_models') return Response.json([settings.diffusionModel]);
    if (pathname === '/models/text_encoders') return Response.json([settings.textEncoder]);
    if (pathname === '/models/vae') return Response.json([settings.vaeName]);
    if (pathname === '/api/jobs') return Response.json({ jobs: [] });
    if (pathname === '/queue') return Response.json({ queue_pending: [], queue_running: [] });
    if (pathname === '/prompt') {
      submitted = true;
      return Response.json({ prompt_id: request.providerJobId });
    }
    if (pathname === `/history/${request.providerJobId}`)
      return submitted
        ? Response.json({
            [request.providerJobId]: {
              status: { status_str: 'success', completed: true },
              outputs: { '13': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } },
            },
          })
        : Response.json({});
    if (pathname === '/view') return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

describe('ComfyUI image provider', () => {
  it('builds only the controlled native graph and normalizes dimensions', () => {
    const prompt = buildComfyUiPrompt(request);
    validateComfyUiPrompt(prompt);
    expect(Object.keys(prompt)).toHaveLength(13);
    expect(prompt[TEXT_TO_IMAGE_V1_NODE_IDS.scheduler]?.inputs).toMatchObject({ width: 1024, height: 576 });
    expect(prompt[TEXT_TO_IMAGE_V1_NODE_IDS.save]?.class_type).toBe('SaveImage');
    expect(() =>
      validateComfyUiPrompt({
        ...prompt,
        '99': { class_type: 'SaveImage', inputs: {} },
      }),
    ).toThrow();
  });

  it('checks readiness, submits once, polls history, and downloads outputs', async () => {
    const fake = fakeFetchFactory();
    const provider = new ComfyUiImageProvider(
      stagingRoot,
      fake.fetchImpl,
      async () => undefined,
      () => 1_000,
    );
    const readiness = await provider.readiness(settings);
    expect(readiness.status).toBe('READY');
    const result = await provider.generate({ ...request, providerSettings: settings });
    expect(result.providerJobId).toBe(request.providerJobId);
    expect(result.images[0]?.mediaType).toBe('image/png');
    expect(fake.calls.filter((call) => call.includes('POST http://127.0.0.1:8188/prompt'))).toHaveLength(1);
    expect(result.warnings).toContain('REFERENCE_IMAGES_UNUSED');
  });

  it('reports unconfigured model components before contacting ComfyUI', async () => {
    const fake = fakeFetchFactory();
    const provider = new ComfyUiImageProvider(stagingRoot, fake.fetchImpl);
    const readiness = await provider.readiness({ ...settings, vaeName: '' });
    expect(readiness.status).toBe('NOT_CONFIGURED');
    expect(fake.calls).toHaveLength(0);
  });

  it('reports a missing controlled node as an invalid workflow', async () => {
    const provider = new ComfyUiImageProvider(stagingRoot, async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/system_stats') return Response.json({ devices: [] });
      if (pathname === '/object_info') {
        const info = objectInfo();
        delete info.SaveImage;
        return Response.json(info);
      }
      return new Response('not found', { status: 404 });
    });
    const readiness = await provider.readiness(settings);
    expect(readiness.status).toBe('INVALID_WORKFLOW');
    expect(readiness.details).toEqual({ missingNodes: ['SaveImage'] });
  });

  it('cancels only the addressed provider job when supported', async () => {
    const fake = fakeFetchFactory();
    const provider = new ComfyUiImageProvider(stagingRoot, fake.fetchImpl);
    expect((await provider.readiness(settings)).supportsCancellation).toBe(true);
    await provider.cancel(request.providerJobId, settings);
    expect(fake.calls).toContain(
      `POST http://127.0.0.1:8188/api/jobs/${request.providerJobId}/cancel`,
    );
    expect(fake.calls.some((call) => call.includes('/interrupt'))).toBe(false);
  });
});
