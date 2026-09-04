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
  validateImageFile,
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
  renderScopeSchema,
  renderRequestSchema,
  sceneTimingUpdateSchema,
  storyBlueprintSchema,
  storyArcSchema,
  storyContinuityRebuildRequestSchema,
  storyGenerationBatchRequestSchema,
  storyGenerationBatchSkipRequestSchema,
  storyGenerationRequestSchema,
  storyPlanWindowRequestSchema,
  storyPlanWindowResultSchema,
  storySettingsSchema,
  referenceApprovalUpdateSchema,
  sceneImageReferencePromotionSchema,
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
  imageGenerationBatchSchema,
  imageGenerationChapterBatchSchema,
  imageGenerationSettingsUpdateSchema,
  sceneImageCurrentSelectionSchema,
  sceneImageGenerationScheduleSchema,
  aiVideoBatchSchema,
  sceneMotionSourceUpdateSchema,
  sceneVideoRegenerationSchema,
  sceneVideoReviewUpdateSchema,
  videoGenerationSettingsUpdateSchema,
  sceneImageManualUploadSchema,
  sceneImageRegenerationSchema,
  sceneImageReviewUpdateSchema,
} from '@studio/shared';
import type { OmpReadiness, RenderScope } from '@studio/shared';
import {
  StudioService,
  createOmpAgent,
  createStoryEngine,
  parseSrt,
  projectVideoRole,
} from '@studio/workflow';
import { RenderJobRepository, WorkflowRepository } from '@studio/database';
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
type PublicRenderAssetRow = {
  id: string;
  type: string;
  role: string;
  status: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  inputFingerprint: string | null;
  metadata: string;
};
function publicRenderAsset(row: PublicRenderAssetRow): Record<string, unknown> {
  let metadata: unknown = null;
  try {
    metadata = JSON.parse(row.metadata);
  } catch {
    metadata = null;
  }
  return {
    id: row.id,
    type: row.type,
    role: row.role,
    status: row.status,
    mediaType: row.mediaType,
    bytes: row.bytes,
    sha256: row.sha256,
    inputFingerprint: row.inputFingerprint,
    metadata,
    url: `/api/assets/${row.id}`,
  };
}
type RenderScopeQuery = {
  scopeKind?: string;
  sceneId?: string;
  chapterId?: string;
  startChapterNumber?: string;
  endChapterNumber?: string;
  chapterIds?: string;
};
function parseRenderScope(query: RenderScopeQuery): RenderScope {
  if (query.scopeKind === undefined || query.scopeKind === 'FULL_STORY')
    return { kind: 'FULL_STORY' };
  if (query.scopeKind === 'SCENE')
    return renderScopeSchema.parse({ kind: 'SCENE', sceneId: idSchema.parse(query.sceneId) });
  if (query.scopeKind === 'CHAPTER')
    return renderScopeSchema.parse({ kind: 'CHAPTER', chapterId: idSchema.parse(query.chapterId) });
  if (query.scopeKind === 'CHAPTER_RANGE')
    return renderScopeSchema.parse({
      kind: 'CHAPTER_RANGE',
      startChapterNumber: Number(query.startChapterNumber),
      endChapterNumber: Number(query.endChapterNumber),
    });
  if (query.scopeKind === 'SELECTED_CHAPTERS')
    return renderScopeSchema.parse({
      kind: 'SELECTED_CHAPTERS',
      chapterIds: (query.chapterIds ?? '')
        .split(',')
        .filter(Boolean)
        .map((id) => idSchema.parse(id)),
    });
  throw new AppError('INVALID_INPUT', 'Render scope is invalid', 400);
}

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
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
app.get('/api/projects/:projectId/characters/:characterId/references', async (request) => {
  const params = request.params as { projectId: string; characterId: string };
  const projectId = idSchema.parse(params.projectId);
  const characterId = storyStableIdSchema.parse(params.characterId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const profile = service.visual.getCharacterProfile(projectId, characterId);
  const attachedIds = profile?.payload.referenceAssetIds ?? [];
  const references = service.assets.listCharacterReferences(projectId, characterId).map((asset) => {
    let metadata: Record<string, unknown> = {};
    try {
      const rawMetadata: unknown = typeof asset.metadata === 'string' ? asset.metadata : '{}';
      const parsed: unknown = JSON.parse(rawMetadata as string);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    return {
      id: asset.id,
      url: `/api/assets/${asset.id}`,
      mediaType: asset.mediaType,
      bytes: asset.bytes,
      sha256: asset.sha256,
      approval: typeof metadata.approval === 'string' ? metadata.approval : 'CANDIDATE',
      displayName: typeof metadata.displayName === 'string' ? metadata.displayName : '',
      isPrimary: asset.id === attachedIds[0],
      attached: attachedIds.includes(asset.id),
      createdAt: asset.createdAt,
    };
  });
  return {
    characterId,
    profileRevision: profile?.revision ?? null,
    primaryReferenceId: attachedIds[0] ?? null,
    references,
  };
});
app.post('/api/projects/:projectId/characters/:characterId/references', async (request, reply) => {
  const params = request.params as { projectId: string; characterId: string };
  const projectId = idSchema.parse(params.projectId);
  const characterId = storyStableIdSchema.parse(params.characterId);
  if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
  const part = await request.file();
  if (!part) throw new AppError('INVALID_UPLOAD', 'File is required');
  const extensionByMime: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  };
  const extension = extensionByMime[part.mimetype];
  if (!extension) throw new AppError('INVALID_UPLOAD', 'Unsupported media type');
  const assetId = randomUUID();
  const directory = join(workspace.projects, projectId, 'references');
  const target = join(directory, `${assetId}${extension}`);
  await mkdir(directory, { recursive: true });
  let validated: { mediaType: string; width: number; height: number } | null = null;
  try {
    await pipeline(part.file, createWriteStream(target));
    validated = await validateImageFile(media, target);
  } catch {
    await rm(target, { force: true });
    throw new AppError('INVALID_UPLOAD', 'Uploaded reference could not be decoded', 400);
  }
  if (!validated) {
    await rm(target, { force: true });
    throw new AppError('INVALID_UPLOAD', 'Uploaded reference could not be decoded', 400);
  }
  const digest = await sha256File(target);
  service.assets.registerReference({
    id: assetId,
    projectId,
    type: 'CHARACTER_REFERENCE_IMAGE',
    role: 'CHARACTER_REFERENCE_IMAGE',
    path: relativeAssetPath(workspace.root, target),
    mediaType: validated.mediaType,
    bytes: digest.bytes,
    sha256: digest.hash,
    metadata: { characterId, approval: 'CANDIDATE', displayName: part.filename },
  });
  return reply
    .code(201)
    .send({ id: assetId, url: `/api/assets/${assetId}`, approval: 'CANDIDATE' });
});
app.patch(
  '/api/projects/:projectId/characters/:characterId/references/:assetId/approval',
  async (request) => {
    const params = request.params as { projectId: string; characterId: string; assetId: string };
    const projectId = idSchema.parse(params.projectId);
    const characterId = storyStableIdSchema.parse(params.characterId);
    const assetId = idSchema.parse(params.assetId);
    const body = referenceApprovalUpdateSchema.parse(request.body);
    if (!service.getProject(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    service.assets.setReferenceApproval(projectId, assetId, characterId, body.approval);
    return { id: assetId, characterId, approval: body.approval };
  },
);
app.post(
  '/api/projects/:projectId/scenes/:sceneId/images/:generationId/promote-reference',
  async (request) => {
    const params = request.params as {
      projectId: string;
      sceneId: string;
      generationId: string;
    };
    const projectId = idSchema.parse(params.projectId);
    const sceneId = idSchema.parse(params.sceneId);
    const generationId = idSchema.parse(params.generationId);
    const body = sceneImageReferencePromotionSchema.parse(request.body);
    const { assetId } = await service.images.promoteToCharacterReference(
      projectId,
      sceneId,
      generationId,
      body,
    );
    const profile = service.visual.getCharacterProfile(projectId, body.characterId);
    const currentRefs = profile?.payload.referenceAssetIds ?? [];
    const referenceAssetIds = body.primary
      ? [assetId, ...currentRefs.filter((id) => id !== assetId)]
      : [...currentRefs, assetId];
    const updated = await Promise.resolve(
      service.visual.updateCharacterProfileReferences(projectId, body.characterId, {
        expectedRevision: body.expectedRevision,
        referenceAssetIds,
      }),
    );
    return { assetId, characterId: body.characterId, profile: updated };
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
app.get('/api/projects/:projectId/image-settings', async (request) => {
  const params = request.params as { projectId: string };
  return service.images.getSettings(idSchema.parse(params.projectId));
});
app.put('/api/projects/:projectId/image-settings', async (request) => {
  const params = request.params as { projectId: string };
  return service.images.updateSettings(
    idSchema.parse(params.projectId),
    imageGenerationSettingsUpdateSchema.parse(request.body),
  );
});
app.post('/api/projects/:projectId/image-settings/readiness', async (request) => {
  const params = request.params as { projectId: string };
  return await service.images.readiness(idSchema.parse(params.projectId), request.signal);
});
app.get('/api/projects/:projectId/scenes/:sceneId/images', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.images.listGenerations(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    parsePageValue(query.limit, 50, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.get('/api/projects/:projectId/scenes/:sceneId/images/current', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  const image = service.images.getCurrentGeneration(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
  );
  if (!image) throw new AppError('NOT_FOUND', 'Current Scene image not found', 404);
  return image;
});
app.get('/api/projects/:projectId/scenes/:sceneId/images/:generationId', async (request) => {
  const params = request.params as {
    projectId: string;
    sceneId: string;
    generationId: string;
  };
  return service.images.getGeneration(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    idSchema.parse(params.generationId),
  );
});
app.post('/api/projects/:projectId/scenes/:sceneId/images/generate', async (request, reply) => {
  const params = request.params as { projectId: string; sceneId: string };
  return reply
    .code(202)
    .send(
      service.images.schedule(
        idSchema.parse(params.projectId),
        idSchema.parse(params.sceneId),
        sceneImageGenerationScheduleSchema.parse(request.body ?? {}),
      ),
    );
});
app.post(
  '/api/projects/:projectId/scenes/:sceneId/images/:generationId/regenerate',
  async (request, reply) => {
    const params = request.params as {
      projectId: string;
      sceneId: string;
      generationId: string;
    };
    return reply
      .code(202)
      .send(
        service.images.regenerate(
          idSchema.parse(params.projectId),
          idSchema.parse(params.sceneId),
          idSchema.parse(params.generationId),
          sceneImageRegenerationSchema.parse(request.body ?? {}),
        ),
      );
  },
);
app.put('/api/projects/:projectId/scenes/:sceneId/images/:generationId/review', async (request) => {
  const params = request.params as {
    projectId: string;
    sceneId: string;
    generationId: string;
  };
  return service.images.updateReview(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    idSchema.parse(params.generationId),
    sceneImageReviewUpdateSchema.parse(request.body),
  );
});
app.put('/api/projects/:projectId/scenes/:sceneId/images/:generationId/accept', async (request) => {
  const params = request.params as {
    projectId: string;
    sceneId: string;
    generationId: string;
  };
  return service.images.acceptCandidate(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    idSchema.parse(params.generationId),
    sceneImageReviewUpdateSchema.parse(request.body ?? {}),
  );
});
app.get('/api/projects/:projectId/scenes/:sceneId/images/candidate-sets', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  const query = request.query as { limit?: string; offset?: string };
  return service.images.listCandidateSets(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    parsePageValue(query.limit, 50, 100),
    parsePageValue(query.offset, 0, Number.MAX_SAFE_INTEGER),
  );
});
app.put(
  '/api/projects/:projectId/scenes/:sceneId/images/:generationId/current',
  async (request) => {
    const params = request.params as {
      projectId: string;
      sceneId: string;
      generationId: string;
    };
    return service.images.setCurrent(
      idSchema.parse(params.projectId),
      idSchema.parse(params.sceneId),
      idSchema.parse(params.generationId),
      sceneImageCurrentSelectionSchema.parse(request.body ?? {}),
    );
  },
);
app.post('/api/projects/:projectId/scenes/:sceneId/images/manual', async (request, reply) => {
  const params = request.params as { projectId: string; sceneId: string };
  const query = request.query as { notes?: string };
  const projectId = idSchema.parse(params.projectId);
  const sceneId = idSchema.parse(params.sceneId);
  const input = sceneImageManualUploadSchema.parse({ notes: query.notes ?? '' });
  const part = await request.file();
  if (!part) throw new AppError('INVALID_UPLOAD', 'Image file is required', 400);
  const extensionByMime: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  };
  const extension = extensionByMime[part.mimetype];
  if (!extension)
    throw new AppError('INVALID_UPLOAD', 'Only PNG, JPEG, and WEBP images are supported', 400);
  const stagingPath = join(workspace.staging, `manual-image-${randomUUID()}${extension}`);
  try {
    await pipeline(part.file, createWriteStream(stagingPath));
    if (part.file.truncated || statSync(stagingPath).size > 50_000_000)
      throw new AppError('INVALID_UPLOAD', 'Scene image exceeds the 50 MB limit', 413);
    const image = await service.images.registerManual(projectId, sceneId, stagingPath, input.notes);
    return reply.code(201).send(image);
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }
});
app.post('/api/projects/:projectId/images/generate-batch', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply
    .code(202)
    .send(
      service.images.scheduleBatch(
        idSchema.parse(params.projectId),
        imageGenerationBatchSchema.parse(request.body),
      ),
    );
});
app.post(
  '/api/projects/:projectId/chapters/:chapterId/images/generate-batch',
  async (request, reply) => {
    const params = request.params as { projectId: string; chapterId: string };
    return reply
      .code(202)
      .send(
        service.images.scheduleChapterBatch(
          idSchema.parse(params.projectId),
          idSchema.parse(params.chapterId),
          imageGenerationChapterBatchSchema.parse(request.body ?? {}),
        ),
      );
  },
);

// ---- AI video (image-to-video) ----
app.get('/api/projects/:projectId/video-settings', async (request) => {
  const params = request.params as { projectId: string };
  return service.videos.getSettings(idSchema.parse(params.projectId));
});
app.put('/api/projects/:projectId/video-settings', async (request) => {
  const params = request.params as { projectId: string };
  return service.videos.updateSettings(
    idSchema.parse(params.projectId),
    videoGenerationSettingsUpdateSchema.parse(request.body),
  );
});
app.post('/api/projects/:projectId/video-settings/readiness', async (request) => {
  const params = request.params as { projectId: string };
  return await service.videos.readiness(idSchema.parse(params.projectId), request.signal);
});
app.get('/api/projects/:projectId/scenes/:sceneId/ai-motion', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  const projectId = idSchema.parse(params.projectId);
  const sceneId = idSchema.parse(params.sceneId);
  return {
    motionSource: service.videos.getMotionSource(projectId, sceneId),
    motionPlan: service.videos.getMotionPlan(projectId, sceneId),
    current: service.videos.getCurrentGeneration(projectId, sceneId),
    generations: service.videos.listGenerations(projectId, sceneId),
  };
});
app.put('/api/projects/:projectId/scenes/:sceneId/ai-motion', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  return service.videos.updateMotionPlan(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    request.body ?? {},
  );
});
app.put('/api/projects/:projectId/scenes/:sceneId/motion-source', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  return {
    sceneId: idSchema.parse(params.sceneId),
    motionSource: service.videos.setMotionSource(
      idSchema.parse(params.projectId),
      idSchema.parse(params.sceneId),
      sceneMotionSourceUpdateSchema.parse(request.body),
    ),
  };
});
app.post('/api/projects/:projectId/scenes/:sceneId/ai-video/generate', async (request, reply) => {
  const params = request.params as { projectId: string; sceneId: string };
  return reply
    .code(202)
    .send(
      service.videos.schedule(
        idSchema.parse(params.projectId),
        idSchema.parse(params.sceneId),
        request.body ?? {},
      ),
    );
});
app.post(
  '/api/projects/:projectId/scenes/:sceneId/ai-video/:generationId/regenerate',
  async (request, reply) => {
    const params = request.params as {
      projectId: string;
      sceneId: string;
      generationId: string;
    };
    return reply
      .code(202)
      .send(
        service.videos.regenerate(
          idSchema.parse(params.projectId),
          idSchema.parse(params.sceneId),
          idSchema.parse(params.generationId),
          sceneVideoRegenerationSchema.parse(request.body ?? {}),
        ),
      );
  },
);
app.put('/api/projects/:projectId/scenes/:sceneId/ai-video/:generationId/review', async (request) => {
  const params = request.params as {
    projectId: string;
    sceneId: string;
    generationId: string;
  };
  return service.videos.updateReview(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    idSchema.parse(params.generationId),
    sceneVideoReviewUpdateSchema.parse(request.body),
  );
});
app.put('/api/projects/:projectId/scenes/:sceneId/ai-video/:generationId/accept', async (request) => {
  const params = request.params as {
    projectId: string;
    sceneId: string;
    generationId: string;
  };
  return service.videos.accept(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    idSchema.parse(params.generationId),
    request.body ?? {},
  );
});
app.put('/api/projects/:projectId/scenes/:sceneId/ai-video/:generationId/current', async (request) => {
  const params = request.params as {
    projectId: string;
    sceneId: string;
    generationId: string;
  };
  return service.videos.setCurrent(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    idSchema.parse(params.generationId),
  );
});
app.post('/api/projects/:projectId/ai-video/generate-batch', async (request, reply) => {
  const params = request.params as { projectId: string };
  return reply
    .code(202)
    .send(
      service.videos.scheduleBatch(
        idSchema.parse(params.projectId),
        aiVideoBatchSchema.parse(request.body),
      ),
    );
});
app.post('/api/projects/:projectId/chapters/:chapterId/ai-video/generate-missing', async (request, reply) => {
  const params = request.params as { projectId: string; chapterId: string };
  return reply
    .code(202)
    .send(
      service.videos.scheduleChapterMissing(
        idSchema.parse(params.projectId),
        idSchema.parse(params.chapterId),
      ),
    );
});
app.get('/api/projects/:projectId/scenes/:sceneId/ai-video/current', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  const clip = service.videos.getCurrentGeneration(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
  );
  if (!clip) throw new AppError('NOT_FOUND', 'Current AI motion not found', 404);
  return clip;
});
app.get('/api/projects/:projectId/scenes/:sceneId/ai-video/:generationId', async (request) => {
  const params = request.params as {
    projectId: string;
    sceneId: string;
    generationId: string;
  };
  return service.videos.getGeneration(
    idSchema.parse(params.projectId),
    idSchema.parse(params.sceneId),
    idSchema.parse(params.generationId),
  );
});
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
      "SELECT id,type,role,status,media_type as mediaType,bytes,sha256,input_fingerprint as inputFingerprint,metadata FROM assets WHERE project_id=? AND role IN ('project:render',?) AND is_current=1 AND status='READY' ORDER BY CASE WHEN role=? THEN 0 ELSE 1 END LIMIT 1",
    )
    .get(
      projectId,
      `project:${projectId}:video:full-story`,
      `project:${projectId}:video:full-story`,
    ) as PublicRenderAssetRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Rendered video not found', 404);
  return publicRenderAsset(row);
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
  if (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  )
    return reply
      .code(error.statusCode)
      .send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
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
app.get('/api/projects/:projectId/chapters/:chapterId/timeline', async (request) => {
  const params = request.params as { projectId: string; chapterId: string };
  return service.getChapterTimeline(
    idSchema.parse(params.projectId),
    idSchema.parse(params.chapterId),
  );
});
app.post('/api/projects/:projectId/chapters/:chapterId/timeline/timing', async (request, reply) => {
  const params = request.params as { projectId: string; chapterId: string };
  const projectId = idSchema.parse(params.projectId);
  const chapterId = idSchema.parse(params.chapterId);
  const chapter = service.getChapter(chapterId);
  if (!chapter || chapter.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const body = request.body;
  if (
    body !== undefined &&
    (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)
  )
    throw new AppError('INVALID_INPUT', 'Automatic timing request must be empty', 400);
  return reply.code(202).send(service.scheduleSceneTiming(chapterId));
});
app.patch('/api/projects/:projectId/chapters/:chapterId/timeline', async (request, reply) => {
  const params = request.params as { projectId: string; chapterId: string };
  const projectId = idSchema.parse(params.projectId);
  const chapterId = idSchema.parse(params.chapterId);
  const chapter = service.getChapter(chapterId);
  if (!chapter || chapter.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const update = sceneTimingUpdateSchema.parse(request.body);
  return reply.code(202).send(service.scheduleSceneTiming(chapterId, update));
});
app.patch('/api/projects/:projectId/chapters/:chapterId/timeline/motion', async (request) => {
  const params = request.params as { projectId: string; chapterId: string };
  const projectId = idSchema.parse(params.projectId);
  const chapterId = idSchema.parse(params.chapterId);
  const chapter = service.getChapter(chapterId);
  if (!chapter || chapter.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError('INVALID_INPUT', 'Motion Plan update must be an object', 400);
  const { sceneId, ...input } = body as Record<string, unknown>;
  const parsedSceneId = idSchema.parse(sceneId);
  const scene = service.getScene(projectId, parsedSceneId);
  if (!scene || scene.projectId !== projectId || scene.chapterId !== chapterId)
    throw new AppError('NOT_FOUND', 'Scene not found', 404);
  return service.updateMotionPlan(projectId, parsedSceneId, input);
});
app.post('/api/projects/:projectId/chapters/:chapterId/timeline/motion', async (request, reply) => {
  const params = request.params as { projectId: string; chapterId: string };
  const projectId = idSchema.parse(params.projectId);
  const chapterId = idSchema.parse(params.chapterId);
  const chapter = service.getChapter(chapterId);
  if (!chapter || chapter.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const rawBody = request.body;
  if (rawBody !== undefined && (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)))
    throw new AppError('INVALID_INPUT', 'Motion Plan request must be an object', 400);
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => key !== 'replace') ||
    (body.replace !== undefined && typeof body.replace !== 'boolean')
  )
    throw new AppError('INVALID_INPUT', 'Motion Plan request is invalid', 400);
  const replace = body.replace ?? false;
  return reply.code(202).send(service.scheduleMotionPlan(chapterId, replace));
});
app.get('/api/projects/:id/render/plan', async (request) => {
  const params = request.params as { id: string };
  const query = request.query as RenderScopeQuery & {
    source?: string;
    autoBuild?: string;
    fallbackPolicy?: string;
    qualityPreset?: string;
    fitMode?: string;
  };
  const scope = parseRenderScope(query);
  return service.getRenderPlan(
    idSchema.parse(params.id),
    renderRequestSchema.parse({
      source: query.source ?? 'SCENES',
      autoBuild: query.autoBuild === 'true',
      ...(query.fallbackPolicy ? { fallbackPolicy: query.fallbackPolicy } : {}),
      ...(query.qualityPreset ? { qualityPreset: query.qualityPreset } : {}),
      ...(query.fitMode ? { fitMode: query.fitMode } : {}),
      ...(scope ? { scope } : {}),
    }),
  );
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
app.get('/api/projects/:projectId/scenes/:sceneId/video', async (request) => {
  const params = request.params as { projectId: string; sceneId: string };
  const projectId = idSchema.parse(params.projectId);
  const sceneId = idSchema.parse(params.sceneId);
  const scene = service.getScene(projectId, sceneId);
  if (!scene || scene.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Scene video not found', 404);
  const row = database.sqlite
    .prepare(
      `SELECT a.id,a.type,a.role,a.status,a.media_type as mediaType,a.bytes,a.sha256,
        a.input_fingerprint as inputFingerprint,a.metadata
       FROM assets a
       WHERE a.project_id=? AND a.source_entity_id=? AND a.type='SCENE_VIDEO_CLIP'
         AND a.is_current=1 AND a.status='READY' LIMIT 1`,
    )
    .get(projectId, sceneId) as PublicRenderAssetRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Scene video not found', 404);
  return publicRenderAsset(row);
});
app.get('/api/projects/:projectId/chapters/:chapterId/video', async (request) => {
  const params = request.params as { projectId: string; chapterId: string };
  const projectId = idSchema.parse(params.projectId);
  const chapterId = idSchema.parse(params.chapterId);
  const chapter = service.getChapter(chapterId);
  if (!chapter || chapter.projectId !== projectId)
    throw new AppError('NOT_FOUND', 'Chapter video not found', 404);
  const row = database.sqlite
    .prepare(
      `SELECT id,type,role,status,media_type as mediaType,bytes,sha256,
        input_fingerprint as inputFingerprint,metadata
       FROM assets
       WHERE project_id=? AND source_entity_id=? AND type='CHAPTER_VIDEO'
         AND is_current=1 AND status='READY' LIMIT 1`,
    )
    .get(projectId, chapterId) as PublicRenderAssetRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Chapter video not found', 404);
  return publicRenderAsset(row);
});
app.get('/api/projects/:projectId/video', async (request) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  const scope = parseRenderScope(request.query as RenderScopeQuery);
  const row = database.sqlite
    .prepare(
      `SELECT id,type,role,status,media_type as mediaType,bytes,sha256,
        a.input_fingerprint as inputFingerprint,a.metadata
       FROM assets a
       WHERE a.project_id=? AND a.role=? AND a.type='PROJECT_VIDEO'
         AND a.is_current=1 AND a.status='READY' LIMIT 1`,
    )
    .get(projectId, projectVideoRole(projectId, scope)) as PublicRenderAssetRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Project video not found', 404);
  return publicRenderAsset(row);
});
app.post('/api/projects/:id/render', async (request, reply) => {
  const params = request.params as { id: string };
  const projectId = idSchema.parse(params.id);
  const rawBody = request.body;
  if (
    !rawBody ||
    typeof rawBody !== 'object' ||
    Array.isArray(rawBody) ||
    Object.keys(rawBody).length === 0
  )
    return reply.code(202).send({ jobId: service.scheduleRender(projectId) });
  const renderRequest = renderRequestSchema.parse(rawBody);
  if (renderRequest.source === 'BACKGROUND')
    return reply.code(202).send({ jobId: service.scheduleRender(projectId) });
  const scheduled = await service.scheduleTimelineRender(projectId, renderRequest);
  return reply.code(202).send({
    executionId: scheduled.executionId,
    jobIds: scheduled.jobIds,
    jobId: scheduled.jobIds.at(-1) ?? null,
    plan: scheduled.plan,
  });
});
app.get('/api/jobs/:id', async (request) => {
  const params = request.params as { id: string };
  const row = database.sqlite
    .prepare(
      'SELECT id,type,entity_id as entityId,step_id as stepId,status,progress,error,attempts,created_at as createdAt,started_at as startedAt,completed_at as completedAt FROM jobs WHERE id=?',
    )
    .get(idSchema.parse(params.id)) as (Record<string, unknown> & { stepId?: string }) | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Job not found', 404);
  const render = row.stepId ? new RenderJobRepository(database).getByStep(row.stepId) : null;
  return { ...row, render };
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
