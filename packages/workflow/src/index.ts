import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AssetRepository,
  ChapterRepository,
  ProjectRepository,
  WorkflowRepository,
  type ClaimedStep,
  type DatabaseHandle,
} from '@studio/database';
import {
  FfmpegTools,
  ProcessRunner,
  type WorkspacePaths,
  initializeWorkspace,
  promoteFile,
  relativeAssetPath,
  sha256File,
} from '@studio/media';
import {
  AppError,
  type ChapterInput,
  type Id,
  type ProjectInput,
  renderConfigSchema,
} from '@studio/shared';
import { cleanNarrationText, segmentText, serializeSrt, subtitlesFromSegments } from './text.js';

export type StudioContext = {
  database: DatabaseHandle;
  workspace: WorkspacePaths;
  media: FfmpegTools;
  runner: ProcessRunner;
};
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = (): string => new Date().toISOString();

export class StudioService {
  readonly projects: ProjectRepository;
  readonly chapters: ChapterRepository;
  readonly workflow: WorkflowRepository;
  readonly assets: AssetRepository;
  constructor(private readonly context: StudioContext) {
    this.projects = new ProjectRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.assets = new AssetRepository(context.database);
  }
  createProject(input: ProjectInput): ReturnType<ProjectRepository['create']> {
    return this.projects.create(input);
  }
  listProjects(): ReturnType<ProjectRepository['list']> {
    return this.projects.list();
  }
  getProject(id: Id): ReturnType<ProjectRepository['get']> {
    return this.projects.get(id);
  }
  updateProject(id: Id, input: Partial<ProjectInput>): ReturnType<ProjectRepository['update']> {
    return this.projects.update(id, input);
  }
  deleteProject(id: Id): void {
    this.projects.delete(id);
  }
  listChapters(projectId: Id): ReturnType<ChapterRepository['list']> {
    return this.chapters.list(projectId);
  }
  getChapter(id: Id): ReturnType<ChapterRepository['get']> {
    return this.chapters.get(id);
  }
  createChapter(projectId: Id, input: ChapterInput): ReturnType<ChapterRepository['create']> {
    return this.chapters.create(projectId, input);
  }
  updateChapter(id: Id, input: ChapterInput): ReturnType<ChapterRepository['update']> {
    const chapter = this.chapters.update(id, input);
    if (input.content) this.invalidateChapterDescendants(chapter.projectId, chapter.id);
    return chapter;
  }
  deleteChapter(id: Id): void {
    this.chapters.delete(id);
  }
  reorderChapters(projectId: Id, ids: Id[]): ReturnType<ChapterRepository['list']> {
    return this.chapters.reorder(projectId, ids);
  }
  setRenderConfig(projectId: Id, input: unknown): void {
    this.projects.setRenderConfig(projectId, renderConfigSchema.parse(input));
    this.invalidateRender(projectId);
  }
  getRenderConfig(projectId: Id) {
    return renderConfigSchema.parse({
      ...renderConfigSchema.parse({}),
      ...this.projects.getRenderConfig(projectId),
    });
  }
  scheduleChapterTts(chapterId: Id): { executionId: Id; jobIds: Id[] } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'CHAPTER_AUDIO');
    const cleanId = this.workflow.createStep(
      executionId,
      `clean:${chapter.id}:${chapter.revision}`,
      'CLEAN_TEXT',
      chapter.id,
      fingerprint({ chapterId, revision: chapter.revision, content: chapter.content }),
    );
    const segments = segmentText(cleanNarrationText(chapter.content).text);
    const jobIds: Id[] = [];
    let prior = cleanId;
    for (const segment of segments) {
      const stepId = this.workflow.createStep(
        executionId,
        `tts:${chapter.id}:${segment.index}:${segment.textHash}`,
        'TTS_SEGMENT',
        chapter.id,
        fingerprint({ chapterId, revision: chapter.revision, segment: segment.textHash }),
      );
      this.workflow.dependency(stepId, prior);
      const existing = this.context.database.sqlite
        .prepare(
          'SELECT t.id,t.status,t.text_hash as textHash,t.audio_asset_id as audioAssetId FROM tts_segments t LEFT JOIN assets a ON a.id=t.audio_asset_id WHERE t.chapter_id=? AND t.segment_index=?',
        )
        .get(chapter.id, segment.index) as
        { id: Id; status: string; textHash: string; audioAssetId: Id | null } | undefined;
      if (existing?.audioAssetId && existing.textHash === segment.textHash) {
        this.workflow.markCompleted(stepId);
        this.context.database.sqlite
          .prepare(
            "UPDATE tts_segments SET id=?,status='COMPLETED',error=NULL WHERE chapter_id=? AND segment_index=?",
          )
          .run(stepId, chapter.id, segment.index);
      } else if (existing) {
        this.context.database.sqlite
          .prepare(
            "UPDATE tts_segments SET id=?,text=?,text_hash=?,status='PENDING',audio_asset_id=NULL,duration_ms=NULL,error=NULL,fingerprint=? WHERE chapter_id=? AND segment_index=?",
          )
          .run(
            stepId,
            segment.text,
            segment.textHash,
            fingerprint({ chapterId, revision: chapter.revision, segment: segment.textHash }),
            chapter.id,
            segment.index,
          );
        jobIds.push(this.workflow.createJob('TTS_SEGMENT', chapter.id, stepId));
      } else {
        this.context.database.sqlite
          .prepare(
            'INSERT INTO tts_segments(id,chapter_id,segment_index,text,text_hash,status,fingerprint) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            stepId,
            chapter.id,
            segment.index,
            segment.text,
            segment.textHash,
            'PENDING',
            fingerprint({ chapterId, revision: chapter.revision, segment: segment.textHash }),
          );
        jobIds.push(this.workflow.createJob('TTS_SEGMENT', chapter.id, stepId));
      }
      prior = stepId;
    }
    const mergeId = this.workflow.createStep(
      executionId,
      `merge:${chapter.id}:${chapter.revision}`,
      'MERGE_AUDIO',
      chapter.id,
      fingerprint({
        chapterId,
        revision: chapter.revision,
        segments: segments.map((segment) => segment.textHash),
      }),
    );
    this.workflow.dependency(mergeId, prior);
    jobIds.push(this.workflow.createJob('MERGE_AUDIO', chapter.id, mergeId));
    return { executionId, jobIds };
  }
  scheduleSubtitle(chapterId: Id): Id {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'SUBTITLE');
    const step = this.workflow.createStep(
      executionId,
      `subtitle:${chapter.id}:${chapter.revision}`,
      'SUBTITLE',
      chapter.id,
      fingerprint({ chapterId, revision: chapter.revision }),
    );
    return this.workflow.createJob('SUBTITLE', chapter.id, step);
  }
  scheduleRender(projectId: Id): Id {
    const project = this.projects.get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const executionId = this.workflow.createExecution(projectId, 'RENDER');
    const step = this.workflow.createStep(
      executionId,
      `render:${projectId}`,
      'RENDER',
      projectId,
      fingerprint({ projectId, config: this.getRenderConfig(projectId) }),
    );
    return this.workflow.createJob('RENDER', projectId, step);
  }
  invalidateRenderForAsset(projectId: Id): void {
    this.invalidateRender(projectId);
  }
  private invalidateChapterDescendants(projectId: Id, chapterId: Id): void {
    for (const role of [`chapter:${chapterId}:audio`, `chapter:${chapterId}:subtitle`])
      this.assets.invalidateRole(projectId, role);
    this.invalidateRender(projectId);
  }
  private invalidateRender(projectId: Id): void {
    this.assets.invalidateRole(projectId, 'project:render');
    this.context.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET status='INVALIDATED',updated_at=? WHERE entity_id=? AND type='RENDER' AND status IN ('COMPLETED','FAILED')",
      )
      .run(stamp(), projectId);
  }
}

export type TtsProvider = {
  synthesize(text: string, voice: string, outputFile: string, signal?: AbortSignal): Promise<void>;
};
export class EdgeTtsProvider implements TtsProvider {
  private readonly script = fileURLToPath(new URL('./edge-tts-cli.js', import.meta.url));
  constructor(
    private readonly runner: ProcessRunner,
    private readonly executable = process.env.EDGE_TTS_COMMAND ?? process.execPath,
  ) {}
  async synthesize(
    text: string,
    voice: string,
    outputFile: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const argumentsList =
      this.executable === process.execPath
        ? [this.script, text, voice, outputFile]
        : ['--voice', voice, '--text', text, '--write-media', outputFile];
    const options = { executable: this.executable, arguments: argumentsList, timeoutMs: 120_000 };
    if (signal) await this.runner.run({ ...options, signal });
    else await this.runner.run(options);
  }
}

export class WorkerExecutor {
  constructor(
    private readonly context: StudioContext,
    private readonly workerId: string,
    private readonly tts: TtsProvider = new EdgeTtsProvider(context.runner),
  ) {}
  async execute(step: ClaimedStep): Promise<void> {
    if (step.type === 'CLEAN_TEXT') return;
    if (step.type === 'TTS_SEGMENT') {
      await this.executeTts(step);
      return;
    }
    if (step.type === 'MERGE_AUDIO') {
      await this.executeMerge(step);
      return;
    }
    if (step.type === 'SUBTITLE') {
      await this.executeSubtitle(step);
      return;
    }
    if (step.type === 'RENDER') {
      await this.executeRender(step);
      return;
    }
    throw new Error(`Unknown workflow step: ${step.type}`);
  }
  private async executeTts(step: ClaimedStep): Promise<void> {
    const chapter = this.context.database.sqlite
      .prepare('SELECT * FROM chapters WHERE id=?')
      .get(step.entity_id) as { project_id: Id; content: string; id: Id } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    const text = segmentText(cleanNarrationText(chapter.content).text).find(
      (item) =>
        fingerprint({ chapterId: chapter.id, revision: 1, segment: item.textHash }) ===
          step.input_fingerprint || item.textHash === step.step_key.split(':').at(-1),
    );
    if (!text) throw new Error('TTS segment not found');
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const output = join(staging, `${step.id}.mp3`);
    await this.tts.synthesize(
      text.text,
      process.env.EDGE_TTS_VOICE ?? 'vi-VN-HoaiMyNeural',
      output,
    );
    const probe = await this.context.media.probe(output);
    const format = probe['format'] as { duration?: string } | undefined;
    const durationMs = Math.round(Number(format?.duration ?? 0) * 1000);
    if (!durationMs) throw new Error('TTS produced no duration');
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.project_id,
      'audio',
      'segments',
      `${chapter.id}-${step.id}.mp3`,
    );
    await promoteFile(output, destination);
    const assetId = randomUUID();
    new AssetRepository(this.context.database).register({
      id: assetId,
      projectId: chapter.project_id,
      type: 'TTS_SEGMENT_AUDIO',
      role: `segment:${step.id}`,
      path: relativeAssetPath(this.context.workspace.root, destination),
      mediaType: 'audio/mpeg',
      bytes: digest.bytes,
      sha256: digest.hash,
      sourceEntityId: chapter.id,
      sourceStepId: step.id,
      inputFingerprint: step.input_fingerprint,
      metadata: { durationMs },
    });
    this.context.database.sqlite
      .prepare(
        "UPDATE tts_segments SET status='COMPLETED',audio_asset_id=?,duration_ms=?,error=NULL WHERE id=?",
      )
      .run(assetId, durationMs, step.id);
  }
  private async executeMerge(step: ClaimedStep): Promise<void> {
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    const rows = this.context.database.sqlite
      .prepare(
        "SELECT a.path FROM tts_segments t JOIN assets a ON a.id=t.audio_asset_id WHERE t.chapter_id=? AND t.status='COMPLETED' AND a.is_current=1 ORDER BY t.segment_index",
      )
      .all(chapter.id) as Array<{ path: string }>;
    if (!rows.length) throw new Error('No completed TTS segments');
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const list = join(staging, 'concat.txt');
    await writeFile(
      list,
      rows
        .map((row) => `file '${join(this.context.workspace.root, row.path).replaceAll('\\', '/')}'`)
        .join('\n'),
      'utf8',
    );
    const output = join(staging, 'chapter.mp3');
    await this.context.media.run([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-c',
      'copy',
      output,
    ]);
    const probe = await this.context.media.probe(output);
    const durationMs = Math.round(
      Number((probe['format'] as { duration?: string })?.duration ?? 0) * 1000,
    );
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'audio',
      `${chapter.id}-${step.id}.mp3`,
    );
    await promoteFile(output, destination);
    new AssetRepository(this.context.database).register({
      id: randomUUID(),
      projectId: chapter.projectId,
      type: 'CHAPTER_AUDIO',
      role: `chapter:${chapter.id}:audio`,
      path: relativeAssetPath(this.context.workspace.root, destination),
      mediaType: 'audio/mpeg',
      bytes: digest.bytes,
      sha256: digest.hash,
      sourceEntityId: chapter.id,
      sourceStepId: step.id,
      inputFingerprint: step.input_fingerprint,
      metadata: { durationMs },
    });
  }
  private async executeSubtitle(step: ClaimedStep): Promise<void> {
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    const segments = this.context.database.sqlite
      .prepare(
        "SELECT text,duration_ms as durationMs FROM tts_segments WHERE chapter_id=? AND status='COMPLETED' ORDER BY segment_index",
      )
      .all(chapter.id) as Array<{ text: string; durationMs: number }>;
    if (!segments.length || segments.some((segment) => !segment.durationMs))
      throw new Error('TTS durations are incomplete');
    const srt = serializeSrt(subtitlesFromSegments(segments));
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const output = join(staging, 'chapter.srt');
    await writeFile(output, srt, 'utf8');
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'subtitles',
      `${chapter.id}-${step.id}.srt`,
    );
    await promoteFile(output, destination);
    new AssetRepository(this.context.database).register({
      id: randomUUID(),
      projectId: chapter.projectId,
      type: 'SUBTITLE',
      role: `chapter:${chapter.id}:subtitle`,
      path: relativeAssetPath(this.context.workspace.root, destination),
      mediaType: 'text/plain',
      bytes: digest.bytes,
      sha256: digest.hash,
      sourceEntityId: chapter.id,
      sourceStepId: step.id,
      inputFingerprint: step.input_fingerprint,
    });
  }
  private async executeRender(step: ClaimedStep): Promise<void> {
    const projectId = step.entity_id;
    const chapter = this.context.database.sqlite
      .prepare('SELECT id FROM chapters WHERE project_id=? ORDER BY number LIMIT 1')
      .get(projectId) as { id: Id } | undefined;
    const audio = chapter
      ? (this.context.database.sqlite
          .prepare('SELECT path FROM assets WHERE project_id=? AND role=? AND is_current=1')
          .get(projectId, `chapter:${chapter.id}:audio`) as { path: string } | undefined)
      : undefined;
    const background = this.context.database.sqlite
      .prepare(
        "SELECT path,type FROM assets WHERE project_id=? AND role='project:background' AND is_current=1",
      )
      .get(projectId) as { path: string; type: string } | undefined;
    const subtitle = chapter
      ? (this.context.database.sqlite
          .prepare('SELECT path FROM assets WHERE project_id=? AND role=? AND is_current=1')
          .get(projectId, `chapter:${chapter.id}:subtitle`) as { path: string } | undefined)
      : undefined;
    const music = this.context.database.sqlite
      .prepare(
        "SELECT path FROM assets WHERE project_id=? AND role='project:music' AND is_current=1",
      )
      .get(projectId) as { path: string } | undefined;
    if (!audio || !background) throw new Error('Current chapter audio and background are required');
    const project = this.context.database.sqlite
      .prepare('SELECT render_config as renderConfig FROM projects WHERE id=?')
      .get(projectId) as { renderConfig: string };
    const config = renderConfigSchema.parse(JSON.parse(project.renderConfig));
    const audioPath = join(this.context.workspace.root, audio.path);
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const output = join(staging, 'render.mp4');
    const probe = await this.context.media.probe(audioPath);
    const duration = Number((probe.format as { duration?: string } | undefined)?.duration ?? 0);
    if (!duration) throw new Error('Narration has no duration');
    const videoInput =
      background.type === 'BACKGROUND_IMAGE'
        ? ['-loop', '1', '-i', background.path]
        : ['-stream_loop', '-1', '-i', background.path];
    const subtitleFilter = subtitle ? `,subtitles=${subtitle.path.replaceAll('\\\\', '/')}` : '';
    const scale = `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`;
    const musicPath = config.musicEnabled && music ? music.path : null;
    const audioInput = musicPath
      ? ['-i', audio.path, '-stream_loop', '-1', '-i', musicPath]
      : ['-i', audio.path];
    const audioFilter = musicPath
      ? [
          '-filter_complex',
          `[1:a]volume=${config.narrationVolume}[n];[2:a]volume=${config.musicVolume}[m];[n][m]amix=inputs=2:duration=first:dropout_transition=2[a]`,
          '-map',
          '0:v:0',
          '-map',
          '[a]',
        ]
      : ['-map', '0:v:0', '-map', '1:a:0'];
    await this.context.media.run(
      [
        '-y',
        ...videoInput,
        ...audioInput,
        '-t',
        String(duration),
        '-vf',
        scale,
        ...audioFilter,
        '-r',
        String(config.fps),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        relativeAssetPath(this.context.workspace.root, output),
      ],
      { cwd: this.context.workspace.root },
    );
    const outputProbe = await this.context.media.probe(output);
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      projectId,
      'renders',
      `${step.id}.mp4`,
    );
    await promoteFile(output, destination);
    new AssetRepository(this.context.database).register({
      id: randomUUID(),
      projectId,
      type: 'RENDERED_VIDEO',
      role: 'project:render',
      path: relativeAssetPath(this.context.workspace.root, destination),
      mediaType: 'video/mp4',
      bytes: digest.bytes,
      sha256: digest.hash,
      sourceEntityId: projectId,
      sourceStepId: step.id,
      inputFingerprint: step.input_fingerprint,
      metadata: { duration, probe: outputProbe },
    });
  }
}

export async function createContext(root: string, db: DatabaseHandle): Promise<StudioContext> {
  const workspace = await initializeWorkspace(root);
  return {
    database: db,
    workspace,
    runner: new ProcessRunner(),
    media: new FfmpegTools(new ProcessRunner()),
  };
}
