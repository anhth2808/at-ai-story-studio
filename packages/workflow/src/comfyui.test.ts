import { mkdtempSync, writeFileSync } from 'node:fs';
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
  return Object.fromEntries([
    ...classes.map((name) => [
      name,
      {
        input: {
          required:
            name === 'KSamplerSelect' ? { sampler_name: [['euler']] } : { value: ['STRING'] },
        },
      },
    ]),
    ...['LoadImage', 'ImageScaleToTotalPixels', 'VAEEncode', 'ReferenceLatent'].map((name) => [
      name,
      { input: { required: { value: ['STRING'] } } },
    ]),
  ]);
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
              outputs: {
                '13': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] },
              },
            },
          })
        : Response.json({});
    if (pathname === '/view')
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

describe('ComfyUI image provider', () => {
  it('builds only the controlled native graph and normalizes dimensions', () => {
    const prompt = buildComfyUiPrompt(request);
    validateComfyUiPrompt(prompt);
    expect(Object.keys(prompt)).toHaveLength(13);
    expect(prompt[TEXT_TO_IMAGE_V1_NODE_IDS.scheduler]?.inputs).toMatchObject({
      width: 1024,
      height: 576,
    });
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
    expect(
      fake.calls.filter((call) => call.includes('POST http://127.0.0.1:8188/prompt')),
    ).toHaveLength(1);
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

const conditioningCharacter = {
  characterId: 'li-wei',
  referenceAssetId: '66666666-6666-4666-8666-666666666666',
  referenceSha256: 'a'.repeat(64),
  referencePath: 'ref.png',
  profileRevision: 1,
};

function conditionedRequest(overrides: Partial<typeof conditioningCharacter> = {}) {
  return imageGenerationRequestSchema.parse({
    ...request,
    providerSettings: { ...settings, workflowTemplate: 'reference-character-v1' },
    conditioning: {
      mode: 'REFERENCE_CONDITIONED',
      characters: [{ ...conditioningCharacter, ...overrides }],
    },
  });
}

describe('ComfyUI reference conditioning', () => {
  it('builds and validates the reference graph for one and two characters', () => {
    for (const count of [1, 2]) {
      const characters = Array.from({ length: count }, (_, index) => ({
        ...conditioningCharacter,
        characterId: `character-${index}`,
      }));
      const prompt = buildComfyUiPrompt(
        imageGenerationRequestSchema.parse({
          ...request,
          providerSettings: { ...settings, workflowTemplate: 'reference-character-v1' },
          conditioning: { mode: 'REFERENCE_CONDITIONED', characters },
        }),
        characters.map(() => 'upload.png'),
      );
      validateComfyUiPrompt(prompt, 'reference-character-v1');
      expect(Object.keys(prompt)).toHaveLength(13 + count * 5);
      const lastRef = String(50 + count - 1);
      expect(prompt['10']?.inputs.positive).toEqual([lastRef, 0]);
      expect(prompt['60']?.inputs.conditioning).toEqual(['5', 0]);
      expect(prompt[String(50)]?.inputs.conditioning).toEqual(['4', 0]);
      expect(prompt['20']?.inputs).toEqual({ image: 'upload.png' });
    }
  });

  it('rejects conditioned prompts without one file per character', () => {
    expect(() => buildComfyUiPrompt(conditionedRequest())).toThrow(/one uploaded reference file/);
    const tampered = buildComfyUiPrompt(conditionedRequest(), ['a.png']);
    tampered['10']!.inputs.positive = ['4', 0];
    expect(() => validateComfyUiPrompt(tampered, 'reference-character-v1')).toThrow(
      /link 10\.positive/,
    );
  });

  it('streams references through the upload API and uses returned names', async () => {
    const fileRoot = mkdtempSync(join(tmpdir(), 'comfyui-refs-'));
    writeFileSync(join(fileRoot, 'ref.png'), Buffer.from([0x89, 0x50]));
    const bodies: string[] = [];
    const fake = fakeFetchFactory();
    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (new URL(String(input)).pathname === '/upload/image') {
        const chunks: Buffer[] = [];
        for await (const chunk of init?.body as AsyncIterable<Buffer>) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('latin1');
        bodies.push(body);
        fake.calls.push(`POST ${String(input)}`);
        return Response.json({ name: 'returned-1.png', subfolder: 'studio-refs', type: 'input' });
      }
      return fake.fetchImpl(input, init);
    };
    const provider = new ComfyUiImageProvider(
      stagingRoot,
      fetchImpl,
      async () => undefined,
      () => 1_000,
      fileRoot,
    );
    const result = await provider.generate(conditionedRequest());
    expect(
      fake.calls.some((call) => call.includes('POST http://127.0.0.1:8188/upload/image')),
    ).toBe(true);
    expect(bodies[0]).toContain('filename="');
    expect(bodies[0]).toContain('name="image"');
    expect(bodies[0]).toContain(Buffer.from([0x89, 0x50]).toString('latin1'));
    expect(result.metadata.mappingVersion).toBe('reference-character-v1-mapping-1');
    expect(result.warnings).not.toContain('REFERENCE_IMAGES_UNUSED');
    expect(result.metadata.conditioning).toMatchObject({
      mode: 'REFERENCE_CONDITIONED',
      characters: [
        { characterId: 'li-wei', referenceAssetId: conditioningCharacter.referenceAssetId },
      ],
    });
  });

  it('classifies upload failures as retryable reference errors', async () => {
    const fileRoot = mkdtempSync(join(tmpdir(), 'comfyui-refs-'));
    writeFileSync(join(fileRoot, 'ref.png'), Buffer.from([0x89, 0x50]));
    const provider = new ComfyUiImageProvider(
      stagingRoot,
      async (input, init) => {
        if (new URL(String(input)).pathname === '/upload/image')
          return new Response('server error', { status: 500 });
        return fakeFetchFactory().fetchImpl(input, init);
      },
      async () => undefined,
      () => 1_000,
      fileRoot,
    );
    await expect(provider.generate(conditionedRequest())).rejects.toMatchObject({
      code: 'REFERENCE_UPLOAD_FAILED',
      retryable: true,
    });
  });

  it('reports conditioning readiness separately from text-only readiness', async () => {
    const withoutReferenceLatent = async (input: string | URL): Promise<Response> => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/system_stats') return Response.json({ devices: [] });
      if (pathname === '/object_info') {
        const info = objectInfo();
        delete info.ReferenceLatent;
        return Response.json(info);
      }
      if (pathname === '/models/diffusion_models') return Response.json([settings.diffusionModel]);
      if (pathname === '/models/text_encoders') return Response.json([settings.textEncoder]);
      if (pathname === '/models/vae') return Response.json([settings.vaeName]);
      return new Response('not found', { status: 404 });
    };
    const provider = new ComfyUiImageProvider(stagingRoot, withoutReferenceLatent);
    const conditioned = await provider.readiness({
      ...settings,
      conditioningMode: 'REFERENCE_CONDITIONED',
    });
    expect(conditioned.status).toBe('INVALID_WORKFLOW');
    expect(conditioned.details.conditioning).toMatchObject({
      status: 'REFERENCE_NODE_MISSING',
      missingNodes: ['ReferenceLatent'],
    });
    const textOnly = await provider.readiness({ ...settings, conditioningMode: 'TEXT_ONLY' });
    expect(textOnly.status).toBe('READY');
    expect(textOnly.details.conditioning).toMatchObject({ status: 'REFERENCE_NODE_MISSING' });
  });
});
