import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  SceneRepository,
  WorkflowRepository,
} from '@studio/database';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import type { ScenePlanItem } from '@studio/shared';
import { SceneEngine } from './scene-engine.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chapterText = 'Mở cửa. Mai gặp người lạ. Cuộc truy đuổi bắt đầu. Bí mật được hé lộ.';

function sceneFor(content: string, sceneNumber: number, titleSuffix = ''): ScenePlanItem {
  const starts = [0, content.indexOf('Mai'), content.indexOf('Cuộc'), content.indexOf('Bí')];
  const start = starts[sceneNumber - 1]!;
  const end = sceneNumber === starts.length ? content.length : starts[sceneNumber]!;
  const purposes = ['INTRODUCTION', 'DIALOGUE', 'ACTION', 'REVEAL'] as const;
  const locations = ['Cổng nhà', 'Quán trà', 'Con đường', 'Căn phòng'];
  return {
    sceneNumber,
    title: `Nhịp ${sceneNumber}${titleSuffix}`,
    summary: `Một nhịp truyện số ${sceneNumber}.`,
    purpose: purposes[sceneNumber - 1]!,
    sourceRange: { start, end },
    location: locations[sceneNumber - 1]!,
    timeOfDay: 'Sáng',
    weather: 'Trong',
    mood: sceneNumber === 3 ? 'Gấp gáp' : 'Tò mò',
    characters: [],
    importantObjects: [`Đạo cụ ${sceneNumber}`],
    visualDescription: `Mô tả hình ảnh cho nhịp ${sceneNumber}.`,
    camera: {
      framing: sceneNumber === 3 ? 'WIDE' : 'MEDIUM',
      angle: 'Ngang mắt',
      movementIntent: null,
    },
    composition: {
      subjectFocus: `Chủ thể ${sceneNumber}`,
      foreground: [],
      midground: [`Chủ thể ${sceneNumber}`],
      background: [locations[sceneNumber - 1]!],
      characterPositions: [],
    },
    lighting: 'Ánh sáng tự nhiên',
    colorMood: sceneNumber === 4 ? 'Đỏ thẫm' : 'Xanh nhạt',
    imagePrompt: `Cinematic scene ${sceneNumber}, ${locations[sceneNumber - 1]}`,
    negativePrompt: 'text, watermark',
    continuityNotes: '',
  };
}

class FixtureSceneAgent implements AiAgent {
  readonly calls: AiAgentRequest[] = [];
  constructor(
    private readonly content: string,
    private failuresRemaining = 0,
  ) {}

  async generate(request: AiAgentRequest, signal?: AbortSignal): Promise<AiAgentResult> {
    this.calls.push(request);
    if (signal?.aborted) throw new Error('aborted');
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('temporary provider failure');
    }
    const scenes = [1, 2, 3, 4].map((number) => sceneFor(this.content, number));
    const value =
      request.operation === 'SCENE_PLANNING'
        ? { scenes }
        : request.operation === 'SCENE_REGENERATION'
          ? { scene: sceneFor(this.content, 2, ' - bản mới') }
          : { imagePrompt: 'Refreshed cinematic prompt', negativePrompt: 'text' };
    return {
      operation: request.operation,
      text: JSON.stringify(value),
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

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'scene-engine-integration-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Scene integration','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,story_origin,created_at,updated_at) VALUES('chapter','project',1,'Chapter 1',?,'ACTIVE',1,1,'MANUAL','2026-01-01','2026-01-01')",
    )
    .run(chapterText);
  return { database, root };
}

describe('Scene Engine integration', () => {
  it('splits narrative beats, persists ordered scenes, and regenerates one revision', async () => {
    const fixture = await setup();
    const agent = new FixtureSceneAgent(chapterText);
    const engine = new SceneEngine({ database: fixture.database, agent });
    const repository = new SceneRepository(fixture.database);
    const initialStyle = repository.saveVisualStyle('project', {
      styleName: 'Base cinematic',
      styleDescription: '',
      medium: 'digital painting',
      realism: 'stylized',
      colorPalette: 'xanh',
      cinematicStyle: 'điện ảnh',
      aspectRatio: '16:9',
      promptSuffix: '',
    });

    const plan = await engine.generateScenes('project', 'chapter', {
      density: 'MEDIUM',
      targetRange: { min: 3, max: 6 },
    });
    expect(plan.sceneCount).toBe(4);
    expect(plan.styleRevisionId).toBe(initialStyle.id);
    const initial = repository.listScenes('chapter', 10, 0, true);
    expect(initial.every((scene) => scene.styleRevisionId === initialStyle.id)).toBe(true);
    expect(initial.map((scene) => scene.purpose)).toEqual([
      'INTRODUCTION',
      'DIALOGUE',
      'ACTION',
      'REVEAL',
    ]);
    expect(initial.map((scene) => scene.sourceExcerpt)).toEqual([
      'Mở cửa. ',
      'Mai gặp người lạ. ',
      'Cuộc truy đuổi bắt đầu. ',
      'Bí mật được hé lộ.',
    ]);
    const chapterBefore = fixture.database.sqlite
      .prepare('SELECT content,revision FROM chapters WHERE id=?')
      .get('chapter');

    const regenerated = await engine.regenerateScene('project', initial[1]!.id, {
      expectedRevision: 1,
      instructions: 'Làm rõ nhịp đối thoại.',
    });
    expect(regenerated.revision).toBe(2);
    expect(regenerated.title).toContain('bản mới');
    const afterRegeneration = repository.listScenes('chapter');
    expect(afterRegeneration[0]!.id).toBe(initial[0]!.id);
    expect(afterRegeneration[2]!.id).toBe(initial[2]!.id);
    expect(afterRegeneration[3]!.id).toBe(initial[3]!.id);
    expect(afterRegeneration[0]!.revision).toBe(1);
    expect(afterRegeneration[2]!.revision).toBe(1);
    expect(afterRegeneration[3]!.revision).toBe(1);
    expect(
      fixture.database.sqlite
        .prepare('SELECT content,revision FROM chapters WHERE id=?')
        .get('chapter'),
    ).toEqual(chapterBefore);
    expect(agent.calls.filter((call) => call.operation === 'SCENE_PLANNING')).toHaveLength(1);
    expect(agent.calls.filter((call) => call.operation === 'SCENE_REGENERATION')).toHaveLength(1);

    const edited = repository.updateScene(regenerated.id, {
      expectedRevision: 2,
      visualDescription: 'Mô tả đã được biên tập thủ công.',
    });
    expect(edited.promptStatus).toBe('STALE');
    expect(
      fixture.database.sqlite
        .prepare('SELECT COUNT(*) as count FROM scene_revisions WHERE stable_id=?')
        .get(initial[1]!.stableId),
    ).toEqual({ count: 3 });

    const style = repository.saveVisualStyle('project', {
      styleName: 'Cinematic Xianxia',
      styleDescription: 'Phong cách điện ảnh huyền ảo.',
      medium: 'digital painting',
      realism: 'stylized realism',
      colorPalette: 'xanh ngọc và vàng ấm',
      cinematicStyle: 'wide dynamic composition',
      aspectRatio: '16:9',
      promptSuffix: 'high detail',
    });
    expect(style.revision).toBe(2);
    expect(repository.listScenes('chapter').every((scene) => scene.status === 'CURRENT')).toBe(
      true,
    );
    expect(repository.listScenes('chapter').every((scene) => scene.promptStatus === 'STALE')).toBe(
      true,
    );

    const location = repository.listLocations('project')[0]!;
    repository.updateLocation('project', location.id, {
      expectedRowVersion: location.rowVersion,
      visualDescription: 'Mô tả địa điểm mới.',
    });
    expect(repository.listScenes('chapter').every((scene) => scene.promptStatus === 'STALE')).toBe(
      true,
    );
    fixture.database.sqlite.close();
  });

  it('retries technical failures, cancels without a partial plan, and recovers a committed plan', async () => {
    const retryFixture = await setup();
    const retryAgent = new FixtureSceneAgent(chapterText, 1);
    const retryEngine = new SceneEngine({ database: retryFixture.database, agent: retryAgent });
    const retryPlan = await retryEngine.generateScenes('project', 'chapter', { density: 'LOW' });
    expect(retryPlan.sceneCount).toBe(4);
    expect(retryAgent.calls).toHaveLength(2);
    retryFixture.database.sqlite.close();

    const cancelledFixture = await setup();
    const cancelledAgent = new FixtureSceneAgent(chapterText);
    const cancelledEngine = new SceneEngine({
      database: cancelledFixture.database,
      agent: cancelledAgent,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      cancelledEngine.generateScenes('project', 'chapter', { density: 'LOW' }, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(new SceneRepository(cancelledFixture.database).getScenePlan('chapter')).toBeNull();
    expect(cancelledAgent.calls).toHaveLength(1);
    cancelledFixture.database.sqlite.close();

    const recoveryFixture = await setup();
    const recoveryAgent = new FixtureSceneAgent(chapterText);
    const recoveryEngine = new SceneEngine({
      database: recoveryFixture.database,
      agent: recoveryAgent,
    });
    const workflow = new WorkflowRepository(recoveryFixture.database);
    const executionId = workflow.createExecution('project', 'SCENE_GENERATION');
    const stepId = workflow.createStep(
      executionId,
      'recover-scene-plan',
      'GENERATE_SCENES',
      'chapter',
      'pending-fingerprint',
      3,
      { density: 'LOW', targetRange: null },
    );
    const firstClaim = workflow.claim('worker-one');
    expect(firstClaim?.id).toBe(stepId);
    await recoveryEngine.executeStep(firstClaim!);
    expect(recoveryAgent.calls).toHaveLength(1);
    recoveryFixture.database.sqlite
      .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
      .run(new Date(Date.now() - 1_000).toISOString(), stepId);
    expect(workflow.recoverExpired()).toBe(1);
    const secondClaim = workflow.claim('worker-two');
    expect(secondClaim?.id).toBe(stepId);
    await recoveryEngine.executeStep(secondClaim!);
    workflow.complete(secondClaim!);
    expect(recoveryAgent.calls).toHaveLength(1);
    expect(new SceneRepository(recoveryFixture.database).getScenePlan('chapter')?.status).toBe(
      'CURRENT',
    );
    recoveryFixture.database.sqlite.close();
  });
});
