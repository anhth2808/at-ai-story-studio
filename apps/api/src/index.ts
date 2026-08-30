import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createDatabase } from '@studio/database';
import {
  initializeWorkspace,
  ProcessRunner,
  FfmpegTools,
  safeWorkspacePath,
  sha256File,
  contentTypeFor,
  relativeAssetPath,
  prepareProjectDirectories,
} from '@studio/media';
import {
  AppError,
  chapterInputSchema,
  projectInputSchema,
  projectUpdateSchema,
  reorderSchema,
  renderConfigSchema,
  idSchema,
} from '@studio/shared';
import { StudioService } from '@studio/workflow';
import { WorkflowRepository } from '@studio/database';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
database.sqlite.exec(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../packages/database/migrations/0000_initial.sql',
    ),
    'utf8',
  ),
);
const workspace = await initializeWorkspace(root);
const runner = new ProcessRunner();
const media = new FfmpegTools(runner);
const context = { database, workspace, media, runner };
const service = new StudioService(context);

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
app.get('/api/projects/:id/render', async (request) => {
  const params = request.params as { id: string };
  const projectId = idSchema.parse(params.id);
  const row = database.sqlite
    .prepare(
      "SELECT id,type,path,media_type as mediaType,bytes,sha256 FROM assets WHERE project_id=? AND role='project:render' AND is_current=1",
    )
    .get(projectId) as
    | { id: string; type: string; path: string; mediaType: string; bytes: number; sha256: string }
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Rendered video not found', 404);
  return { ...row, url: `/api/assets/${row.id}` };
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError)
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
  app.log.error(error);
  return reply
    .code(500)
    .send({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});
app.post('/api/projects/:projectId/assets', async (request, reply) => {
  const params = request.params as { projectId: string };
  const projectId = idSchema.parse(params.projectId);
  const part = await request.file();
  if (!part) throw new AppError('INVALID_UPLOAD', 'File is required');
  const kind = part.mimetype.startsWith('image/')
    ? 'BACKGROUND_IMAGE'
    : part.mimetype.startsWith('video/')
      ? 'BACKGROUND_VIDEO'
      : part.mimetype.startsWith('audio/')
        ? 'MUSIC'
        : null;
  if (!kind)
    throw new AppError('INVALID_UPLOAD', 'Only image, video, or audio uploads are supported');
  const assetId = randomUUID();
  const target = join(
    workspace.projects,
    projectId,
    kind === 'MUSIC' ? 'music' : 'backgrounds',
    `${assetId}${part.filename.includes('.') ? part.filename.slice(part.filename.lastIndexOf('.')) : ''}`,
  );
  await mkdir(join(workspace.projects, projectId, kind === 'MUSIC' ? 'music' : 'backgrounds'), {
    recursive: true,
  });
  await pipeline(part.file, createWriteStream(target));
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
    metadata: { displayName: part.filename },
  });
  service.invalidateRenderForAsset(projectId);
  return reply.code(201).send({ id: assetId, type: kind });
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
  return { project, chapters: service.listChapters(id) };
});
app.patch('/api/projects/:id', async (request) => {
  const params = request.params as { id: string };
  return service.updateProject(idSchema.parse(params.id), projectUpdateSchema.parse(request.body));
});
app.delete('/api/projects/:id', async (request, reply) => {
  const params = request.params as { id: string };
  service.deleteProject(idSchema.parse(params.id));
  return reply.code(204).send();
});
app.get('/api/projects/:projectId/chapters', async (request) => {
  const params = request.params as { projectId: string };
  return service.listChapters(idSchema.parse(params.projectId));
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
app.get('/api/assets/:id', async (request, reply) => {
  const params = request.params as { id: string };
  const row = database.sqlite
    .prepare('SELECT path,media_type as mediaType,bytes FROM assets WHERE id=?')
    .get(idSchema.parse(params.id)) as
    { path: string; mediaType: string; bytes: number } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Asset not found', 404);
  const filename = safeWorkspacePath(workspace.root, row.path);
  return reply.type(row.mediaType).send(createReadStream(filename));
});

await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`API listening on http://127.0.0.1:${port}`);
