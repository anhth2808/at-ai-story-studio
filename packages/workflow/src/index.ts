import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AssetRepository,
  ChapterRepository,
  ProjectRepository,
  StoryRepository,
  WorkflowRepository,
  type ClaimedStep,
  type DatabaseHandle,
} from '@studio/database';
import {
  FfmpegTools,
  ProcessRunner,
  buildConcatArguments,
  buildRenderArguments,
  type WorkspacePaths,
  initializeWorkspace,
  promoteFile,
  relativeAssetPath,
  sha256File,
} from '@studio/media';
import {
  AppError,
  type ChapterDto,
  type ChapterInput,
  type Id,
  type JobDto,
  type ProjectDto,
  type ProjectInput,
  type StatusSummary,
  type WorkflowStatus,
  renderConfigSchema,
} from '@studio/shared';
import { cleanNarrationText, segmentText, serializeSrt, subtitlesFromSegments } from './text.js';
import type { StoryEngine } from './story-engine.js';

export type StudioContext = {
  database: DatabaseHandle;
  workspace: WorkspacePaths;
  media: FfmpegTools;
  runner: ProcessRunner;
};
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class StudioService {
  readonly projects: ProjectRepository;
  readonly chapters: ChapterRepository;
  readonly story: StoryRepository;
  readonly workflow: WorkflowRepository;
  readonly assets: AssetRepository;
  constructor(private readonly context: StudioContext) {
    this.projects = new ProjectRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.story = new StoryRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.assets = new AssetRepository(context.database);
  }
  createProject(input: ProjectInput): ProjectDto {
    return this.projects.create(input);
  }
  listProjects(): ProjectDto[] {
    return this.projects.list();
  }
  getProject(id: Id): ProjectDto | null {
    return this.projects.get(id);
  }
  updateProject(id: Id, input: Partial<ProjectInput>): ProjectDto {
    if (!this.projects.get(id)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.projects.update(id, input);
  }
  deleteProject(id: Id): void {
    if (!this.projects.get(id)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    this.projects.delete(id);
    rmSync(join(this.context.workspace.projects, id), { recursive: true, force: true });
  }
  listChapters(projectId: Id): ChapterDto[] {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.chapters.list(projectId);
  }
  getChapter(id: Id): ChapterDto | null {
    return this.chapters.get(id);
  }
  createChapter(projectId: Id, input: ChapterInput): ChapterDto {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.chapters.create(projectId, input);
  }
  updateChapter(id: Id, input: ChapterInput): ChapterDto {
    const current = this.chapters.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const contentChanged = input.content !== current.content;
    let chapter: ChapterDto;
    try {
      chapter = this.chapters.update(id, input);
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      throw error;
    }
    if (contentChanged) this.invalidateChapterDescendants(chapter.projectId, chapter.id);
    return chapter;
  }
  deleteChapter(id: Id): void {
    const chapter = this.chapters.get(id);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    this.chapters.delete(id);
    this.invalidateRender(chapter.projectId);
  }
  reorderChapters(projectId: Id, ids: Id[]): ChapterDto[] {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    try {
      return this.chapters.reorder(projectId, ids);
    } catch (error) {
      if (error instanceof Error && error.message === 'Complete chapter ordering is required')
        throw new AppError('INVALID_ORDER', error.message, 400);
      throw error;
    }
  }
  setRenderConfig(projectId: Id, input: unknown): void {
    this.projects.setRenderConfig(projectId, renderConfigSchema.parse(input));
    this.invalidateRender(projectId);
  }
  scheduleStoryBlueprint(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    if (!this.story.getSettings(projectId))
      throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-blueprint:${projectId}`,
      'GENERATE_STORY_BLUEPRINT',
      projectId,
      fingerprint({ operation: 'BLUEPRINT', settings: this.story.getSettings(projectId) }),
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_STORY_BLUEPRINT', projectId, stepId),
    };
  }
  scheduleStoryPlans(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const blueprint = this.story.getBlueprint(projectId);
    if (!blueprint) throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-plans:${projectId}:${blueprint.revision}`,
      'GENERATE_CHAPTER_PLANS',
      projectId,
      fingerprint({ operation: 'CHAPTER_PLANS', blueprint }),
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_PLANS', projectId, stepId),
    };
  }
  scheduleStoryStages(projectId: Id): { executionId: Id; jobIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    if (!this.story.getSettings(projectId))
      throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const blueprintStep = this.workflow.createStep(
      executionId,
      `story-blueprint:${projectId}`,
      'GENERATE_STORY_BLUEPRINT',
      projectId,
      fingerprint({ operation: 'BLUEPRINT', settings: this.story.getSettings(projectId) }),
    );
    const planStep = this.workflow.createStep(
      executionId,
      `story-plans:${projectId}`,
      'GENERATE_CHAPTER_PLANS',
      projectId,
      fingerprint({ operation: 'CHAPTER_PLANS', settings: this.story.getSettings(projectId) }),
    );
    this.workflow.dependency(planStep, blueprintStep);
    return {
      executionId,
      jobIds: [
        this.workflow.createJob('GENERATE_STORY_BLUEPRINT', projectId, blueprintStep),
        this.workflow.createJob('GENERATE_CHAPTER_PLANS', projectId, planStep),
      ],
    };
  }
  scheduleStoryChapter(projectId: Id, planItemId: string): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const item = this.story.getPlanItem(projectId, planItemId);
    if (!item) throw new AppError('PREREQUISITE_MISSING', 'Chapter plan item is required', 409);
    if (!this.story.getBlueprint(projectId))
      throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-chapter:${planItemId}`,
      'GENERATE_CHAPTER',
      planItemId,
      fingerprint({ operation: 'CHAPTER', projectId, planId: item.planId, planItem: item.item }),
    );
    return { executionId, jobId: this.workflow.createJob('GENERATE_CHAPTER', planItemId, stepId) };
  }
  scheduleStorySummary(chapterId: Id): { executionId: Id; jobId: Id } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-summary:${chapterId}:${chapter.revision}`,
      'GENERATE_CHAPTER_SUMMARY',
      chapterId,
      fingerprint({
        operation: 'CHAPTER_SUMMARY',
        chapterId,
        revision: chapter.revision,
        content: chapter.content,
      }),
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_SUMMARY', chapterId, stepId),
    };
  }
  getRenderConfig(projectId: Id) {
    return renderConfigSchema.parse({
      ...renderConfigSchema.parse({}),
      ...this.projects.getRenderConfig(projectId),
    });
  }
  getStatus(projectId: Id, chapterId?: Id): StatusSummary {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    if (chapterId) {
      const chapter = this.chapters.get(chapterId);
      if (!chapter || chapter.projectId !== projectId)
        throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    }
    const latestStep = (type: string, entityId: Id): WorkflowStatus => {
      const row = this.context.database.sqlite
        .prepare(
          'SELECT status FROM workflow_steps WHERE type=? AND entity_id=? ORDER BY updated_at DESC LIMIT 1',
        )
        .get(type, entityId) as { status: WorkflowStatus } | undefined;
      return row?.status ?? 'PENDING';
    };
    const jobs = this.context.database.sqlite
      .prepare(
        'SELECT id,type,entity_id as entityId,status,progress,error,attempts,created_at as createdAt,started_at as startedAt,completed_at as completedAt FROM jobs WHERE entity_id=? ORDER BY created_at DESC',
      )
      .all(chapterId ?? projectId) as JobDto[];
    const background = this.assets.current(projectId, 'project:background');
    return {
      projectId,
      ...(chapterId ? { chapterId } : {}),
      narration: chapterId ? latestStep('MERGE_AUDIO', chapterId) : 'PENDING',
      subtitles: chapterId ? latestStep('SUBTITLE', chapterId) : 'PENDING',
      background: background ? 'COMPLETED' : 'PENDING',
      render: latestStep('RENDER', projectId),
      jobs,
    };
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
      fingerprint({ chapterId, content: chapter.content }),
    );
    this.workflow.markCompleted(cleanId);
    const segments = segmentText(cleanNarrationText(chapter.content).text);
    const jobIds: Id[] = [];
    let prior = cleanId;
    for (const segment of segments) {
      const segmentFingerprint = fingerprint({ chapterId, segment: segment.textHash });
      const stepId = this.workflow.createStep(
        executionId,
        `tts:${chapter.id}:${segment.index}:${segment.textHash}`,
        'TTS_SEGMENT',
        chapter.id,
        segmentFingerprint,
      );
      this.workflow.dependency(stepId, prior);
      const existing = this.context.database.sqlite
        .prepare(
          "SELECT t.id,t.status,t.text_hash as textHash,t.audio_asset_id as audioAssetId FROM tts_segments t LEFT JOIN assets a ON a.id=t.audio_asset_id AND a.status='READY' AND a.is_current=1 WHERE t.chapter_id=? AND t.segment_index=?",
        )
        .get(chapter.id, segment.index) as
        { id: Id; status: string; textHash: string; audioAssetId: Id | null } | undefined;
      if (existing?.audioAssetId && existing.textHash === segment.textHash) {
        this.workflow.markCompleted(stepId);
        this.context.database.sqlite
          .prepare(
            "UPDATE tts_segments SET id=?,status='COMPLETED',fingerprint=?,error=NULL WHERE chapter_id=? AND segment_index=?",
          )
          .run(stepId, segmentFingerprint, chapter.id, segment.index);
      } else if (existing) {
        this.context.database.sqlite
          .prepare(
            "UPDATE tts_segments SET id=?,text=?,text_hash=?,status='PENDING',audio_asset_id=NULL,duration_ms=NULL,error=NULL,fingerprint=? WHERE chapter_id=? AND segment_index=?",
          )
          .run(
            stepId,
            segment.text,
            segment.textHash,
            segmentFingerprint,
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
            segmentFingerprint,
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
      fingerprint({ chapterId, content: chapter.content }),
    );
    return this.workflow.createJob('SUBTITLE', chapter.id, step);
  }
  private renderFingerprint(projectId: Id): string {
    const inputs = this.context.database.sqlite
      .prepare('SELECT role,sha256 FROM assets WHERE project_id=? AND is_current=1 ORDER BY role')
      .all(projectId) as Array<{ role: string; sha256: string }>;
    return fingerprint({ projectId, config: this.getRenderConfig(projectId), inputs });
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
      this.renderFingerprint(projectId),
    );
    return this.workflow.createJob('RENDER', projectId, step);
  }
  private invalidateRender(projectId: Id): void {
    this.assets.invalidateRole(projectId, 'project:render');
    this.workflow.invalidateSteps(projectId, ['RENDER']);
  }
  invalidateRenderForAsset(projectId: Id): void {
    this.invalidateRender(projectId);
  }
  private invalidateChapterDescendants(projectId: Id, chapterId: Id): void {
    this.story.invalidateScope({ projectId, kind: 'CHAPTER', chapterId });
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
  private readonly workflow: WorkflowRepository;
  constructor(
    private readonly context: StudioContext,
    private readonly workerId: string,
    private readonly tts: TtsProvider = new EdgeTtsProvider(context.runner),
    private readonly storyEngine?: StoryEngine,
  ) {
    this.workflow = new WorkflowRepository(context.database);
  }
  async execute(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new AppError('CANCELLED', 'Work was cancelled', 409);
    if (
      step.type === 'GENERATE_STORY_BLUEPRINT' ||
      step.type === 'GENERATE_CHAPTER_PLANS' ||
      step.type === 'GENERATE_CHAPTER' ||
      step.type === 'GENERATE_CHAPTER_SUMMARY'
    ) {
      if (!this.storyEngine)
        throw new AppError('CONFIGURATION_ERROR', 'Story Engine worker is not configured', 500);
      await this.storyEngine.executeStep(step, signal, (event) => {
        const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
          event.stage
        ];
        this.workflow.progress(step, progress, event.message);
      });
      return;
    }
    if (step.type === 'CLEAN_TEXT') return;
    if (step.type === 'TTS_SEGMENT') {
      await this.executeTts(step, signal);
      return;
    }
    if (step.type === 'MERGE_AUDIO') {
      await this.executeMerge(step, signal);
      return;
    }
    if (step.type === 'SUBTITLE') {
      await this.executeSubtitle(step);
      return;
    }
    if (step.type === 'RENDER') {
      await this.executeRender(step, signal);
      return;
    }
    throw new Error(`Unknown workflow step: ${step.type}`);
  }
  private stepIsCurrent(step: ClaimedStep): boolean {
    const current = this.context.database.sqlite
      .prepare(
        "SELECT 1 FROM workflow_steps WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=? AND input_fingerprint=?",
      )
      .get(step.id, step.attemptId, this.workerId, step.input_fingerprint);
    return Boolean(current);
  }
  private async executeTts(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const segment = this.context.database.sqlite
      .prepare(
        'SELECT chapter_id as chapterId,text,text_hash as textHash,status,fingerprint FROM tts_segments WHERE id=? AND chapter_id=?',
      )
      .get(step.id, step.entity_id) as
      | { chapterId: Id; text: string; textHash: string; status: string; fingerprint: string }
      | undefined;
    if (!segment || segment.fingerprint !== step.input_fingerprint || segment.status !== 'PENDING')
      throw new Error('TTS segment is stale or unavailable');
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    if (!this.stepIsCurrent(step)) throw new Error('TTS segment input is stale');
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const output = join(staging, `${step.id}.mp3`);
    await this.tts.synthesize(
      segment.text,
      process.env.EDGE_TTS_VOICE ?? 'vi-VN-HoaiMyNeural',
      output,
      signal,
    );
    if (!this.stepIsCurrent(step)) throw new Error('TTS segment input changed during synthesis');
    const probe = await this.context.media.probe(output);
    const format = probe['format'] as { duration?: string } | undefined;
    const durationMs = Math.round(Number(format?.duration ?? 0) * 1000);
    if (!durationMs) throw new Error('TTS produced no duration');
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'audio',
      'segments',
      `${chapter.id}-${step.id}.mp3`,
    );
    await promoteFile(output, destination);
    const assetId = randomUUID();
    const assets = new AssetRepository(this.context.database);
    const registered = assets.registerIfCurrentStep(
      {
        id: assetId,
        projectId: chapter.projectId,
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
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(destination, { force: true });
      throw new Error('TTS segment input changed before promotion');
    }
    const result = this.context.database.sqlite
      .prepare(
        "UPDATE tts_segments SET status='COMPLETED',audio_asset_id=?,duration_ms=?,error=NULL WHERE id=? AND fingerprint=?",
      )
      .run(assetId, durationMs, step.id, step.input_fingerprint);
    if (result.changes !== 1) {
      assets.invalidateRole(chapter.projectId, `segment:${step.id}`);
      throw new Error('TTS segment record changed before completion');
    }
  }
  private async executeMerge(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    const rows = this.context.database.sqlite
      .prepare(
        'SELECT t.status,t.text_hash as textHash,a.path,a.status as assetStatus,a.is_current as isCurrent FROM tts_segments t LEFT JOIN assets a ON a.id=t.audio_asset_id WHERE t.chapter_id=? ORDER BY t.segment_index',
      )
      .all(chapter.id) as Array<{
      status: string;
      textHash: string;
      path: string | null;
      assetStatus: string | null;
      isCurrent: number | null;
    }>;
    const expectedFingerprint = fingerprint({
      chapterId: chapter.id,
      segments: rows.map((row) => row.textHash),
    });
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.status !== 'COMPLETED' ||
          !row.path ||
          row.assetStatus !== 'READY' ||
          row.isCurrent !== 1,
      ) ||
      expectedFingerprint !== step.input_fingerprint
    )
      throw new Error('TTS segments are incomplete or stale');
    if (!this.stepIsCurrent(step)) throw new Error('Merge input is stale');
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const list = join(staging, 'concat.txt');
    await writeFile(
      list,
      rows
        .map(
          (row) => `file '${join(this.context.workspace.root, row.path!).replaceAll('\\', '/')}'`,
        )
        .join('\n'),
      'utf8',
    );
    const output = join(staging, 'chapter.mp3');
    await this.context.media.run(buildConcatArguments(list, output), { signal });
    if (!this.stepIsCurrent(step)) throw new Error('Merge input changed during execution');
    const probe = await this.context.media.probe(output);
    const durationMs = Math.round(
      Number((probe['format'] as { duration?: string })?.duration ?? 0) * 1000,
    );
    if (!durationMs) throw new Error('Merged audio produced no duration');
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'audio',
      `${chapter.id}-${step.id}.mp3`,
    );
    await promoteFile(output, destination);
    const assets = new AssetRepository(this.context.database);
    const registered = assets.registerIfCurrentStep(
      {
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
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(destination, { force: true });
      throw new Error('Merge input changed before promotion');
    }
  }
  private async executeSubtitle(step: ClaimedStep): Promise<void> {
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id,content FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id; content: string } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    if (
      fingerprint({ chapterId: chapter.id, content: chapter.content }) !== step.input_fingerprint ||
      !this.stepIsCurrent(step)
    )
      throw new Error('Subtitle input is stale');
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
    if (!this.stepIsCurrent(step)) throw new Error('Subtitle input changed during execution');
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'subtitles',
      `${chapter.id}-${step.id}.srt`,
    );
    await promoteFile(output, destination);
    const assets = new AssetRepository(this.context.database);
    const registered = assets.registerIfCurrentStep(
      {
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
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(destination, { force: true });
      throw new Error('Subtitle input changed before promotion');
    }
  }
  private async executeRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
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
    if (!audio || !background || !subtitle)
      throw new Error('Current chapter audio, subtitles, and background are required');
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
    const musicPath =
      config.musicEnabled && music ? join(this.context.workspace.root, music.path) : undefined;
    const backgroundPath = join(this.context.workspace.root, background.path);
    const subtitlePath = join(this.context.workspace.root, subtitle.path);
    const currentInputs = this.context.database.sqlite
      .prepare(
        'SELECT role,path,sha256 FROM assets WHERE project_id=? AND is_current=1 ORDER BY role',
      )
      .all(projectId) as Array<{ role: string; path: string; sha256: string }>;
    if (
      fingerprint({
        projectId,
        config,
        inputs: currentInputs.map(({ role, sha256 }) => ({ role, sha256 })),
      }) !== step.input_fingerprint
    )
      throw new Error('Render inputs are stale');
    const manifest = {
      version: 1,
      projectId,
      chapterId: chapter?.id ?? null,
      durationMs: Math.round(duration * 1000),
      configuration: config,
      inputs: currentInputs,
    };
    const manifestStaging = join(staging, 'timeline.json');
    await writeFile(manifestStaging, JSON.stringify(manifest), 'utf8');
    await this.context.media.run(
      [
        ...buildRenderArguments({
          backgroundPath,
          backgroundType: background.type as 'BACKGROUND_IMAGE' | 'BACKGROUND_VIDEO',
          narrationPath: audioPath,
          subtitlePath,
          subtitleFontSize: config.subtitleFontSize,
          musicPath,
          loopMusic: config.loopMusic,
          durationSeconds: duration,
          width: config.width,
          height: config.height,
          fps: config.fps,
          narrationVolume: config.narrationVolume,
          musicVolume: config.musicVolume,
        }),
        output,
      ],
      { cwd: this.context.workspace.root, signal },
    );
    const outputProbe = await this.context.media.probe(output);
    const outputStreams = Array.isArray(outputProbe.streams) ? outputProbe.streams : [];
    const videoStream = outputStreams.find(
      (stream): stream is { codec_type?: string; width?: number; height?: number } =>
        Boolean(
          stream &&
          typeof stream === 'object' &&
          'codec_type' in stream &&
          stream.codec_type === 'video',
        ),
    );
    const audioStream = outputStreams.some(
      (stream) =>
        stream &&
        typeof stream === 'object' &&
        'codec_type' in stream &&
        stream.codec_type === 'audio',
    );
    const outputDuration = Number(
      (outputProbe.format as { duration?: string } | undefined)?.duration ?? 0,
    );
    if (
      !videoStream ||
      !audioStream ||
      videoStream.width !== config.width ||
      videoStream.height !== config.height ||
      outputDuration <= 0
    )
      throw new Error('Rendered MP4 failed validation');
    const assets = new AssetRepository(this.context.database);
    const timelineDestination = join(
      this.context.workspace.projects,
      projectId,
      'renders',
      `${step.id}.timeline.json`,
    );
    const timelineDigest = await sha256File(manifestStaging);
    await promoteFile(manifestStaging, timelineDestination);
    const guard = {
      stepId: step.id,
      attemptId: step.attemptId,
      workerId: this.workerId,
      inputFingerprint: step.input_fingerprint,
    };
    const timelineRegistered = assets.registerIfCurrentStep(
      {
        id: randomUUID(),
        projectId,
        type: 'TIMELINE_MANIFEST',
        role: 'project:timeline',
        path: relativeAssetPath(this.context.workspace.root, timelineDestination),
        mediaType: 'application/json',
        bytes: timelineDigest.bytes,
        sha256: timelineDigest.hash,
        sourceEntityId: projectId,
        sourceStepId: step.id,
        inputFingerprint: step.input_fingerprint,
        metadata: manifest,
      },
      guard,
    );
    if (!timelineRegistered) {
      await rm(timelineDestination, { force: true });
      throw new Error('Render inputs changed before manifest promotion');
    }
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      projectId,
      'renders',
      `${step.id}.mp4`,
    );
    await promoteFile(output, destination);
    const renderRegistered = assets.registerIfCurrentStep(
      {
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
      },
      guard,
    );
    if (!renderRegistered) {
      await rm(destination, { force: true });
      throw new Error('Render inputs changed before output promotion');
    }
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
export { parseSrt, serializeSrt, subtitlesFromSegments, validateSubtitleCues } from './text.js';
export * from './omp-agent.js';
export * from './story-context.js';
export * from './story-prompts.js';
export * from './story-engine.js';
