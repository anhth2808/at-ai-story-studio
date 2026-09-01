import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@studio/database';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { SceneEngine } from './scene-engine.js';

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
      location: 'Sân trong',
      timeOfDay: 'Sáng',
      weather: 'Trong',
      mood: 'Tò mò',
      characters: [
        {
          characterId: null,
          displayName: 'Nhân vật chưa biết',
          roleInScene: 'Người quan sát',
          visualState: {
            clothing: 'Áo xanh',
            injuries: [],
            expression: 'Thận trọng',
            pose: 'Đứng',
            action: 'Bước vào',
            position: 'Trung tâm',
            heldObjects: [],
          },
        },
      ],
      importantObjects: ['Cửa'],
      visualDescription: 'Cánh cửa mở vào sân.',
      camera: { framing: 'MEDIUM', angle: null, movementIntent: null },
      composition: {
        subjectFocus: 'Người ở cửa',
        foreground: [],
        midground: [],
        background: [],
        characterPositions: [],
      },
      lighting: 'Sáng dịu',
      colorMood: 'Xanh nhạt',
      imagePrompt: 'A cinematic medium shot of a person entering a courtyard',
      negativePrompt: 'text',
      continuityNotes: '',
    };
    const text =
      request.operation === 'SCENE_PLANNING'
        ? JSON.stringify({ scenes: [scene] })
        : request.operation === 'SCENE_REGENERATION'
          ? JSON.stringify({ scene })
          : JSON.stringify({
              imagePrompt: 'A refreshed cinematic courtyard prompt',
              negativePrompt: 'text',
            });
    return {
      operation: request.operation,
      text,
      provider: 'fake',
      model: 'fake',
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0,
      costCurrency: 'USD',
      finishReason: 'stop',
      durationMs: 1,
    };
  }
}

function setup() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Scene engine','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,story_origin,created_at,updated_at) VALUES('chapter','project',1,'Chapter','abc story text','ACTIVE',1,1,'MANUAL','2026-01-01','2026-01-01')",
    )
    .run();
  return database;
}

describe('SceneEngine', () => {
  it('plans, regenerates, and refreshes prompts through the isolated agent boundary', async () => {
    const database = setup();
    const agent = new SceneAgent();
    const engine = new SceneEngine({ database, agent });

    const plan = await engine.generateScenes('project', 'chapter', {
      density: 'LOW',
      targetRange: { min: 1, max: 1 },
      expectedChapterRevision: 1,
    });
    expect(plan.sceneCount).toBe(1);
    let scene = engine.scenes.listScenes('chapter')[0]!;
    expect(scene.characters[0]!.resolutionStatus).toBe('UNRESOLVED');
    expect(scene.sourceExcerpt).toBeUndefined();

    scene = await engine.regenerateScene('project', scene.id, {
      expectedRevision: scene.revision,
      instructions: 'Giữ nhịp chậm.',
    });
    expect(scene.revision).toBe(2);
    scene = await engine.refreshScenePrompt('project', scene.id, {
      expectedRevision: scene.revision,
    });
    expect(scene.revision).toBe(3);
    expect(scene.imagePrompt).toContain('refreshed');
    expect(agent.calls.map((call) => call.operation)).toEqual([
      'SCENE_PLANNING',
      'SCENE_REGENERATION',
      'SCENE_PROMPT',
    ]);
    expect(agent.calls[2]!.userPrompt).toContain('Cánh cửa mở vào sân.');
    expect(agent.calls[2]!.userPrompt).toContain(
      'A cinematic medium shot of a person entering a courtyard',
    );
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM story_generation_records WHERE status='COMPLETED'")
        .get(),
    ).toEqual({ count: 3 });
    database.sqlite.close();
  });
});
