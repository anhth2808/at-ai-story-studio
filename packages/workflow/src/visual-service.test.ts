import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, StoryRepository } from '@studio/database';
import { storyBlueprintSchema, storySettingsSchema } from '@studio/shared';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { createVisualConsistencyService } from './index.js';

const settings = storySettingsSchema.parse({
  mode: 'IDEA_TO_STORY',
  idea: 'A courier keeps a promise through a city that forgets.',
  language: 'vi-VN',
  genre: 'fantasy',
  tone: 'reflective',
  audience: 'general',
  targetChapterCount: 1,
  chapterLength: 800,
  pacing: 'MEDIUM',
  contentBoundaries: [],
  characterNotes: '',
  worldNotes: '',
  plotRequirements: '',
  generation: {},
});
const blueprint = storyBlueprintSchema.parse({
  premise: 'A courier keeps a promise.',
  themes: ['duty'],
  worldRules: ['Memories have a price.'],
  continuityConstraints: ['Mai never abandons a delivery.'],
  plotDirection: 'The promise changes the city.',
  characters: [
    {
      id: 'mai',
      name: 'Mai',
      role: 'courier',
      ageRange: 'adult',
      appearance: 'short dark hair',
      personality: 'steady',
      wants: 'finish the delivery',
      fears: 'forgetting her own name',
      traits: ['observant'],
      relationships: [],
      backstory: 'She inherited the route from her mother.',
      voice: 'plain and careful',
      arc: 'from duty to chosen responsibility',
    },
  ],
});
const profile = {
  ageAppearance: 'adult',
  genderPresentation: 'woman',
  bodyType: 'lean',
  heightDescription: 'average height',
  faceShape: 'oval',
  skinTone: 'warm olive',
  hairStyle: 'short practical cut',
  hairColor: 'black',
  eyeDescription: 'dark observant eyes',
  distinctiveFeatures: ['small scar on left brow'],
  defaultExpression: 'focused calm',
  defaultClothing: 'weathered courier coat',
  clothingDetails: ['brass clasp', 'leather satchel'],
  accessories: ['sealed route token'],
  colorIdentity: ['indigo', 'brass'],
  visualKeywords: ['grounded', 'resilient'],
  negativeTraits: ['inconsistent face'],
  styleNotes: 'Keep the silhouette recognizable.',
  variants: [],
  referenceAssetIds: [],
};

class FakeAgent implements AiAgent {
  readonly calls: AiAgentRequest[] = [];
  async generate(request: AiAgentRequest): Promise<AiAgentResult> {
    this.calls.push(request);
    return {
      operation: request.operation,
      text: JSON.stringify({ profile }),
      provider: 'fixture',
      model: 'fixture-model',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costCurrency: null,
      finishReason: 'stop',
      durationMs: 1,
    };
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-visual-service-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Visual project','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  const agent = new FakeAgent();
  const story = new StoryRepository(database);
  const service = createVisualConsistencyService(database, agent);
  const savedSettings = story.saveSettings('project', settings);
  story.saveBlueprint('project', savedSettings.id, blueprint, null, 'a'.repeat(64));
  return { database, service, agent };
}

describe('Visual Consistency service', () => {
  it('persists an OMP candidate as DRAFT and requires explicit approval', async () => {
    const fixture = await setup();
    const generated = await fixture.service.generateCharacterProfile({
      projectId: 'project',
      characterId: 'mai',
    });
    expect(generated.profile.status).toBe('DRAFT');
    expect(generated.generationId).toBeTruthy();
    const repeated = await fixture.service.generateCharacterProfile({
      projectId: 'project',
      characterId: 'mai',
    });
    expect(repeated.profile.id).toBe(generated.profile.id);
    expect(fixture.agent.calls).toHaveLength(1);
    expect(fixture.agent.calls[0]?.operation).toBe('CHARACTER_VISUAL_PROFILE');
    expect(
      fixture.database.sqlite
        .prepare('SELECT operation,status,provider,model FROM ai_usage WHERE project_id=?')
        .all('project'),
    ).toEqual([
      {
        operation: 'CHARACTER_VISUAL_PROFILE',
        status: 'SUCCEEDED',
        provider: 'fixture',
        model: 'fixture-model',
      },
    ]);
    const edited = fixture.service.updateCharacterProfile('project', 'mai', {
      expectedRevision: generated.profile.revision,
      payload: { hairColor: 'dark brown' },
    });
    expect(edited.status).toBe('DRAFT');
    const approved = fixture.service.approveCharacterProfile('project', 'mai', edited.revision);
    expect(approved.status).toBe('APPROVED');
    const referencesUpdated = fixture.service.updateCharacterProfileReferences('project', 'mai', {
      expectedRevision: approved.revision,
      referenceAssetIds: [],
    });
    expect(referencesUpdated.status).toBe('APPROVED');
    expect(referencesUpdated.revision).toBe(approved.revision + 1);
    expect(fixture.service.getCharacterProfile('project', 'mai')?.revision).toBe(
      referencesUpdated.revision,
    );
    fixture.database.sqlite.close();
  });

  it('rejects malformed provider output without persisting a profile', async () => {
    const fixture = await setup();
    fixture.agent.generate = async (request) => ({
      operation: request.operation,
      text: '{invalid',
      provider: 'fixture',
      model: 'fixture-model',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      durationMs: 1,
    });
    await expect(
      fixture.service.generateCharacterProfile({ projectId: 'project', characterId: 'mai' }),
    ).rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_ERROR' });
    expect(
      fixture.database.sqlite
        .prepare('SELECT operation,status FROM ai_usage WHERE project_id=?')
        .all('project'),
    ).toEqual([{ operation: 'CHARACTER_VISUAL_PROFILE', status: 'FAILED' }]);
    expect(fixture.service.getCharacterProfile('project', 'mai')).toBeNull();
    fixture.database.sqlite.close();
  });
});
