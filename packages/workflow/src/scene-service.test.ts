import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, WorkflowRepository } from '@studio/database';
import { FfmpegTools, ProcessRunner, initializeWorkspace } from '@studio/media';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { SceneEngine, StudioService, WorkerExecutor, type StudioContext } from './index.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class SceneAgent implements AiAgent {
  readonly calls: AiAgentRequest[] = [];
  async generate(request: AiAgentRequest): Promise<AiAgentResult> {
    this.calls.push(request);
    const scene = {
      sceneNumber: 1,
      title: 'Cánh cửa',
      summary: 'Một người bước qua cửa.',
      purpose: 'INTRODUCTION',
      sourceRange: { start: 0, end: 3 },
      location: null,
      timeOfDay: 'Sáng',
      weather: 'Trong',
      mood: 'Tò mò',
      characters: [],
      importantObjects: [],
      visualDescription: 'Cánh cửa mở vào sân.',
      camera: { framing: 'MEDIUM', angle: null, movementIntent: null },
      composition: {
        subjectFocus: 'Cánh cửa',
        foreground: [],
        midground: [],
        background: [],
        characterPositions: [],
      },
      lighting: 'Sáng dịu',
      colorMood: 'Xanh nhạt',
      imagePrompt: 'A cinematic medium shot of a courtyard door',
      negativePrompt: 'text',
      continuityNotes: '',
    };
    return {
      operation: request.operation,
      text: JSON.stringify(
        request.operation === 'SCENE_PLANNING'
          ? { scenes: [scene] }
          : request.operation === 'SCENE_REGENERATION'
            ? { scene }
            : { imagePrompt: scene.imagePrompt, negativePrompt: scene.negativePrompt },
      ),
      provider: 'fixture',
      model: 'fixture',
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0,
      costCurrency: 'USD',
      finishReason: 'stop',
      durationMs: 1,
    };
  }
}

async function setup(): Promise<{
  database: ReturnType<typeof createDatabase>;
  service: StudioService;
  context: StudioContext;
  projectId: string;
  chapterId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'scene-service-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  const workspace = await initializeWorkspace(root);
  const context: StudioContext = {
    database,
    workspace,
    runner: new ProcessRunner(),
    media: {} as FfmpegTools,
  };
  const service = new StudioService(context);
  const project = service.createProject({
    title: 'Scene project',
    description: '',
    language: 'vi-VN',
    workflowType: 'AUDIO_STORY',
  });
  const chapter = service.createChapter(project.id, {
    title: 'Chapter 1',
    content: 'abc story text',
  });
  return { database, service, context, projectId: project.id, chapterId: chapter.id };
}

describe('Scene Engine workflow integration', () => {
  it('persists scene payloads, executes them through the worker, and skips current batch plans', async () => {
    const fixture = await setup();
    const workflow = new WorkflowRepository(fixture.database);
    const scheduled = fixture.service.scheduleSceneGeneration(
      fixture.projectId,
      fixture.chapterId,
      {
        density: 'LOW',
        targetRange: { min: 1, max: 1 },
      },
    );
    const pending = workflow.getStep(scheduled.stepId);
    expect(pending?.type).toBe('GENERATE_SCENES');
    expect(JSON.parse(pending?.payload ?? '{}')).toMatchObject({ density: 'LOW' });

    const claim = workflow.claim('scene-worker');
    expect(claim?.id).toBe(scheduled.stepId);
    const sceneEngine = new SceneEngine({ database: fixture.database, agent: new SceneAgent() });
    const executor = new WorkerExecutor(
      fixture.context,
      'scene-worker',
      undefined,
      undefined,
      sceneEngine,
    );
    await executor.execute(claim!);
    workflow.complete(claim!);
    const recovery = new WorkflowRepository(fixture.database);
    const expiredAt = new Date(Date.now() - 1_000).toISOString();
    const recoveryExecution = recovery.createExecution(fixture.projectId, 'SCENE_GENERATION');
    const recoveryStepId = recovery.createStep(
      recoveryExecution,
      'scene-recovery',
      'GENERATE_SCENES',
      fixture.chapterId,
      'recovery-fingerprint',
      3,
      { density: 'LOW', targetRange: { min: 1, max: 1 } },
    );
    recovery.claim('old-worker', 1);
    fixture.database.sqlite
      .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
      .run(expiredAt, recoveryStepId);
    expect(recovery.recoverExpired()).toBe(1);
    expect(recovery.getStep(recoveryStepId)?.status).toBe('PENDING');
    const recoveredClaim = recovery.claim('recovery-worker');
    expect(recoveredClaim?.id).toBe(recoveryStepId);
    recovery.complete(recoveredClaim!);
    expect(sceneEngine.scenes.getScenePlan(fixture.chapterId)?.status).toBe('CURRENT');

    const skipped = fixture.service.scheduleSceneBatch(fixture.projectId, {
      chapterIds: [fixture.chapterId],
      density: 'MEDIUM',
      targetRange: null,
      onlyMissing: true,
    });
    const currentScene = sceneEngine.scenes.listScenes(fixture.chapterId)[0]!;
    const pendingRegeneration = fixture.service.scheduleSceneRegeneration(
      fixture.projectId,
      currentScene.id,
      { expectedRevision: currentScene.revision },
    );
    expect(workflow.getStep(pendingRegeneration.stepId)?.status).toBe('PENDING');
    fixture.service.updateScene(fixture.projectId, currentScene.id, {
      expectedRevision: currentScene.revision,
      mood: 'Thận trọng',
    });
    expect(workflow.getStep(pendingRegeneration.stepId)?.status).toBe('INVALIDATED');
    expect(skipped.jobIds).toHaveLength(0);
    expect(skipped.skippedChapterIds).toEqual([fixture.chapterId]);

    fixture.service.updateChapter(fixture.chapterId, {
      title: 'Chapter 1 revised',
      content: 'abc story text',
    });
    expect(sceneEngine.scenes.getScenePlan(fixture.chapterId)?.status).toBe('STALE');
    expect(workflow.getStep(pendingRegeneration.stepId)?.status).toBe('INVALIDATED');
    const afterChange = fixture.service.scheduleSceneBatch(fixture.projectId, {
      chapterIds: [fixture.chapterId],
      density: 'MEDIUM',
      targetRange: null,
      onlyMissing: true,
    });
    const batchClaim = workflow.claim('scene-worker-2');
    expect(batchClaim?.type).toBe('GENERATE_SCENES');
    await executor.execute(batchClaim!);
    workflow.complete(batchClaim!);
    const refreshedScene = sceneEngine.scenes.listScenes(fixture.chapterId)[0]!;
    const pendingPrompt = fixture.service.scheduleScenePromptRefresh(
      fixture.projectId,
      refreshedScene.id,
      { expectedRevision: refreshedScene.revision },
    );
    fixture.service.saveVisualStyle(fixture.projectId, { styleName: 'Cinematic' });
    expect(workflow.getStep(pendingPrompt.stepId)?.status).toBe('INVALIDATED');
    expect(sceneEngine.scenes.listScenes(fixture.chapterId)[0]?.promptStatus).toBe('STALE');
    expect(afterChange.jobIds).toHaveLength(1);
    fixture.database.sqlite.close();
  });
});
