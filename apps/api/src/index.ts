import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createDatabase, migrateDatabase } from '@studio/database';
import {
  initializeWorkspace,
  ProcessRunner,
  FfmpegTools,
  reconcileWorkspace,
  validateMediaFile,
  safeWorkspacePath,
  sha256File,
  contentTypeFor,
  relativeAssetPath,
  prepareProjectDirectories,
} from '@studio/media';
import {
  AppError,
  chapterInputSchema,
  chapterPlanItemSchema,
  idSchema,
  projectInputSchema,
  reorderSchema,
  renderConfigSchema,
  storyBlueprintSchema,
  storyArcSchema,
  storyContinuityRebuildRequestSchema,
  storyGenerationBatchRequestSchema,
  storyGenerationBatchSkipRequestSchema,
  storyGenerationRequestSchema,
  storyPlanWindowRequestSchema,
  storyPlanWindowResultSchema,
  storySettingsSchema,
  storyStableIdSchema,
  sceneBatchRequestSchema,
  sceneEditSchema,
  sceneGenerationRequestSchema,
  scenePromptRequestSchema,
  sceneRegenerationRequestSchema,
  sceneStatusSchema,
  visualStyleUpdateSchema,
  visualProfileGenerateRequestSchema,
  visualProfileUpdateSchema,
  visualProfileApprovalSchema,
  visualPromptRefinementRequestSchema,
  sceneObjectResolutionUpdateSchema,
  visualObjectKeySchema,
  visualProfileReferenceUpdateSchema,
  visualStylePresets,
  visualStylePresetSchema,
  locationSchema,
  locationUpdateSchema,
  subtitleReplacementSchema,
} from '@studio/shared';
import type { OmpReadiness } from '@studio/shared';
import { StudioService, createOmpAgent, createStoryEngine, parseSrt } from '@studio/workflow';
import { WorkflowRepository } from '@studio/database';
import { createReadStream, createWriteStream, readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const port = Number(process.env.PORT ?? 3001);
const root =
  process.env.STUDIO_WORKSPACE ??
  join(dirname(fileURLToPath(import.meta.url)), '../../../workspace');
const dbFilename = process.env.STUDIO_DB_PATH ?? join(root, 'studio.db');
const database = createDatabase(dbFilename);
migrateDatabase(database);
const workspace = await initializeWorkspace(root);
await reconcileWorkspace(workspace);
const runner = new ProcessRunner();
const media = new FfmpegTools(runner);
const context = { database, workspace, media, runner };
const service = new StudioService(context);
const ompAgent = createOmpAgent(runner);
const storyEngine = createStoryEngine({ database, agent: ompAgent });
let ompReadinessCache: { value: OmpReadiness; cachedAt: number } | null = null;
let ompReadinessRequest: Promise<OmpReadiness> | null = null;
const getOmpReadiness = async (): Promise<OmpReadiness> => {
  if (ompReadinessCache && Date.now() - ompReadinessCache.cachedAt < 5_000) {
    return ompReadinessCache.value;
  }
  if (!ompReadinessRequest) {
    ompReadinessRequest = ompAgent
      .readiness()
      .then((value) => {
        ompReadinessCache = { value, cachedAt: Date.now() };
        return value;
      })
      .finally(() => {
        ompReadinessRequest = null;
      });
  }
  return ompReadinessRequest;
};
function parsePageValue(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum)
    throw new AppError('INVALID_INPUT', 'Pagination value is invalid', 400);
  return parsed;
}
function parseChapterStatus(
  value: string | undefined,
): 'FAILED' | 'PENDING' | 'CONTINUITY_STALE' | 'WARN' | '' {
  if (value === undefined || value === '') return '';
  if (value === 'FAILED' || value === 'PENDING' || value === 'CONTINUITY_STALE' || value === 'WARN')
    return value;
  throw new AppError('INVALID_INPUT', 'Chapter status filter is invalid', 400);
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 1_000_000_000 } });
app.get('/api/health', async () => {
  const tools = await media.health();
  const heartbeat = database.sqlite
    .prepare('SELECT last_seen_at FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1')
    .get() as { last_seen_at: string } | undefined;
  const workerOk = Boolean(heartbeat && Date.now() - Date.parse(heartbeat.last_seen_at) < 10_000);
  const checks = {
    api: { ok: true, message: 'API is running' },
    database: { ok: true, message: 'SQLite is available' },
    worker: {
      ok: workerOk,
      message: workerOk ? 'Worker heartbeat is current' : 'Worker is not connected',
    },
    ffmpeg: { ok: tools.ffmpeg, message: tools.message },
    ffprobe: { ok: tools.ffprobe, message: tools.message },
    workspace: { ok: true, message: workspace.root },
  };
  return {
    status: Object.values(checks).every((check) => check.ok) ? 'ready' : 'degraded',
    checks,
  };
});
async function storySnapshot(
  projectId: string,
  summaryLimit = 50,
  summaryOffset = 0,
  planLimit = 20,
  planOffset = 0,
  windowLimit = 100,
  windowOffset = 0,
) {
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const snapshot = service.story.snapshot(projectId, {
    summaryLimit,
    summaryOffset,
    planLimit,
    planOffset,
    windowLimit,
    windowOffset,
  });
  const jobs = database.sqlite
    .prepare(
      'SELECT j.id,j.type,j.entity_id as entityId,j.status,j.progress,j.error,j.attempts FROM jobs j JOIN workflow_steps s ON s.id=j.step_id JOIN workflow_executions e ON e.id=s.execution_id WHERE e.project_id=? ORDER BY j.created_at DESC LIMIT 200',
    )
    .all(projectId);
  return { ...snapshot, jobs, omp: await getOmpReadiness() };
}
app.get('/api/projects/:projectId/story', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as {
    summaryLimit?: string;
    summaryOffset?: string;
    planLimit?: string;
    planOffset?: string;
    windowLimit?: string;
    windowOffset?: string;
  };
  return storySnapshot(
    idSchema.parse(params.projectId),
    parsePageValue(query.summaryLimit, 50, 200),
    parsePageValue(query.summaryOffset, 0, Number.MAX_SAFE_INTEGER),
    parsePageValue(query.planLimit, 20, 200),
    parsePageValue(query.planOffset, 0, Number.MAX_SAFE_INTEGER),
    parsePageValue(query.windowLimit, 100, 200),
    parsePageValue(query.windowOffset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/story/readiness', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  return getOmpReadiness();
});
app.get('/api/projects/:projectId/story/settings', async (request) => {
  const params = request.params as { projectId: string };
  return storyEngine.getSettings(idSchema.parse(params.projectId));
});
app.get('/api/projects/:projectId/story/blueprint', async (request) => {
  const params = request.params as { projectId: string };
  return storyEngine.getBlueprint(idSchema.parse(params.projectId));
});
app.get('/api/projects/:projectId/story/plan', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as { limit?: string; offset?: string };
  return storyEngine.getPlan(
    idSchema.parse(params.projectId),
    parsePageValue(query.limit, 20, 200),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/story/arcs', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  return service.story.getArcs(projectId);
});
app.post('/api/projects/:projectId/story/arcs/generate', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply.code(202).send(service.scheduleStoryArcs(idSchema.parse(params.projectId)));
});
app.put('/api/projects/:projectId/story/arcs/:arcId', async (request) => {
  const params = request.params as { projectId: string; arcId: string };
  return service.updateArc(
    idSchema.parse(params.projectId),
    storyStableIdSchema.parse(params.arcId),
    storyArcSchema.parse(request.body),
  );
});

app.get('/api/projects/:projectId/story/plan-windows', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  const query = request.query as { limit?: string; offset?: string };
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  return service.story.getPlanWindowSummaries(
    projectId,
    parsePageValue(query.limit, 100, 200),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/story/plan-windows/:windowId', async (request) => {
  const params = request.params as { projectId: string; windowId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const window = service.story.getPlanWindow(projectId, storyStableIdSchema.parse(params.windowId));
  if (!window) throw new AppError('NOT_FOUND', 'Plan window not found', 404);
  return window;
});
app.post('/api/projects/:projectId/story/plan-windows/generate', async (request, reply) => {
  const params = request.params as { projectId: string };
  const body = storyPlanWindowRequestSchema.parse(request.body);
  return reply
    .code(202)
    .send(
      service.scheduleStoryPlanWindow(
        idSchema.parse(params.projectId),
        body.arcId,
        body.startChapter,
        body.endChapter,
      ),
    );
});
app.put('/api/projects/:projectId/story/plan-windows/:windowId', async (request) => {
  const params = request.params as { projectId: string; windowId: string };
  return service.updatePlanWindow(
    idSchema.parse(params.projectId),
    storyStableIdSchema.parse(params.windowId),
    storyPlanWindowResultSchema.parse(request.body),
  );
});

app.get('/api/projects/:projectId/scenes', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as { limit?: string; offset?: string; status?: string };
  const status =
    query.status === undefined || query.status === '' ? '' : sceneStatusSchema.parse(query.status);
  return service.listSceneChapters(
    idSchema.parse(params.projectId),
    parsePageValue(query.limit, 25, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
    status,
  );
});
app.get('/api/projects/:projectId/chapters/:chapterId/scenes', async (request) => {
  const params = request.params as { projectId: string; chapterId: string };
  const query = request.query as { limit?: string; offset?: string; excerpt?: string };
  return service.listScenes(
    idSchema.parse(params.projectId),
    idSchema.parse(params.chapterId),
    parsePageValue(query.limit, 100, 200),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
    query.excerpt === 'true',
  );
});
app.get('/api/projects/:projectId/scenes/:sceneId', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  return service.getScene(idSchema.parse(params.projectId), idSchema.parse(params.sceneId));
});
app.put('/api/projects/:projectId/scenes/:sceneId', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  return service.updateScene(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    sceneEditSchema.parse(request.body),
  );
});
app.post('/api/projects/:projectId/chapters/:chapterId/scenes/generate', async (request, reply) => {
  const params = request.params as { projectId: string; chapterId: string };
  return reply
    .code(202)
    .send(
      service.scheduleSceneGeneration(
        idSchema.parse(params.projectId),
        idSchema.parse(params.chapterId),
        sceneGenerationRequestSchema.parse(request.body ?? {}),
      ),
    );
});
app.post('/api/projects/:projectId/scenes/:sceneId/regenerate', async (request, reply) => {
  const params = request.params as { projectId: string; sceneId: string };
  return reply
    .code(202)
    .send(
      service.scheduleSceneRegeneration(
        idSchema.parse(params.projectId),
        idSchema.parse(params.sceneId),
        sceneRegenerationRequestSchema.parse(request.body ?? {}),
      ),
    );
});
app.post('/api/projects/:projectId/scenes/:sceneId/prompt', async (request, reply) => {
  const params = request.params as { projectId: string; sceneId: string };
  return reply
    .code(202)
    .send(
      service.scheduleScenePromptRefresh(
        idSchema.parse(params.projectId),
        idSchema.parse(params.sceneId),
        scenePromptRequestSchema.parse(request.body ?? {}),
      ),
    );
});
app.get('/api/chapters/:chapterId/scenes', async (request) => {
  const params = request.params as { chapterId: string };
  const chapter = service.getChapter(idSchema.parse(params.chapterId));
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const query = request.query as { limit?: string; offset?: string; excerpt?: string };
  return service.listScenes(
    chapter.projectId,
    chapter.id,
    parsePageValue(query.limit, 100, 200),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
    query.excerpt === 'true',
  );
});
app.get('/api/scenes/:sceneId', async (request) => {
  const params = request.params as { sceneId: string };
  return service.getSceneById(idSchema.parse(params.sceneId));
});
app.patch('/api/scenes/:sceneId', async (request) => {
  const params = request.params as { sceneId: string };
  const scene = service.getSceneById(idSchema.parse(params.sceneId));
  return service.updateScene(scene.projectId, scene.id, sceneEditSchema.parse(request.body));
});
app.post('/api/chapters/:chapterId/scenes/generate', async (request, reply) => {
  const params = request.params as { chapterId: string };
  const chapter = service.getChapter(idSchema.parse(params.chapterId));
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  return reply
    .code(202)
    .send(
      service.scheduleSceneGeneration(
        chapter.projectId,
        chapter.id,
        sceneGenerationRequestSchema.parse(request.body ?? {}),
      ),
    );
});
app.post('/api/scenes/:sceneId/regenerate', async (request, reply) => {
  const params = request.params as { sceneId: string };
  const scene = service.getSceneById(idSchema.parse(params.sceneId));
  return reply
    .code(202)
    .send(
      service.scheduleSceneRegeneration(
        scene.projectId,
        scene.id,
        sceneRegenerationRequestSchema.parse(request.body ?? {}),
      ),
    );
});
app.post('/api/scenes/:sceneId/prompt', async (request, reply) => {
  const params = request.params as { sceneId: string };
  const scene = service.getSceneById(idSchema.parse(params.sceneId));
  return reply
    .code(202)
    .send(
      service.scheduleScenePromptRefresh(
        scene.projectId,
        scene.id,
        scenePromptRequestSchema.parse(request.body ?? {}),
      ),
    );
});
app.post('/api/projects/:projectId/scenes/batch', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply
    .code(202)
    .send(
      service.scheduleSceneBatch(
        idSchema.parse(params.projectId),
        sceneBatchRequestSchema.parse(request.body),
      ),
    );
});
app.get('/api/projects/:projectId/visual-style', async (request) => {
  const params = request.params as { projectId: string };
  return service.getVisualStyle(idSchema.parse(params.projectId));
});
app.put('/api/projects/:projectId/visual-style', async (request) => {
  const params = request.params as { projectId: string };
  return service.saveVisualStyle(
    idSchema.parse(params.projectId),
    visualStyleUpdateSchema.parse(request.body),
  );
});
app.get('/api/projects/:projectId/locations', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.listLocations(
    idSchema.parse(params.projectId),
    parsePageValue(query.limit, 100, 200),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.post('/api/projects/:projectId/locations', async (request) => {
  const params = request.params as { projectId: string };
  return service.createLocation(
    idSchema.parse(params.projectId),
    locationSchema.parse(request.body),
  );
});
app.put('/api/projects/:projectId/locations/:locationId', async (request) => {
  const params = request.params as { projectId: string; locationId: string };
  return service.updateLocation(
    idSchema.parse(params.projectId),
    idSchema.parse(params.locationId),
    locationUpdateSchema.parse(request.body),
  );
});

app.get('/api/projects/:projectId/visual-bible', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  const query = request.query as { limit?: string; offset?: string };
  const limit = parsePageValue(query.limit, 50, 100);
  const offset = parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER);
  return {
    style: service.visual.getStyleBible(projectId),
    characters: service.visual.listCharacterProfiles(projectId, limit, offset),
    locations: service.visual.listLocationProfiles(projectId, limit, offset),
    objects: service.visual.listObjectProfiles(projectId, limit, offset),
  };
});
app.get('/api/projects/:projectId/visual-bible/style/revisions', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.visual.listStyleBibleRevisions(
    idSchema.parse(params.projectId),
    parsePageValue(query.limit, 100, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.post('/api/projects/:projectId/visual-bible/style/preset', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  const body = request.body as { preset?: unknown };
  const preset = visualStylePresetSchema.parse(body?.preset);
  const current = service.getVisualStyle(projectId);
  return service.saveVisualStyle(projectId, {
    ...visualStylePresets[preset],
    ...(current ? { expectedRevision: current.revision } : {}),
  });
});
app.get('/api/projects/:projectId/visual-bible/characters', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.visual.listCharacterProfiles(
    idSchema.parse(params.projectId),
    parsePageValue(query.limit, 50, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/visual-bible/characters/:characterId', async (request) => {
  const params = request.params as { projectId: string; characterId: string };
  const profile = service.visual.getCharacterProfile(
    idSchema.parse(params.projectId),
    storyStableIdSchema.parse(params.characterId),
  );
  if (!profile) throw new AppError('NOT_FOUND', 'Character visual profile not found', 404);
  return profile;
});
app.get(
  '/api/projects/:projectId/visual-bible/characters/:characterId/revisions',
  async (request) => {
    const params = request.params as { projectId: string; characterId: string };
    const query = request.query as { limit?: string; offset?: string };
    return service.visual.listCharacterProfileRevisions(
      idSchema.parse(params.projectId),
      storyStableIdSchema.parse(params.characterId),
      parsePageValue(query.limit, 50, 100),
      parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
    );
  },
);
app.post(
  '/api/projects/:projectId/visual-bible/characters/:characterId/generate',
  async (request, reply) => {
    const params = request.params as { projectId: string; characterId: string };
    return reply
      .code(202)
      .send(
        service.scheduleVisualProfileGeneration(
          idSchema.parse(params.projectId),
          'CHARACTER',
          storyStableIdSchema.parse(params.characterId),
          visualProfileGenerateRequestSchema.parse(request.body ?? {}),
        ),
      );
  },
);
app.put('/api/projects/:projectId/visual-bible/characters/:characterId', async (request) => {
  const params = request.params as { projectId: string; characterId: string };
  return service.visual.updateCharacterProfile(
    idSchema.parse(params.projectId),
    storyStableIdSchema.parse(params.characterId),
    visualProfileUpdateSchema.parse(request.body),
  );
});
app.put(
  '/api/projects/:projectId/visual-bible/characters/:characterId/references',
  async (request) => {
    const params = request.params as { projectId: string; characterId: string };
    return service.visual.updateCharacterProfileReferences(
      idSchema.parse(params.projectId),
      storyStableIdSchema.parse(params.characterId),
      visualProfileReferenceUpdateSchema.parse(request.body),
    );
  },
);
app.post(
  '/api/projects/:projectId/visual-bible/characters/:characterId/approve',
  async (request) => {
    const params = request.params as { projectId: string; characterId: string };
    const body = visualProfileApprovalSchema.parse(request.body);
    return service.visual.approveCharacterProfile(
      idSchema.parse(params.projectId),
      storyStableIdSchema.parse(params.characterId),
      body.expectedRevision,
    );
  },
);
app.get('/api/projects/:projectId/visual-bible/locations', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.visual.listLocationProfiles(
    idSchema.parse(params.projectId),
    parsePageValue(query.limit, 50, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/visual-bible/locations/:locationId', async (request) => {
  const params = request.params as { projectId: string; locationId: string };
  const profile = service.visual.getLocationProfile(
    idSchema.parse(params.projectId),
    idSchema.parse(params.locationId),
  );
  if (!profile) throw new AppError('NOT_FOUND', 'Location visual profile not found', 404);
  return profile;
});
app.get(
  '/api/projects/:projectId/visual-bible/locations/:locationId/revisions',
  async (request) => {
    const params = request.params as { projectId: string; locationId: string };
    const query = request.query as { limit?: string; offset?: string };
    return service.visual.listLocationProfileRevisions(
      idSchema.parse(params.projectId),
      idSchema.parse(params.locationId),
      parsePageValue(query.limit, 50, 100),
      parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
    );
  },
);
app.post(
  '/api/projects/:projectId/visual-bible/locations/:locationId/generate',
  async (request, reply) => {
    const params = request.params as { projectId: string; locationId: string };
    return reply
      .code(202)
      .send(
        service.scheduleVisualProfileGeneration(
          idSchema.parse(params.projectId),
          'LOCATION',
          idSchema.parse(params.locationId),
          visualProfileGenerateRequestSchema.parse(request.body ?? {}),
        ),
      );
  },
);
app.put('/api/projects/:projectId/visual-bible/locations/:locationId', async (request) => {
  const params = request.params as { projectId: string; locationId: string };
  return service.visual.updateLocationProfile(
    idSchema.parse(params.projectId),
    idSchema.parse(params.locationId),
    visualProfileUpdateSchema.parse(request.body),
  );
});
app.put(
  '/api/projects/:projectId/visual-bible/locations/:locationId/references',
  async (request) => {
    const params = request.params as { projectId: string; locationId: string };
    return service.visual.updateLocationProfileReferences(
      idSchema.parse(params.projectId),
      idSchema.parse(params.locationId),
      visualProfileReferenceUpdateSchema.parse(request.body),
    );
  },
);
app.post('/api/projects/:projectId/visual-bible/locations/:locationId/approve', async (request) => {
  const params = request.params as { projectId: string; locationId: string };
  const body = visualProfileApprovalSchema.parse(request.body);
  return service.visual.approveLocationProfile(
    idSchema.parse(params.projectId),
    idSchema.parse(params.locationId),
    body.expectedRevision,
  );
});
app.get('/api/projects/:projectId/visual-bible/objects', async (request) => {
  const params = request.params as { projectId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.visual.listObjectProfiles(
    idSchema.parse(params.projectId),
    parsePageValue(query.limit, 50, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/visual-bible/objects/:objectKey/revisions', async (request) => {
  const params = request.params as { projectId: string; objectKey: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.visual.listObjectProfileRevisions(
    idSchema.parse(params.projectId),
    visualObjectKeySchema.parse(params.objectKey),
    parsePageValue(query.limit, 50, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/visual-bible/objects/:objectKey', async (request) => {
  const params = request.params as { projectId: string; objectKey: string };
  const profile = service.visual.getObjectProfile(
    idSchema.parse(params.projectId),
    visualObjectKeySchema.parse(params.objectKey),
  );
  if (!profile) throw new AppError('NOT_FOUND', 'Object visual profile not found', 404);
  return profile;
});
app.post(
  '/api/projects/:projectId/visual-bible/objects/:objectKey/generate',
  async (request, reply) => {
    const params = request.params as { projectId: string; objectKey: string };
    return reply
      .code(202)
      .send(
        service.scheduleVisualProfileGeneration(
          idSchema.parse(params.projectId),
          'OBJECT',
          visualObjectKeySchema.parse(params.objectKey),
          visualProfileGenerateRequestSchema.parse(request.body ?? {}),
        ),
      );
  },
);
app.put('/api/projects/:projectId/visual-bible/objects/:objectKey', async (request) => {
  const params = request.params as { projectId: string; objectKey: string };
  return service.visual.updateObjectProfile(
    idSchema.parse(params.projectId),
    visualObjectKeySchema.parse(params.objectKey),
    visualProfileUpdateSchema.parse(request.body),
  );
});
app.put('/api/projects/:projectId/visual-bible/objects/:objectKey/references', async (request) => {
  const params = request.params as { projectId: string; objectKey: string };
  return service.visual.updateObjectProfileReferences(
    idSchema.parse(params.projectId),
    visualObjectKeySchema.parse(params.objectKey),
    visualProfileReferenceUpdateSchema.parse(request.body),
  );
});
app.post('/api/projects/:projectId/visual-bible/objects/:objectKey/approve', async (request) => {
  const params = request.params as { projectId: string; objectKey: string };
  const body = visualProfileApprovalSchema.parse(request.body);
  return service.visual.approveObjectProfile(
    idSchema.parse(params.projectId),
    visualObjectKeySchema.parse(params.objectKey),
    body.expectedRevision,
  );
});
app.get('/api/projects/:projectId/scenes/:sceneId/visual-prompt-package', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  const packageDto = service.visual.getCurrentPromptPackage(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
  );
  if (!packageDto) throw new AppError('NOT_FOUND', 'Visual prompt package not found', 404);
  return packageDto;
});
app.post(
  '/api/projects/:projectId/scenes/:sceneId/visual-prompt-package/rebuild',
  async (request, reply) => {
    const params = request.params as { projectId: string; sceneId: string };
    return reply
      .code(202)
      .send(
        service.scheduleVisualPromptBuild(
          idSchema.parse(params.projectId),
          idSchema.parse(params.sceneId),
        ),
      );
  },
);
app.get('/api/projects/:projectId/scenes/:sceneId/visual-object-resolutions', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  return service.visual.listSceneObjectResolutions(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
  );
});
app.put(
  '/api/projects/:projectId/scenes/:sceneId/visual-object-resolutions/:sourceLabel',
  async (request) => {
    const params = request.params as { projectId: string; sceneId: string; sourceLabel: string };
    return service.visual.saveSceneObjectResolution(
      idSchema.parse(params.projectId),
      idSchema.parse(params.sceneId),
      params.sourceLabel,
      sceneObjectResolutionUpdateSchema.parse(request.body),
    );
  },
);
app.get('/api/projects/:projectId/chapters/:chapterId/visual-prompt-packages', async (request) => {
  const params = request.params as { projectId: string; chapterId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.visual.listChapterPromptPackages(
    idSchema.parse(params.projectId),
    idSchema.parse(params.chapterId),
    parsePageValue(query.limit, 100, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.post(
  '/api/projects/:projectId/chapters/:chapterId/visual-prompt-packages/rebuild',
  async (request, reply) => {
    const params = request.params as { projectId: string; chapterId: string };
    const query = request.query as { limit?: string; offset?: string };
    return reply
      .code(202)
      .send(
        service.scheduleVisualPromptBatch(
          idSchema.parse(params.projectId),
          idSchema.parse(params.chapterId),
          parsePageValue(query.limit, 200, 200),
          parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
        ),
      );
  },
);
app.get('/api/projects/:projectId/visual-prompt-packages/:packageId', async (request) => {
  const params = request.params as { projectId: string; packageId: string };
  const packageDto = service.visual.getPromptPackage(
    idSchema.parse(params.projectId),
    idSchema.parse(params.packageId),
  );
  if (!packageDto) throw new AppError('NOT_FOUND', 'Visual prompt package not found', 404);
  return packageDto;
});
app.post(
  '/api/projects/:projectId/visual-prompt-packages/:packageId/refine',
  async (request, reply) => {
    const params = request.params as { projectId: string; packageId: string };
    return reply
      .code(202)
      .send(
        service.scheduleVisualPromptRefinement(
          idSchema.parse(params.projectId),
          idSchema.parse(params.packageId),
          visualPromptRefinementRequestSchema.parse(request.body ?? {}),
        ),
      );
  },
);
app.get('/api/projects/:projectId/story/state', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  return service.story.getStoryState(projectId);
});
app.put('/api/projects/:projectId/story/blueprint', async (request) => {
  const params = request.params as { projectId: string };
  return storyEngine.updateBlueprint(
    idSchema.parse(params.projectId),
    storyBlueprintSchema.parse(request.body),
  );
});
app.put('/api/projects/:projectId/story/plan/items/:planItemId', async (request) => {
  const params = request.params as { projectId: string; planItemId: string };
  return storyEngine.updatePlanItem(
    idSchema.parse(params.projectId),
    storyStableIdSchema.parse(params.planItemId),
    chapterPlanItemSchema.parse(request.body),
  );
});
app.get('/api/projects/:projectId/story/summaries', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const query = request.query as { limit?: string; offset?: string };
  return service.story.getSummaries(
    projectId,
    parsePageValue(query.limit, 50, 200),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.put('/api/projects/:projectId/story/settings', async (request) => {
  const params = request.params as { projectId: string };
  return storyEngine.saveSettings(
    idSchema.parse(params.projectId),
    storySettingsSchema.parse(request.body),
  );
});
app.post('/api/projects/:projectId/story/generate', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply.code(202).send(service.scheduleStoryStages(idSchema.parse(params.projectId)));
});
app.post('/api/projects/:projectId/story/blueprint/generate', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply.code(202).send(service.scheduleStoryBlueprint(idSchema.parse(params.projectId)));
});
app.post('/api/projects/:projectId/story/plans/generate', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply.code(202).send(service.scheduleStoryPlans(idSchema.parse(params.projectId)));
});
app.post('/api/projects/:projectId/story/chapters/:planItemId/generate', async (request, reply) => {
  const params = request.params as { projectId: string; planItemId: string };
  const projectId = idSchema.parse(params.projectId);
  const planItemId = storyStableIdSchema.parse(params.planItemId);
  const body = storyGenerationRequestSchema.parse(request.body ?? {});
  const plan = service.story.getPlan(projectId);
  if (
    body.expectedPlanRevision !== undefined &&
    body.expectedPlanRevision !== null &&
    plan?.revision !== body.expectedPlanRevision
  )
    throw new AppError('REVISION_CONFLICT', 'Chapter plan revision is stale', 409);
  const chapter = service.chapters.getByPlanItem(projectId, planItemId);
  if (
    body.expectedChapterRevision !== undefined &&
    chapter?.revision !== body.expectedChapterRevision
  )
    throw new AppError('REVISION_CONFLICT', 'Chapter revision is stale', 409);
  return reply.code(202).send(service.scheduleStoryChapter(projectId, planItemId));
});
app.post(
  '/api/projects/:projectId/story/chapters/:planItemId/generate-v2',
  async (request, reply) => {
    const params = request.params as { projectId: string; planItemId: string };
    const projectId = idSchema.parse(params.projectId);
    const planItemId = storyStableIdSchema.parse(params.planItemId);
    const body = storyGenerationRequestSchema.parse(request.body ?? {});
    const plan = service.story.getPlan(projectId);
    if (
      body.expectedPlanRevision !== undefined &&
      body.expectedPlanRevision !== null &&
      plan?.revision !== body.expectedPlanRevision
    )
      throw new AppError('REVISION_CONFLICT', 'Chapter plan revision is stale', 409);
    const chapter = service.chapters.getByPlanItem(projectId, planItemId);
    if (
      body.expectedChapterRevision !== undefined &&
      chapter?.revision !== body.expectedChapterRevision
    )
      throw new AppError('REVISION_CONFLICT', 'Chapter revision is stale', 409);
    return reply.code(202).send(service.scheduleStoryChapterV2(projectId, planItemId));
  },
);
app.post('/api/projects/:projectId/story/batches', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply
    .code(202)
    .send(
      service.scheduleStoryBatch(
        idSchema.parse(params.projectId),
        storyGenerationBatchRequestSchema.parse(request.body),
      ),
    );
});
app.get('/api/projects/:projectId/story/batches', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const query = request.query as { limit?: string; offset?: string };
  return service.batches.list(
    projectId,
    parsePageValue(query.limit, 20, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/story/batches/:batchId/items', async (request) => {
  const params = request.params as { projectId: string; batchId: string };
  const projectId = idSchema.parse(params.projectId);
  const batchId = idSchema.parse(params.batchId);
  const batch = service.batches.get(batchId);
  if (!batch || batch.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Story generation batch not found', 404);
  const query = request.query as { limit?: string; offset?: string };
  return service.batches.items(
    batchId,
    parsePageValue(query.limit, 200, 200),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.post(
  '/api/projects/:projectId/story/batches/:batchId/items/:chapterNumber/retry',
  async (request, reply) => {
    const params = request.params as { projectId: string; batchId: string; chapterNumber: string };
    const projectId = idSchema.parse(params.projectId);
    const batchId = idSchema.parse(params.batchId);
    const batch = service.batches.get(batchId);
    if (!batch || batch.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Story generation batch not found', 404);
    const chapterNumber = Number(params.chapterNumber);
    if (!Number.isInteger(chapterNumber))
      throw new AppError('INVALID_BATCH_ITEM', 'Chapter number is invalid', 400);
    return reply.code(202).send(service.retryStoryBatchItem(batchId, chapterNumber));
  },
);
app.post(
  '/api/projects/:projectId/story/batches/:batchId/items/:chapterNumber/skip',
  async (request, reply) => {
    const params = request.params as { projectId: string; batchId: string; chapterNumber: string };
    const projectId = idSchema.parse(params.projectId);
    const batchId = idSchema.parse(params.batchId);
    const batch = service.batches.get(batchId);
    if (!batch || batch.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Story generation batch not found', 404);
    const chapterNumber = Number(params.chapterNumber);
    if (!Number.isInteger(chapterNumber))
      throw new AppError('INVALID_BATCH_ITEM', 'Chapter number is invalid', 400);
    const body = storyGenerationBatchSkipRequestSchema.parse(request.body);
    return reply.code(200).send(service.skipStoryBatchItem(batchId, chapterNumber, body.reason));
  },
);
app.post('/api/projects/:projectId/story/batches/:batchId/cancel', async (request, reply) => {
  const params = request.params as { projectId: string; batchId: string };
  const projectId = idSchema.parse(params.projectId);
  const batchId = idSchema.parse(params.batchId);
  const batch = service.batches.get(batchId);
  if (!batch || batch.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Story generation batch not found', 404);
  return reply.code(202).send(service.cancelStoryBatch(batchId));
});
app.get('/api/projects/:projectId/story/continuity-checks', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const query = request.query as { limit?: string; offset?: string };
  return service.story.getContinuityChecks(
    projectId,
    parsePageValue(query.limit, 50, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.post('/api/chapters/:id/story/analyze', async (request, reply) => {
  const params = request.params as { id: string };
  return reply.code(202).send(service.scheduleStoryStateAnalysis(idSchema.parse(params.id)));
});
app.post('/api/chapters/:id/story/continuity', async (request, reply) => {
  const params = request.params as { id: string };
  return reply.code(202).send(service.scheduleContinuityCheck(idSchema.parse(params.id)));
});
app.post('/api/chapters/:id/story/continuity/:checkId/accept', async (request) => {
  const params = request.params as { id: string; checkId: string };
  return storyEngine.acceptManualAnalysis(
    idSchema.parse(params.id),
    idSchema.parse(params.checkId),
  );
});
app.post('/api/projects/:projectId/story/rebuild-continuity', async (request) => {
  const params = request.params as { projectId: string };
  return storyEngine.rebuildContinuity(
    idSchema.parse(params.projectId),
    storyContinuityRebuildRequestSchema.parse(request.body).fromChapter,
  );
});
app.post('/api/projects/:projectId/story/continuity/keep-stale', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  const fromChapter = storyContinuityRebuildRequestSchema.parse(request.body).fromChapter;
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  return {
    disposition: 'KEEP_STALE' as const,
    fromChapter,
    updated: service.story.markContinuityStale(
      projectId,
      fromChapter - 1,
      'User kept the continuity suffix stale',
    ),
  };
});
app.get('/api/projects/:projectId/story/usage', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const query = request.query as { limit?: string; offset?: string };
  return {
    summary: service.story.getUsageSummary(projectId),
    recent: service.story.getUsage(
      projectId,
      parsePageValue(query.limit, 100, 200),
      parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
    ),
  };
});
app.get('/api/projects/:projectId/story/context-diagnostics', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const query = request.query as { limit?: string; offset?: string };
  return service.story.getContextDiagnostics(
    projectId,
    parsePageValue(query.limit, 20, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.post('/api/chapters/:id/story/summary', async (request, reply) => {
  const params = request.params as { id: string };
  const chapter = service.getChapter(idSchema.parse(params.id));
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const body = storyGenerationRequestSchema.parse(request.body ?? {});
  if (
    body.expectedChapterRevision !== undefined &&
    chapter.revision !== body.expectedChapterRevision
  )
    throw new AppError('REVISION_CONFLICT', 'Chapter revision is stale', 409);
  return reply.code(202).send(service.scheduleStorySummary(chapter.id));
});
app.post('/api/projects/:projectId/story/summary/compact', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply
    .code(202)
    .send(service.scheduleStorySummaryCompaction(idSchema.parse(params.projectId)));
});
app.get('/api/projects/:id/render', async (request) => {
  const params = request.params as { id: string };
  const projectId = idSchema.parse(params.id);
  const row = database.sqlite
    .prepare(
      "SELECT id,type,path,media_type as mediaType,bytes,sha256 FROM assets WHERE project_id=? AND role='project:render' AND is_current=1 AND status='READY'",
    )
    .get(projectId) as
    | { id: string; type: string; path: string; mediaType: string; bytes: number; sha256: string }
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Rendered video not found', 404);
  return { ...row, url: `/api/assets/${row.id}` };
});

const errorCategoryByCode: Record<
  string,
  | 'INFRASTRUCTURE'
  | 'PROVIDER'
  | 'STRUCTURED_OUTPUT'
  | 'CONTEXT'
  | 'CONTINUITY'
  | 'CANCELLED'
  | 'BUDGET'
> = {
  INFRASTRUCTURE_ERROR: 'INFRASTRUCTURE',
  HOST_ERROR: 'INFRASTRUCTURE',
  PROVIDER_ERROR: 'PROVIDER',
  STRUCTURED_OUTPUT_ERROR: 'STRUCTURED_OUTPUT',
  CONTEXT_ERROR: 'CONTEXT',
  CONTINUITY_ERROR: 'CONTINUITY',
  INVALID_CONTINUITY: 'CONTINUITY',
  CANCELLED: 'CANCELLED',
  BUDGET_ERROR: 'BUDGET',
  SCENE_CONTEXT_TOO_LARGE: 'CONTEXT',
  SCENE_OUTPUT_INVALID: 'STRUCTURED_OUTPUT',
};

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    const category = errorCategoryByCode[error.code];
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(category ? { category } : {}),
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
      },
    });
  }
  if (error instanceof Error && error.name === 'ZodError')
    return reply
      .code(400)
      .send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } });
  app.log.error(error);
  return reply
    .code(500)
    .send({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});
app.post('/api/projects/:projectId/assets', async (request, reply) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const part = await request.file();
  if (!part) throw new AppError('INVALID_UPLOAD', 'File is required');
  const extensionByMime: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mp4': '.m4a',
  };
  const extension = extensionByMime[part.mimetype];
  const kind = part.mimetype.startsWith('image/')
    ? 'BACKGROUND_IMAGE'
    : part.mimetype.startsWith('video/')
      ? 'BACKGROUND_VIDEO'
      : part.mimetype.startsWith('audio/')
        ? 'MUSIC'
        : null;
  if (!kind || !extension) throw new AppError('INVALID_UPLOAD', 'Unsupported media type');
  const assetId = randomUUID();
  const directory = join(workspace.projects, projectId, kind === 'MUSIC' ? 'music' : 'backgrounds');
  const target = join(directory, `${assetId}${extension}`);
  await mkdir(directory, { recursive: true });
  let probe: Record<string, unknown>;
  try {
    await pipeline(part.file, createWriteStream(target));
    probe =
      (await validateMediaFile(
        media,
        target,
        kind === 'MUSIC' ? 'audio' : kind === 'BACKGROUND_IMAGE' ? 'image' : 'video',
      )) ?? {};
  } catch {
    await rm(target, { force: true });
    throw new AppError('INVALID_UPLOAD', 'Uploaded media could not be decoded', 400);
  }
  const digest = await sha256File(target);
  const role = kind === 'MUSIC' ? 'project:music' : 'project:background';
  service.assets.register({
    id: assetId,
    projectId,
    type: kind,
    role,
    path: relativeAssetPath(workspace.root, target),
    mediaType: contentTypeFor(target),
    bytes: digest.bytes,
    sha256: digest.hash,
    metadata: { displayName: part.filename, probe },
  });
  service.invalidateRenderForAsset(projectId);
  return reply.code(201).send({ id: assetId, type: kind });
});
app.delete('/api/projects/:id/music', async (request, reply) => {
  const params = request.params as { id: string };
  const projectId = idSchema.parse(params.id);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  service.assets.invalidateRole(projectId, 'project:music');
  service.invalidateRenderForAsset(projectId);
  return reply.code(204).send();
});
app.get('/api/projects', async () => service.listProjects());
app.post('/api/projects', async (request, reply) => {
  const input = projectInputSchema.parse(request.body);
  const project = service.createProject(input);
  await prepareProjectDirectories(workspace, project.id);
  return reply.code(201).send(project);
});
app.get('/api/projects/:id', async (request) => {
  const params = request.params as { id: string };
  const id = idSchema.parse(params.id);
  const project = service.getProject(id);
  if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const query = request.query as { includeChapters?: string };
  return query.includeChapters === 'false'
    ? { project }
    : { project, chapters: service.listChapters(id) };
});
app.delete('/api/projects/:id', async (request, reply) => {
  const params = request.params as { id: string };
  service.deleteProject(idSchema.parse(params.id));
  return reply.code(204).send();
});
app.get('/api/projects/:projectId/status', async (request) => {
  const params = request.params as { projectId: string };
  return service.getStatus(idSchema.parse(params.projectId));
});
app.get('/api/chapters/:id/status', async (request) => {
  const params = request.params as { id: string };
  const chapter = service.getChapter(idSchema.parse(params.id));
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  return service.getStatus(chapter.projectId, chapter.id);
});
app.get('/api/projects/:projectId/chapters', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  const query = request.query as {
    limit?: string;
    offset?: string;
    search?: string;
    status?: string;
  };
  const status = parseChapterStatus(query.status);
  if (
    query.limit !== undefined ||
    query.offset !== undefined ||
    query.search !== undefined ||
    query.status !== undefined
  )
    return service.listChapterPage(
      projectId,
      parsePageValue(query.limit, 25, 100),
      parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
      query.search ?? '',
      status,
    );
  return service.listChapters(projectId);
});
app.post('/api/projects/:projectId/chapters', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply
    .code(201)
    .send(
      service.createChapter(
        idSchema.parse(params.projectId),
        chapterInputSchema.parse(request.body),
      ),
    );
});
app.patch('/api/chapters/:id', async (request) => {
  const params = request.params as { id: string };
  return service.updateChapter(idSchema.parse(params.id), chapterInputSchema.parse(request.body));
});
app.delete('/api/chapters/:id', async (request, reply) => {
  const params = request.params as { id: string };
  service.deleteChapter(idSchema.parse(params.id));
  return reply.code(204).send();
});
app.post('/api/projects/:projectId/chapters/reorder', async (request) => {
  const params = request.params as { projectId: string };
  const body = reorderSchema.parse(request.body);
  return service.reorderChapters(idSchema.parse(params.projectId), body.chapters);
});
app.post('/api/chapters/:id/tts', async (request, reply) => {
  const params = request.params as { id: string };
  return reply.code(202).send(service.scheduleChapterTts(idSchema.parse(params.id)));
});
app.post('/api/chapters/:id/subtitles', async (request, reply) => {
  const params = request.params as { id: string };
  return reply.code(202).send({ jobId: service.scheduleSubtitle(idSchema.parse(params.id)) });
});
app.get('/api/chapters/:id/audio', async (request) => {
  const params = request.params as { id: string };
  const chapter = service.getChapter(idSchema.parse(params.id));
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const row = database.sqlite
    .prepare(
      "SELECT id,media_type as mediaType FROM assets WHERE project_id=? AND role=? AND is_current=1 AND status='READY'",
    )
    .get(chapter.projectId, `chapter:${chapter.id}:audio`) as
    { id: string; mediaType: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Chapter audio not found', 404);
  return { id: row.id, mediaType: row.mediaType, url: `/api/assets/${row.id}` };
});
app.get('/api/chapters/:id/subtitles', async (request, reply) => {
  const params = request.params as { id: string };
  const chapter = service.getChapter(idSchema.parse(params.id));
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const row = database.sqlite
    .prepare(
      "SELECT id,path,media_type as mediaType FROM assets WHERE project_id=? AND role=? AND is_current=1 AND status='READY'",
    )
    .get(chapter.projectId, `chapter:${chapter.id}:subtitle`) as
    { id: string; path: string; mediaType: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Subtitle not found', 404);
  return reply
    .type(row.mediaType)
    .send(readFileSync(safeWorkspacePath(workspace.root, row.path), 'utf8'));
});
app.put('/api/chapters/:id/subtitles', async (request, reply) => {
  const params = request.params as { id: string };
  const chapter = service.getChapter(idSchema.parse(params.id));
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const body = subtitleReplacementSchema.parse(request.body);
  let cues;
  try {
    cues = parseSrt(body.srt);
  } catch (error) {
    throw new AppError('INVALID_SRT', error instanceof Error ? error.message : 'Invalid SRT');
  }
  if (!cues.length) throw new AppError('INVALID_SRT', 'At least one subtitle cue is required');
  const audio = database.sqlite
    .prepare(
      "SELECT metadata FROM assets WHERE project_id=? AND role=? AND is_current=1 AND status='READY'",
    )
    .get(chapter.projectId, `chapter:${chapter.id}:audio`) as { metadata: string } | undefined;
  if (audio) {
    const metadata: unknown = JSON.parse(audio.metadata);
    const durationMs =
      metadata && typeof metadata === 'object' && 'durationMs' in metadata
        ? Number(metadata.durationMs)
        : 0;
    if (durationMs && cues[cues.length - 1]!.endMs > durationMs)
      throw new AppError('INVALID_SRT', 'Subtitle cue exceeds chapter audio duration');
  }
  const assetId = randomUUID();
  const directory = join(workspace.projects, chapter.projectId, 'subtitles');
  const target = join(directory, `${assetId}.srt`);
  await mkdir(directory, { recursive: true });
  await writeFile(target, body.srt, 'utf8');
  const digest = await sha256File(target);
  service.assets.register({
    id: assetId,
    projectId: chapter.projectId,
    type: 'SUBTITLE',
    role: `chapter:${chapter.id}:subtitle`,
    path: relativeAssetPath(workspace.root, target),
    mediaType: 'text/plain; charset=utf-8',
    bytes: digest.bytes,
    sha256: digest.hash,
    sourceEntityId: chapter.id,
    metadata: { source: 'manual' },
  });
  service.invalidateRenderForAsset(chapter.projectId);
  return reply.code(201).send({ id: assetId, url: `/api/assets/${assetId}` });
});
app.get('/api/projects/:id/render-config', async (request) => {
  const params = request.params as { id: string };
  return service.getRenderConfig(idSchema.parse(params.id));
});
app.patch('/api/projects/:id/render-config', async (request, reply) => {
  const params = request.params as { id: string };
  service.setRenderConfig(idSchema.parse(params.id), renderConfigSchema.parse(request.body));
  return reply.code(204).send();
});
app.post('/api/projects/:id/render', async (request, reply) => {
  const params = request.params as { id: string };
  return reply.code(202).send({ jobId: service.scheduleRender(idSchema.parse(params.id)) });
});
app.get('/api/jobs/:id', async (request) => {
  const params = request.params as { id: string };
  const row = database.sqlite
    .prepare(
      'SELECT id,type,entity_id as entityId,status,progress,error,attempts,created_at as createdAt,started_at as startedAt,completed_at as completedAt FROM jobs WHERE id=?',
    )
    .get(idSchema.parse(params.id)) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Job not found', 404);
  return row;
});
app.post('/api/jobs/:id/retry', async (request, reply) => {
  const params = request.params as { id: string };
  const row = database.sqlite
    .prepare('SELECT step_id as stepId FROM jobs WHERE id=?')
    .get(idSchema.parse(params.id)) as { stepId: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Job not found', 404);
  new WorkflowRepository(database).retryStep(row.stepId);
  return reply.code(202).send({ jobId: params.id });
});
app.post('/api/jobs/:id/cancel', async (request, reply) => {
  const params = request.params as { id: string };
  const jobId = idSchema.parse(params.id);
  const row = database.sqlite
    .prepare('SELECT step_id as stepId FROM jobs WHERE id=?')
    .get(jobId) as { stepId: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Job not found', 404);
  new WorkflowRepository(database).requestCancel(row.stepId);
  return reply.code(202).send({ jobId });
});
app.get('/api/assets/:id', async (request, reply) => {
  const params = request.params as { id: string };
  const row = database.sqlite
    .prepare(
      "SELECT path,media_type as mediaType,bytes,status FROM assets WHERE id=? AND status='READY'",
    )
    .get(idSchema.parse(params.id)) as
    { path: string; mediaType: string; bytes: number; status: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Asset not found', 404);
  const filename = safeWorkspacePath(workspace.root, row.path);
  let size: number;
  try {
    size = statSync(filename).size;
  } catch {
    throw new AppError('ASSET_MISSING', 'Asset file is unavailable', 404);
  }
  const range = request.headers.range;
  if (!range)
    return reply
      .type(row.mediaType)
      .header('Content-Length', size)
      .send(createReadStream(filename));
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) throw new AppError('INVALID_RANGE', 'Invalid byte range', 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= size)
    throw new AppError('INVALID_RANGE', 'Byte range is not satisfiable', 416);
  return reply
    .code(206)
    .type(row.mediaType)
    .header('Content-Range', `bytes ${start}-${end}/${size}`)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Length', end - start + 1)
    .send(createReadStream(filename, { start, end }));
});

await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`API listening on http://127.0.0.1:${port}`);
