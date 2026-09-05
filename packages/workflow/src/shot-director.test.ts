import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, WorkflowRepository } from '@studio/database';
import { FfmpegTools, ProcessRunner, initializeWorkspace } from '@studio/media';
import type { SceneDto, ShotPlanCandidate } from '@studio/shared';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { ShotDirector, StudioService, WorkerExecutor, type StudioContext } from './index.js';
import { renderShotPlanningPrompt } from './shot-prompts.js';
import { compileShotDynamicPrompt, validateShotPlan } from './shot-validation.js';

const fingerprint = 'a'.repeat(64);
const state = {
  characters: [],
  objects: [],
  cameraAxis: '',
  locationId: null,
  sourceShotId: null,
  fingerprint,
};

function candidate(): ShotPlanCandidate {
  return {
    beats: [
      {
        id: 'beat-1',
        ordinal: 1,
        sourceRange: { startOffset: 0, endOffset: 3 },
        kind: 'ACTION',
        meaning: 'Cửa mở',
        importance: 'MEDIUM',
        turningPoint: false,
        timingGroupKey: 'group-1',
      },
    ],
    shots: [
      {
        id: 'shot-1',
        beatId: 'beat-1',
        ordinal: 1,
        sourceRange: { startOffset: 0, endOffset: 3 },
        primaryBeat: 'ACTION',
        eventKinds: ['ACTION'],
        eventCount: 1,
        importance: 'MEDIUM',
        hero: false,
        identitySensitive: false,
        dialogueMode: 'NONE',
        dialogueText: '',
        speakerCharacterId: null,
        visualCarrier: '',
        offscreenRationale: '',
        visibleCharacterIds: [],
        offscreenCharacterIds: [],
        staticIntent: {
          subject: 'Cánh cửa',
          action: 'mở',
          pose: '',
          expression: '',
          relationship: '',
          importantObjectIds: [],
          framing: 'MEDIUM',
          angle: '',
          composition: '',
          lighting: '',
          colorMood: '',
          atmosphere: '',
        },
        dynamicIntent: {
          subjectMotion: 'Cửa mở chậm',
          cameraMotion: 'STATIC',
          cameraSpeed: 'NONE',
          environmentMotion: '',
          emotionalTiming: '',
          speakingMotion: '',
          stabilityConstraints: [],
        },
        initialState: state,
        finalState: state,
        continuation: {
          mode: 'NEW_KEYFRAME',
          eligible: false,
          reason: 'Shot đầu',
          version: 'continuation-v1',
        },
        plannedDurationMs: 2_000,
        variationIntent: 'NORMAL',
      },
    ],
  };
}

class ShotAgent implements AiAgent {
  readonly calls: AiAgentRequest[] = [];
  async generate(request: AiAgentRequest): Promise<AiAgentResult> {
    this.calls.push(request);
    return {
      operation: request.operation,
      text: JSON.stringify(candidate()),
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

function scene(overrides: Partial<SceneDto> = {}): Pick<SceneDto, 'sourceRange'> {
  return { sourceRange: { start: 0, end: 3 }, ...overrides };
}

describe('Shot Director', () => {
  it('rejects overloaded, uncarried, speaking-monologue, and long Shots', () => {
    const value = candidate();
    value.shots[0] = {
      ...value.shots[0]!,
      eventCount: 2,
      dialogueMode: 'INTERNAL_MONOLOGUE',
      visualCarrier: '',
      dynamicIntent: { ...value.shots[0]!.dynamicIntent, speakingMotion: 'lips speak' },
      plannedDurationMs: 13_000,
    };
    expect(compileShotDynamicPrompt(value.shots[0])).toContain('no speaking or lip movement');
    expect(() => validateShotPlan(value, scene())).toThrow(/one sequential primary event/);
  });

  it('isolates turning points and warns only on accidental adjacent repetition', () => {
    const value = candidate();
    value.beats[0]!.turningPoint = true;
    value.shots.push({ ...value.shots[0]!, id: 'shot-2', ordinal: 2 });
    expect(() => validateShotPlan(value, scene())).toThrow(/must be isolated/);
    value.beats[0]!.turningPoint = false;
    expect(() => validateShotPlan(value, scene())).not.toThrow(/repeat/);
    value.shots[1] = { ...value.shots[1]!, variationIntent: 'MATCHED' };
    expect(validateShotPlan(value, scene()).issues).toEqual([]);
  });

  it('keeps the OMP request bounded and excludes pixel work', () => {
    const prompt = renderShotPlanningPrompt({
      scene: {
        id: 'scene-revision',
        stableId: 'scene-1',
        revision: 1,
        sourceRange: { start: 0, end: 3 },
        sourceExcerpt: 'abc',
        purpose: 'ACTION',
        characters: [],
        importantObjects: [],
        locationId: null,
        timeOfDay: '',
        weather: '',
        mood: '',
      },
      location: null,
      previousFinalState: null,
      nextScene: null,
    });
    expect(prompt.operation).toBe('PLAN_SHOTS');
    expect(prompt.userPrompt).toContain('abc');
    expect(prompt.userPrompt).not.toContain('full novel');
    expect(prompt.systemPrompt).toContain('Do not generate images, pixels');
  });

  it('runs through the durable worker and promotes one current plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shot-director-'));
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
      title: 'Shot project',
      description: '',
      language: 'vi-VN',
      workflowType: 'AUDIO_STORY',
    });
    const chapter = service.createChapter(project.id, { title: 'Chương 1', content: 'abc' });
    database.sqlite
      .prepare(
        "INSERT INTO scene_plan_revisions(id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,1,'LOW','scene-hash','CURRENT',1,?,?)",
      )
      .run(
        crypto.randomUUID(),
        project.id,
        chapter.id,
        1,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    const plan = database.sqlite.prepare('SELECT id FROM scene_plan_revisions').get() as {
      id: string;
    };
    const sceneId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    database.sqlite
      .prepare(
        `INSERT INTO scene_revisions(id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,source_content,scene_number,revision,title,summary,purpose,source_start_offset,source_end_offset,visual_description,camera,composition,image_prompt,input_fingerprint,prompt_version,schema_version,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,1,1,'Cảnh','Cửa mở','ACTION',0,3,'Cửa','{"framing":"MEDIUM","angle":null,"movementIntent":null}','{"subjectFocus":"Cửa","foreground":[],"midground":[],"background":[],"characterPositions":[]}','Cửa','hash','v1','v1',1,?,?)`,
      )
      .run(sceneId, 'scene-1', plan.id, project.id, chapter.id, 1, 'abc', timestamp, timestamp);
    const scheduled = service.scheduleShotPlanning(project.id, sceneId, {
      expectedSceneRevision: 1,
    });
    const workflow = new WorkflowRepository(database);
    const claim = workflow.claim('shot-worker')!;
    const agent = new ShotAgent();
    const director = new ShotDirector({ database, agent });
    await new WorkerExecutor(
      context,
      'shot-worker',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      director,
    ).execute(claim);
    workflow.complete(claim);
    expect(scheduled.stepId).toBe(claim.id);
    expect(agent.calls[0]?.operation).toBe('PLAN_SHOTS');
    expect(service.getCurrentShotPlan(project.id, sceneId)?.candidate.shots).toHaveLength(1);
    database.sqlite.close();
  });
});
