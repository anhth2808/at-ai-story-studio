import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AssetRepository,
  createDatabase,
  migrateDatabase,
  SceneImageGenerationRepository,
  VideoGenerationSettingsRepository,
  WorkflowRepository,
  sceneVideoRole,
  videoSettingsFingerprint,
} from '@studio/database';
import {
  FfmpegTools,
  ProcessRunner,
  initializeWorkspace,
  safeWorkspacePath,
  sha256File,
  type WorkspacePaths,
} from '@studio/media';
import { StudioService, WorkerExecutor, projectVideoRole, type StudioContext } from './index.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

async function registerFile(
  workspace: WorkspacePaths,
  assets: AssetRepository,
  input: {
    id: string;
    projectId: string;
    type: string;
    role: string;
    relativePath: string;
    mediaType: string;
    metadata?: Record<string, unknown>;
    sourceEntityId?: string;
  },
): Promise<void> {
  const filename = safeWorkspacePath(workspace.root, input.relativePath);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, Buffer.from(`${input.role}:${input.id}`));
  const digest = await sha256File(filename);
  assets.register({
    id: input.id,
    projectId: input.projectId,
    type: input.type,
    role: input.role,
    path: input.relativePath,
    mediaType: input.mediaType,
    bytes: digest.bytes,
    sha256: digest.hash,
    sourceEntityId: input.sourceEntityId,
    metadata: input.metadata,
  });
}

function insertScene(
  database: ReturnType<typeof createDatabase>,
  projectId: string,
  chapterId: string,
  chapterRevision: number,
  scenePlanRevisionId: string,
  sceneNumber: number,
): { id: string; stableId: string; sourceRange: { start: number; end: number } } {
  const sceneId = randomUUID();
  const stableId = `scene-${chapterId}-${sceneNumber}`;
  const sourceRange = sceneNumber === 1 ? { start: 0, end: 6 } : { start: 6, end: 12 };
  database.sqlite
    .prepare(
      `INSERT INTO scene_revisions
       (id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,source_content,
        scene_number,revision,title,summary,purpose,source_start_offset,source_end_offset,visual_description,
        camera,composition,image_prompt,input_fingerprint,prompt_version,schema_version,is_current,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      sceneId,
      stableId,
      scenePlanRevisionId,
      projectId,
      chapterId,
      chapterRevision,
      sceneNumber === 1 ? 'Alpha.' : ' Beta.',
      sceneNumber,
      1,
      `Scene ${sceneNumber}`,
      `Scene ${sceneNumber} summary`,
      'INTRODUCTION',
      sourceRange.start,
      sourceRange.end,
      `Scene ${sceneNumber} visual`,
      JSON.stringify({ framing: 'MEDIUM', angle: null, movementIntent: 'slow push' }),
      JSON.stringify({
        subjectFocus: `Scene ${sceneNumber}`,
        foreground: [],
        midground: [],
        background: [],
        characterPositions: [],
      }),
      `Scene ${sceneNumber} image prompt`,
      hash(`${chapterId}:scene:${sceneNumber}`),
      'fixture-v1',
      'fixture-v1',
      1,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  return { id: sceneId, stableId, sourceRange };
}

async function setupFixture(): Promise<{
  database: ReturnType<typeof createDatabase>;
  workspace: WorkspacePaths;
  service: StudioService;
  context: StudioContext;
  projectId: string;
  chapters: Array<{ id: string; scenes: Array<{ id: string; stableId: string }> }>;
  renderOutputs: string[];
  sceneRenderInputs: string[];
  failNextOutputs: Set<string>;
}> {
  const root = await mkdtemp(
    join(process.env.TEMP ?? process.env.TMP ?? '.', 'timeline-workflow-'),
  );
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  const workspace = await initializeWorkspace(root);
  const outputDurations = new Map<string, string>();
  const renderOutputs: string[] = [];
  const sceneRenderInputs: string[] = [];
  const failNextOutputs = new Set<string>();
  const probe = (filename: string) => {
    const duration = outputDurations.get(filename) ?? '1';
    return {
      format: { duration, format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [
        {
          codec_type: 'video',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30/1',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
        },
        { codec_type: 'audio', sample_rate: 48_000 },
      ],
    };
  };
  const media = {
    probe: async (filename: string) => probe(filename),
    runWithProgress: async (
      args: string[],
      onProgress: (update: { outTimeMs: number | null }) => void,
      options: { signal?: AbortSignal } = {},
    ) => {
      if (options.signal?.aborted) throw new Error('aborted');
      const outputPath = args.at(-1)!;
      const durationIndex = args.indexOf('-t');
      outputDurations.set(outputPath, durationIndex >= 0 ? args[durationIndex + 1]! : '1');
      if (args.includes('-loop')) sceneRenderInputs.push(args[args.indexOf('-i') + 1]!);
      renderOutputs.push(outputPath);
      const failedOutput = [...failNextOutputs].find((value) => outputPath.includes(value));
      if (failedOutput) {
        failNextOutputs.delete(failedOutput);
        throw new Error('fixture render failure');
      }
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.from('fixture-video'));
      onProgress({ outTimeMs: Number(outputDurations.get(outputPath)) * 1_000 });
      return { stdout: '', stderr: '', exitCode: 0, signal: null, durationMs: 1 };
    },
  } as unknown as FfmpegTools;
  const context: StudioContext = { database, workspace, runner: new ProcessRunner(), media };
  const service = new StudioService(context);
  const project = service.createProject({
    title: 'Timeline fixture',
    description: '',
    language: 'vi-VN',
    workflowType: 'AUDIO_STORY',
  });
  const assets = new AssetRepository(database);
  const chapters: Array<{ id: string; scenes: Array<{ id: string; stableId: string }> }> = [];
  for (let chapterNumber = 1; chapterNumber <= 3; chapterNumber += 1) {
    const chapter = service.createChapter(project.id, {
      title: `Chapter ${chapterNumber}`,
      content: 'Alpha. Beta.',
    });
    const scenePlanRevisionId = randomUUID();
    database.sqlite
      .prepare(
        `INSERT INTO scene_plan_revisions
         (id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        scenePlanRevisionId,
        project.id,
        chapter.id,
        chapter.revision,
        1,
        'LOW',
        hash(`${chapter.id}:plan`),
        'CURRENT',
        1,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );
    const scenes = [
      insertScene(database, project.id, chapter.id, chapter.revision, scenePlanRevisionId, 1),
      insertScene(database, project.id, chapter.id, chapter.revision, scenePlanRevisionId, 2),
    ];
    const audioId = randomUUID();
    const subtitleId = randomUUID();
    await registerFile(workspace, assets, {
      id: audioId,
      projectId: project.id,
      type: 'CHAPTER_AUDIO',
      role: `chapter:${chapter.id}:audio`,
      relativePath: `projects/${project.id}/audio/${chapter.id}.m4a`,
      mediaType: 'audio/mp4',
      metadata: { durationMs: 2_000 },
      sourceEntityId: chapter.id,
    });
    await registerFile(workspace, assets, {
      id: subtitleId,
      projectId: project.id,
      type: 'SUBTITLE',
      role: `chapter:${chapter.id}:subtitle`,
      relativePath: `projects/${project.id}/subtitles/${chapter.id}.srt`,
      mediaType: 'text/plain',
      sourceEntityId: chapter.id,
    });
    const firstTtsId = randomUUID();
    const secondTtsId = randomUUID();
    database.sqlite
      .prepare(
        `INSERT INTO tts_segments
         (id,chapter_id,segment_index,text,text_hash,chapter_revision,source_start_offset,source_end_offset,source_text,status,duration_ms,fingerprint)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        firstTtsId,
        chapter.id,
        0,
        'Alpha.',
        hash('Alpha.'),
        chapter.revision,
        0,
        6,
        'Alpha.',
        'COMPLETED',
        1_000,
        hash(`${chapter.id}:tts:0`),
      );
    database.sqlite
      .prepare(
        `INSERT INTO tts_segments
         (id,chapter_id,segment_index,text,text_hash,chapter_revision,source_start_offset,source_end_offset,source_text,status,duration_ms,fingerprint)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        secondTtsId,
        chapter.id,
        1,
        'Beta.',
        hash('Beta.'),
        chapter.revision,
        6,
        12,
        ' Beta.',
        'COMPLETED',
        1_000,
        hash(`${chapter.id}:tts:1`),
      );
    for (const scene of scenes) {
      await registerFile(workspace, assets, {
        id: randomUUID(),
        projectId: project.id,
        type: 'SCENE_IMAGE',
        role: `scene:${scene.stableId}:image`,
        relativePath: `projects/${project.id}/images/${scene.stableId}.png`,
        mediaType: 'image/png',
        metadata: { width: 640, height: 360 },
        sourceEntityId: scene.id,
      });
    }
    chapters.push({ id: chapter.id, scenes });
  }
  return {
    database,
    workspace,
    service,
    context,
    projectId: project.id,
    chapters,
    renderOutputs,
    sceneRenderInputs,
    failNextOutputs,
  };
}

async function drainTimelineWorker(
  fixture: Awaited<ReturnType<typeof setupFixture>>,
  workerId: string,
): Promise<void> {
  const workflow = new WorkflowRepository(fixture.database);
  const executor = new WorkerExecutor(fixture.context, workerId);
  let step: ReturnType<WorkflowRepository['claim']>;
  while ((step = workflow.claim(workerId))) {
    await executor.execute(step);
    workflow.complete(step);
  }
}

describe('timeline workflow integration', () => {
  it('plans 100 chapters and 500 scenes without media work', async () => {
    const fixture = await setupFixture();
    const project = fixture.service.createProject({
      title: 'Large planning fixture',
      description: '',
      language: 'vi-VN',
      workflowType: 'AUDIO_STORY',
    });
    for (let chapterNumber = 1; chapterNumber <= 100; chapterNumber += 1) {
      const chapter = fixture.service.createChapter(project.id, {
        title: `Chapter ${chapterNumber}`,
        content: 'Alpha. Beta.',
      });
      const scenePlanRevisionId = randomUUID();
      fixture.database.sqlite
        .prepare(
          `INSERT INTO scene_plan_revisions
           (id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          scenePlanRevisionId,
          project.id,
          chapter.id,
          chapter.revision,
          1,
          'LOW',
          hash(`${chapter.id}:plan`),
          'CURRENT',
          1,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
        );
      for (let sceneNumber = 1; sceneNumber <= 5; sceneNumber += 1)
        insertScene(
          fixture.database,
          project.id,
          chapter.id,
          chapter.revision,
          scenePlanRevisionId,
          sceneNumber,
        );
    }
    const plan = fixture.service.getRenderPlan(project.id, {
      source: 'SCENES',
      scope: { kind: 'FULL_STORY' },
      autoBuild: false,
      fallbackPolicy: 'BLACK',
    });
    expect(plan.chapters).toMatchObject({ total: 100, blocked: 100 });
    expect(plan.scenes).toMatchObject({ total: 500, blocked: 500 });
    expect(plan.blockers).toHaveLength(1_000);
    expect(fixture.renderOutputs).toHaveLength(0);
    fixture.database.sqlite.close();
  }, 30_000);
  it('renders three chapters, reuses cache, and rebuilds only one invalidated branch', async () => {
    const fixture = await setupFixture();
    const assets = new AssetRepository(fixture.database);
    for (const chapter of fixture.chapters) {
      await fixture.service.timeline.buildSceneTiming(chapter.id);
      fixture.service.timeline.buildMotionPlans(chapter.id);
    }
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'FULL_STORY' as const },
      autoBuild: false,
      fallbackPolicy: 'FAIL' as const,
    };
    const first = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    expect(first.jobIds).toHaveLength(10);
    await drainTimelineWorker(fixture, 'timeline-worker-a');
    const chapterOneBefore = assets.current(
      fixture.projectId,
      `chapter:${fixture.chapters[0]!.id}:video`,
    );
    const chapterTwoBefore = assets.current(
      fixture.projectId,
      `chapter:${fixture.chapters[1]!.id}:video`,
    );
    const chapterThreeBefore = assets.current(
      fixture.projectId,
      `chapter:${fixture.chapters[2]!.id}:video`,
    );
    const projectBefore = assets.current(
      fixture.projectId,
      `project:${fixture.projectId}:video:full-story`,
    );
    expect(chapterOneBefore).not.toBeNull();
    expect(chapterTwoBefore).not.toBeNull();
    expect(chapterThreeBefore).not.toBeNull();
    expect(projectBefore).not.toBeNull();

    const reused = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    expect(reused.jobIds).toHaveLength(0);
    expect(reused.plan.scenes.reusable).toBe(6);
    expect(reused.plan.chapters.reusable).toBe(3);
    expect(reused.plan.project.reusable).toBe(true);

    const rangeRequest = {
      ...request,
      scope: { kind: 'CHAPTER_RANGE' as const, startChapterNumber: 2, endChapterNumber: 3 },
    };
    const rangePlan = fixture.service.getRenderPlan(fixture.projectId, rangeRequest);
    expect(rangePlan.scenes).toMatchObject({ total: 4, reusable: 4, required: 0, blocked: 0 });
    expect(rangePlan.chapters).toMatchObject({ total: 2, reusable: 2, required: 0, blocked: 0 });
    expect(rangePlan.project.reusable).toBe(false);
    const range = await fixture.service.scheduleTimelineRender(fixture.projectId, rangeRequest);
    expect(range.jobIds).toHaveLength(1);
    await drainTimelineWorker(fixture, 'timeline-worker-range');
    expect(
      assets.current(fixture.projectId, `project:${fixture.projectId}:video:range-2-3`),
    ).not.toBeNull();

    const changedScene = fixture.chapters[1]!.scenes[0]!;
    await registerFile(fixture.workspace, assets, {
      id: randomUUID(),
      projectId: fixture.projectId,
      type: 'SCENE_IMAGE',
      role: `scene:${changedScene.stableId}:image`,
      relativePath: `projects/${fixture.projectId}/images/${changedScene.stableId}-replacement.png`,
      mediaType: 'image/png',
      metadata: { width: 640, height: 360 },
      sourceEntityId: changedScene.id,
    });
    expect(assets.current(fixture.projectId, `scene:${changedScene.stableId}:video`)).toBeNull();
    expect(assets.current(fixture.projectId, `chapter:${fixture.chapters[0]!.id}:video`)?.id).toBe(
      chapterOneBefore?.id,
    );
    expect(
      assets.current(fixture.projectId, `chapter:${fixture.chapters[1]!.id}:video`),
    ).toBeNull();
    expect(assets.current(fixture.projectId, `chapter:${fixture.chapters[2]!.id}:video`)?.id).toBe(
      chapterThreeBefore?.id,
    );
    expect(
      assets.current(fixture.projectId, `project:${fixture.projectId}:video:full-story`),
    ).toBeNull();
    expect(
      assets.current(fixture.projectId, `project:${fixture.projectId}:video:range-2-3`),
    ).toBeNull();

    const scopedPlan = fixture.service.getRenderPlan(fixture.projectId, request);
    expect(scopedPlan.scenes.reusable).toBe(5);
    expect(scopedPlan.chapters.reusable).toBe(2);
    const second = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    expect(second.jobIds).toHaveLength(3);
    await drainTimelineWorker(fixture, 'timeline-worker-b');
    expect(assets.current(fixture.projectId, `chapter:${fixture.chapters[0]!.id}:video`)?.id).toBe(
      chapterOneBefore?.id,
    );
    expect(
      assets.current(fixture.projectId, `chapter:${fixture.chapters[1]!.id}:video`)?.id,
    ).not.toBe(chapterTwoBefore?.id);
    expect(assets.current(fixture.projectId, `chapter:${fixture.chapters[2]!.id}:video`)?.id).toBe(
      chapterThreeBefore?.id,
    );
    expect(
      assets.current(fixture.projectId, `project:${fixture.projectId}:video:full-story`)?.id,
    ).not.toBe(projectBefore?.id);
    fixture.database.sqlite.close();
  }, 30_000);
  it('auto-builds missing timing and Motion Plans before scheduling renders', async () => {
    const fixture = await setupFixture();
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'FULL_STORY' as const },
      autoBuild: true,
      fallbackPolicy: 'FAIL' as const,
    };
    expect(fixture.service.getRenderPlan(fixture.projectId, request).blockers).toHaveLength(15);
    const scheduled = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    expect(scheduled.jobIds).toHaveLength(10);
    for (const chapter of fixture.chapters) {
      expect(fixture.service.timeline.timeline.getCurrentSceneTiming(chapter.id)).not.toBeNull();
      expect(
        fixture.service.timeline.timeline.getCurrentMotionPlan(
          chapter.scenes[0]!.stableId,
          chapter.scenes[0]!.id,
        ),
      ).not.toBeNull();
    }
    await drainTimelineWorker(fixture, 'timeline-worker-auto-build');
    expect(fixture.service.getRenderPlan(fixture.projectId, request).project.reusable).toBe(true);
    fixture.database.sqlite.close();
  }, 30_000);
  it('rolls back auto-build timing and render materialization as one transaction', async () => {
    const fixture = await setupFixture();
    const brokenScene = fixture.chapters[1]!.scenes[0]!;
    fixture.database.sqlite
      .prepare('UPDATE assets SET metadata=? WHERE project_id=? AND role=?')
      .run(
        JSON.stringify({ width: 640 }),
        fixture.projectId,
        `scene:${brokenScene.stableId}:image`,
      );
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'FULL_STORY' as const },
      autoBuild: true,
      fallbackPolicy: 'FAIL' as const,
    };
    expect(
      fixture.service.getRenderPlan(fixture.projectId, request).blockers.length,
    ).toBeGreaterThan(0);
    expect(
      (
        fixture.database.sqlite.prepare('SELECT COUNT(*) as count FROM jobs').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    await expect(
      fixture.service.scheduleTimelineRender(fixture.projectId, request),
    ).rejects.toMatchObject({ code: 'RENDER_INPUT_INVALID' });
    for (const chapter of fixture.chapters)
      expect(fixture.service.timeline.timeline.getCurrentSceneTiming(chapter.id)).toBeNull();
    expect(
      (
        fixture.database.sqlite
          .prepare('SELECT COUNT(*) as count FROM motion_plan_revisions')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        fixture.database.sqlite.prepare('SELECT COUNT(*) as count FROM jobs').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    expect(
      (
        fixture.database.sqlite
          .prepare('SELECT COUNT(*) as count FROM workflow_executions')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    fixture.database.sqlite.close();
  }, 30_000);
  it('rejects TTS source mappings from another chapter revision', async () => {
    const fixture = await setupFixture();
    const chapterId = fixture.chapters[0]!.id;
    fixture.database.sqlite
      .prepare('UPDATE tts_segments SET chapter_revision=chapter_revision+1 WHERE chapter_id=?')
      .run(chapterId);
    await expect(fixture.service.timeline.buildSceneTiming(chapterId)).rejects.toMatchObject({
      code: 'TIMELINE_SOURCE_MAPPINGS_REQUIRED',
    });
    fixture.database.sqlite.close();
  }, 30_000);

  it('preserves manual timing locks and rejects stale timing revisions', async () => {
    const fixture = await setupFixture();
    const chapterId = fixture.chapters[0]!.id;
    const initial = await fixture.service.timeline.buildSceneTiming(chapterId);
    const manual = await fixture.service.timeline.buildSceneTiming(chapterId, {
      expectedRevision: initial.revision,
      mode: 'MANUAL',
      items: [
        { sceneId: fixture.chapters[0]!.scenes[0]!.id, startMs: 0, endMs: 1_200 },
        { sceneId: fixture.chapters[0]!.scenes[1]!.id, startMs: 1_200, endMs: 2_000 },
      ],
    });
    expect(manual.mode).toBe('MANUAL');
    expect(await fixture.service.timeline.buildSceneTiming(chapterId)).toMatchObject({
      id: manual.id,
      revision: manual.revision,
      mode: 'MANUAL',
    });
    await expect(
      fixture.service.timeline.buildSceneTiming(chapterId, {
        expectedRevision: initial.revision,
        mode: 'MANUAL',
        items: manual.items.map(({ sceneId, startMs, endMs }) => ({ sceneId, startMs, endMs })),
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    fixture.database.sqlite.close();
  }, 30_000);

  it('renders a single Scene scope without rebuilding chapter or project outputs', async () => {
    const fixture = await setupFixture();
    const chapter = fixture.chapters[0]!;
    await fixture.service.timeline.buildSceneTiming(chapter.id);
    fixture.service.timeline.buildMotionPlans(chapter.id);
    const scene = chapter.scenes[0]!;
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'SCENE' as const, sceneId: scene.id },
      autoBuild: false,
      fallbackPolicy: 'FAIL' as const,
    };
    const plan = fixture.service.getRenderPlan(fixture.projectId, request);
    expect(plan.scenes).toMatchObject({ total: 1, reusable: 0, required: 1, blocked: 0 });
    expect(plan.chapters).toMatchObject({ total: 0, required: 0 });
    expect(plan.project.required).toBe(false);
    const scheduled = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    expect(scheduled.jobIds).toHaveLength(1);
    await drainTimelineWorker(fixture, 'timeline-worker-scene');
    expect(
      fixture.service.assets.current(fixture.projectId, `scene:${scene.stableId}:video`),
    ).not.toBeNull();
    expect(
      fixture.service.assets.current(fixture.projectId, `chapter:${chapter.id}:video`),
    ).toBeNull();
    fixture.database.sqlite.close();
  }, 30_000);

  it('records explicit BLACK fallback when the accepted Scene image is missing', async () => {
    const fixture = await setupFixture();
    const scene = fixture.chapters[0]!.scenes[0]!;
    await fixture.service.timeline.buildSceneTiming(fixture.chapters[0]!.id);
    fixture.service.timeline.buildMotionPlans(fixture.chapters[0]!.id);
    fixture.database.sqlite
      .prepare('UPDATE assets SET is_current=0 WHERE project_id=? AND role=?')
      .run(fixture.projectId, `scene:${scene.stableId}:image`);
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'SCENE' as const, sceneId: scene.id },
      autoBuild: false,
      fallbackPolicy: 'BLACK' as const,
    };
    const plan = fixture.service.getRenderPlan(fixture.projectId, request);
    expect(plan.blockers.map((blocker) => blocker.code)).not.toContain('SCENE_IMAGE_REQUIRED');
    const scheduled = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    expect(scheduled.jobIds).toHaveLength(1);
    await drainTimelineWorker(fixture, 'timeline-worker-black');
    const output = fixture.service.assets.current(
      fixture.projectId,
      `scene:${scene.stableId}:video`,
    );
    expect(output).not.toBeNull();
    const metadata = fixture.database.sqlite
      .prepare('SELECT metadata FROM assets WHERE id=?')
      .get(output!.id) as { metadata: string };
    expect(JSON.parse(metadata.metadata)).toMatchObject({ fallbackPolicy: 'BLACK' });
    fixture.database.sqlite.close();
  }, 30_000);
  it('blocks a rejected current Scene image under the default fallback', async () => {
    const fixture = await setupFixture();
    const chapter = fixture.chapters[0]!;
    const scene = chapter.scenes[0]!;
    const images = new SceneImageGenerationRepository(fixture.database);
    const generation = images.commitManual({
      projectId: fixture.projectId,
      sceneStableId: scene.stableId,
      sceneRevisionId: scene.id,
      assetPath: `projects/${fixture.projectId}/images/${scene.stableId}-rejected.png`,
      mediaType: 'image/png',
      bytes: 1,
      sha256: 'rejected-image',
      width: 640,
      height: 360,
    });
    images.updateReview(fixture.projectId, generation.id, {
      status: 'REJECTED',
      notes: '',
      issues: [],
    });
    await fixture.service.timeline.buildSceneTiming(chapter.id);
    fixture.service.timeline.buildMotionPlans(chapter.id);
    const plan = fixture.service.getRenderPlan(fixture.projectId, {
      source: 'SCENES',
      scope: { kind: 'SCENE', sceneId: scene.id },
      autoBuild: false,
      fallbackPolicy: 'FAIL',
    });
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('SCENE_IMAGE_REQUIRED');
    fixture.database.sqlite.close();
  }, 30_000);

  it('rejects duplicate matching render schedules before creating orphan jobs', async () => {
    const fixture = await setupFixture();
    for (const chapter of fixture.chapters) {
      await fixture.service.timeline.buildSceneTiming(chapter.id);
      fixture.service.timeline.buildMotionPlans(chapter.id);
    }
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'FULL_STORY' as const },
      autoBuild: false,
      fallbackPolicy: 'FAIL' as const,
    };
    const first = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    const executionBeforeRow = fixture.database.sqlite
      .prepare('SELECT COUNT(*) as count FROM workflow_executions')
      .get() as { count: number };
    const executionCountBefore = executionBeforeRow.count;
    await expect(
      fixture.service.scheduleTimelineRender(fixture.projectId, request),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const executionAfterRow = fixture.database.sqlite
      .prepare('SELECT COUNT(*) as count FROM workflow_executions')
      .get() as { count: number };
    const executionCountAfter = executionAfterRow.count;
    expect(executionCountAfter).toBe(executionCountBefore);
    expect(first.jobIds).toHaveLength(10);
    fixture.database.sqlite.close();
  }, 30_000);
  it('cancels a claimed Scene Clip without publishing an output', async () => {
    const fixture = await setupFixture();
    const chapter = fixture.chapters[0]!;
    await fixture.service.timeline.buildSceneTiming(chapter.id);
    fixture.service.timeline.buildMotionPlans(chapter.id);
    const scheduled = await fixture.service.scheduleTimelineRender(fixture.projectId, {
      source: 'SCENES',
      scope: { kind: 'SCENE', sceneId: chapter.scenes[0]!.id },
      autoBuild: false,
      fallbackPolicy: 'FAIL',
    });
    const workflow = new WorkflowRepository(fixture.database);
    const step = workflow.claim('timeline-worker-cancel')!;
    const controller = new AbortController();
    controller.abort();
    await expect(
      new WorkerExecutor(fixture.context, 'timeline-worker-cancel').execute(
        step,
        controller.signal,
      ),
    ).rejects.toThrow('aborted');
    workflow.cancel(step, 'Cancelled by test');
    expect(workflow.getStep(step.id)?.status).toBe('CANCELLED');
    expect(fixture.service.timeline.renderJobs.getByStep(step.id)?.status).toBe('CANCELLED');
    expect(
      fixture.service.assets.current(
        fixture.projectId,
        `scene:${chapter.scenes[0]!.stableId}:video`,
      ),
    ).toBeNull();
    expect(scheduled.jobIds.length).toBeGreaterThan(0);
    fixture.database.sqlite.close();
  }, 30_000);

  it('keeps completed siblings when one Scene Clip fails and is retried', async () => {
    const fixture = await setupFixture();
    const assets = new AssetRepository(fixture.database);
    for (const chapter of fixture.chapters) {
      await fixture.service.timeline.buildSceneTiming(chapter.id);
      fixture.service.timeline.buildMotionPlans(chapter.id);
    }
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'FULL_STORY' as const },
      autoBuild: false,
      fallbackPolicy: 'FAIL' as const,
    };
    await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    const workflow = new WorkflowRepository(fixture.database);
    const executor = new WorkerExecutor(fixture.context, 'timeline-worker-failure');
    const firstStep = workflow.claim('timeline-worker-failure')!;
    await executor.execute(firstStep);
    workflow.complete(firstStep);
    const failedScene = fixture.chapters[0]!.scenes[1]!;
    fixture.failNextOutputs.add('scene-clip');
    const failedStep = workflow.claim('timeline-worker-failure')!;
    await expect(executor.execute(failedStep)).rejects.toThrow('fixture render failure');
    workflow.fail(failedStep, 'fixture failure', false);
    await drainTimelineWorker(fixture, 'timeline-worker-failure');
    expect(workflow.getStep(failedStep.id)?.status).toBe('FAILED');
    expect(assets.current(fixture.projectId, `scene:${failedScene.stableId}:video`)).toBeNull();
    const completedScene = fixture.chapters[0]!.scenes[0]!;
    expect(
      fixture.sceneRenderInputs.filter((path) => path.includes(completedScene.stableId)),
    ).toHaveLength(1);
    expect(
      fixture.sceneRenderInputs.filter((path) => path.includes(failedScene.stableId)),
    ).toHaveLength(1);
    workflow.retryStep(failedStep.id);
    await drainTimelineWorker(fixture, 'timeline-worker-failure-retry');
    expect(
      fixture.sceneRenderInputs.filter((path) => path.includes(completedScene.stableId)),
    ).toHaveLength(1);
    expect(
      fixture.sceneRenderInputs.filter((path) => path.includes(failedScene.stableId)),
    ).toHaveLength(2);
    expect(
      assets.current(fixture.projectId, `chapter:${fixture.chapters[0]!.id}:video`),
    ).not.toBeNull();
    fixture.database.sqlite.close();
  }, 30_000);

  it('recovers a registered output without rerunning FFmpeg after worker restart', async () => {
    const fixture = await setupFixture();
    for (const chapter of fixture.chapters) {
      await fixture.service.timeline.buildSceneTiming(chapter.id);
      fixture.service.timeline.buildMotionPlans(chapter.id);
    }
    await fixture.service.scheduleTimelineRender(fixture.projectId, {
      source: 'SCENES',
      scope: { kind: 'FULL_STORY' },
      autoBuild: false,
      fallbackPolicy: 'FAIL',
    });
    const workflow = new WorkflowRepository(fixture.database);
    const first = workflow.claim('timeline-worker-before-restart')!;
    const executor = new WorkerExecutor(fixture.context, 'timeline-worker-before-restart');
    await executor.execute(first);
    const callsBeforeRestart = fixture.renderOutputs.length;
    fixture.database.sqlite
      .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
      .run(new Date(0).toISOString(), first.id);
    expect(workflow.recoverExpired()).toBe(1);
    const recovered = workflow.claim('timeline-worker-after-restart')!;
    await new WorkerExecutor(fixture.context, 'timeline-worker-after-restart').execute(recovered);
    workflow.complete(recovered);
    expect(fixture.renderOutputs).toHaveLength(callsBeforeRestart);
    expect(
      fixture.service.assets.current(
        fixture.projectId,
        `scene:${fixture.chapters[0]!.scenes[0]!.stableId}:video`,
      ),
    ).not.toBeNull();
    fixture.database.sqlite.close();
  }, 30_000);
  it('assembles selected Chapters in project order with a scoped output role', async () => {
    const fixture = await setupFixture();
    for (const chapter of fixture.chapters) {
      await fixture.service.timeline.buildSceneTiming(chapter.id);
      fixture.service.timeline.buildMotionPlans(chapter.id);
    }
    const fullRequest = {
      source: 'SCENES' as const,
      scope: { kind: 'FULL_STORY' as const },
      autoBuild: false,
      fallbackPolicy: 'FAIL' as const,
    };
    await fixture.service.scheduleTimelineRender(fixture.projectId, fullRequest);
    await drainTimelineWorker(fixture, 'timeline-worker-selected-seed');
    const selectedRequest = {
      ...fullRequest,
      scope: {
        kind: 'SELECTED_CHAPTERS' as const,
        chapterIds: [fixture.chapters[2]!.id, fixture.chapters[0]!.id],
      },
    };
    const plan = fixture.service.getRenderPlan(fixture.projectId, selectedRequest);
    expect(plan.scenes).toMatchObject({ total: 4, reusable: 4, blocked: 0 });
    expect(plan.chapters).toMatchObject({ total: 2, reusable: 2, blocked: 0 });
    const scheduled = await fixture.service.scheduleTimelineRender(
      fixture.projectId,
      selectedRequest,
    );
    expect(scheduled.jobIds).toHaveLength(1);
    await drainTimelineWorker(fixture, 'timeline-worker-selected');
    const role = projectVideoRole(fixture.projectId, selectedRequest.scope);
    const output = fixture.service.assets.current(fixture.projectId, role);
    expect(output).not.toBeNull();
    const metadata = fixture.database.sqlite
      .prepare('SELECT metadata FROM assets WHERE id=?')
      .get(output!.id) as { metadata: string };
    expect(JSON.parse(metadata.metadata)).toMatchObject({
      scope: selectedRequest.scope,
      chapters: [{ chapterId: fixture.chapters[0]!.id }, { chapterId: fixture.chapters[2]!.id }],
    });
    fixture.database.sqlite.close();
  }, 30_000);

  it('plans mixed AI motion modes metadata-only and renders without provider calls', async () => {
    const fixture = await setupFixture();
    const assets = new AssetRepository(fixture.database);
    const database = fixture.database;
    for (const chapter of fixture.chapters) {
      await fixture.service.timeline.buildSceneTiming(chapter.id);
      fixture.service.timeline.buildMotionPlans(chapter.id);
    }
    const aiScene = fixture.chapters[0]!.scenes[0]!;
    const hybridScene = fixture.chapters[0]!.scenes[1]!;
    // Motion sources: first scene AI_VIDEO, second HYBRID.
    for (const [scene, source] of [
      [aiScene, 'AI_VIDEO'],
      [hybridScene, 'HYBRID'],
    ] as const) {
      database.sqlite
        .prepare(
          `INSERT INTO scene_motion_sources(id,project_id,scene_stable_id,motion_source,created_at,updated_at)
           VALUES(?,?,?,?,?,?)`,
        )
        .run(randomUUID(), fixture.projectId, scene.stableId, source, '2026-01-01', '2026-01-01');
    }
    // Settings + current accepted AI motion for both scenes.
    const settingsRepo = new VideoGenerationSettingsRepository(database);
    const settings = settingsRepo.getOrCreate(fixture.projectId);
    const settingsFingerprint = videoSettingsFingerprint(settings);
    for (const [scene, fingerprintSeed] of [
      [aiScene, 'ai-gen-fp-1'],
      [hybridScene, 'ai-gen-fp-2'],
    ] as const) {
      const planId = randomUUID();
      database.sqlite
        .prepare(
          `INSERT INTO ai_motion_plan_revisions(id,project_id,chapter_id,scene_stable_id,scene_revision_id,
            revision,motion_prompt,input_fingerprint,status,is_current,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          planId,
          fixture.projectId,
          fixture.chapters[0]!.id,
          scene.stableId,
          scene.id,
          1,
          'the scene breathes gently',
          `plan-${fingerprintSeed}`,
          'CURRENT',
          1,
          '2026-01-01',
          '2026-01-01',
        );
      const assetId = randomUUID();
      const imageAsset = database.sqlite
        .prepare(
          "SELECT id,sha256 FROM assets WHERE project_id=? AND role=? AND is_current=1 AND status='READY' ORDER BY created_at DESC LIMIT 1",
        )
        .get(fixture.projectId, `scene:${scene.stableId}:image`) as {
        id: string;
        sha256: string;
      };
      await registerFile(fixture.workspace, assets, {
        id: assetId,
        projectId: fixture.projectId,
        type: 'AI_SCENE_VIDEO',
        role: sceneVideoRole(scene.stableId),
        relativePath: `projects/${fixture.projectId}/video/motion/${scene.stableId}/gen.mp4`,
        mediaType: 'video/mp4',
        metadata: { clipDurationMs: 5_000, fps: 24, frameCount: 121, seed: 42 },
        sourceEntityId: scene.id,
      });
      database.sqlite
        .prepare(
          `INSERT INTO scene_video_generations(id,project_id,chapter_id,scene_stable_id,scene_revision_id,
            revision,provider,status,review_status,is_current,provider_job_id,workflow_template,
            input_fingerprint,source_image_asset_id,source_image_sha256,asset_id,
            motion_plan_fingerprint,settings_fingerprint,attempt,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          randomUUID(),
          fixture.projectId,
          fixture.chapters[0]!.id,
          scene.stableId,
          scene.id,
          1,
          'COMFYUI',
          'COMPLETED',
          'ACCEPTED',
          1,
          randomUUID(),
          'image-to-video-v1',
          fingerprintSeed,
          imageAsset.id,
          imageAsset.sha256,
          assetId,
          `plan-${fingerprintSeed}`,
          settingsFingerprint,
          1,
          '2026-01-01',
          '2026-01-01',
        );
    }
    const stepsBefore = (
      database.sqlite.prepare('SELECT COUNT(*) as n FROM workflow_steps').get() as { n: number }
    ).n;
    const request = {
      source: 'SCENES' as const,
      scope: { kind: 'FULL_STORY' as const },
      autoBuild: false,
      fallbackPolicy: 'FAIL' as const,
    };
    const plan = fixture.service.getRenderPlan(fixture.projectId, request);
    expect(plan.ai).toMatchObject({ scenesSelected: 2, missingMotion: 0, clipsToNormalize: 2 });
    expect(plan.ai?.estimatedGenerations).toBe(0);
    const stepsAfterPlan = (
      database.sqlite.prepare('SELECT COUNT(*) as n FROM workflow_steps').get() as { n: number }
    ).n;
    expect(stepsAfterPlan).toBe(stepsBefore);
    const schedule = await fixture.service.scheduleTimelineRender(fixture.projectId, request);
    const aiJobTypes = database.sqlite
      .prepare("SELECT COUNT(*) as n FROM workflow_steps WHERE type='GENERATE_AI_SCENE_VIDEO'")
      .get() as { n: number };
    expect(aiJobTypes.n).toBe(0);
    await drainTimelineWorker(fixture, 'timeline-worker-ai');
    // Raw AI motion assets survive renders untouched.
    const rawCount = (
      database.sqlite
        .prepare("SELECT COUNT(*) as n FROM scene_video_generations WHERE status='COMPLETED'")
        .get() as { n: number }
    ).n;
    expect(rawCount).toBe(2);
    void schedule;
    fixture.database.sqlite.close();
  }, 30_000);
});
