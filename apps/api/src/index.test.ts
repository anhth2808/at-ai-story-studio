import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseHandle } from '@studio/database';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  STUDIO_WORKSPACE: process.env.STUDIO_WORKSPACE,
  STUDIO_DB_PATH: process.env.STUDIO_DB_PATH,
};
let root: string;
let app: FastifyInstance;
let database: DatabaseHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-api-integration-'));
  process.env.NODE_ENV = 'test';
  process.env.STUDIO_WORKSPACE = root;
  process.env.STUDIO_DB_PATH = join(root, 'studio.db');
  // The API reads workspace/database environment variables during module initialization.
  const api = await import('./index.js');
  app = api.app;
  database = api.database;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  database.sqlite.close();
  await rm(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('API selective Prompt 15 routes', () => {
  it('maps project, Shot, reference, critic, backend, and production routes safely', async () => {
    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { title: 'API integration project' },
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = projectResponse.json<{ id: string }>();

    const profilesResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/production/profiles`,
    });
    expect(profilesResponse.statusCode).toBe(200);
    const profiles =
      profilesResponse.json<Array<{ key: string; settings: Record<string, unknown> }>>();
    expect(profiles.map((profile) => profile.key).sort()).toEqual([
      'AUTO',
      'BALANCED',
      'MANUAL_REVIEW',
    ]);
    expect(profiles.find((profile) => profile.key === 'AUTO')?.settings).toMatchObject({
      imageQualityGate: 'REQUIRED',
      videoQualityGate: 'REQUIRED',
    });

    const referencesResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/visual-references?targetKind=LOCATION&targetEntityId=missing-location`,
    });
    expect(referencesResponse.statusCode).toBe(200);
    expect(referencesResponse.json()).toEqual([]);

    const shotImagesResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/scenes/00000000-0000-4000-8000-000000000001/shots/shot-1/images/current`,
    });
    expect(shotImagesResponse.statusCode).toBe(404);

    const videoSettingsResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/video-settings`,
    });
    expect(videoSettingsResponse.statusCode).toBe(200);
    expect(videoSettingsResponse.json()).toHaveProperty('backend');

    const invalidProfileResponse = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/production/profiles/not-a-profile`,
      payload: {},
    });
    expect(invalidProfileResponse.statusCode).toBe(400);
    expect(invalidProfileResponse.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const serialized = `${profilesResponse.body}${videoSettingsResponse.body}`;
    expect(serialized).not.toContain(root);
    expect(serialized).not.toMatch(/[A-Za-z]:\\/u);
    expect(serialized).not.toMatch(/rawGraph|apiKey|secret|token/iu);
  });
});
