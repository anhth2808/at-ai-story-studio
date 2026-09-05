import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  SceneObjectResolutionRepository,
  SceneRepository,
  VisualProfileRepository,
  VisualPromptPackageRepository,
} from '@studio/database';
import type { DatabaseHandle } from '@studio/database';
import type {
  ReferenceBinding,
  SceneDto,
  Shot,
  StoryBlueprint,
  StoryState,
  VisualStyleSettings,
} from '@studio/shared';
import {
  buildVisualPromptPackage,
  buildShotVisualPromptPackage,
  fingerprintValue,
  mergeNegativePromptFragments,
  orderReferenceBindings,
  validateReferencePlaceholderRewrite,
  missingVisualPromptConstraints,
} from './visual-prompts.js';

function setup(): DatabaseHandle {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Prompt test','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO chapters(id,project_id,number,title,content,created_at,updated_at) VALUES('chapter','project',1,'Chapter','Cánh cửa mở ra.','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO locations(id,project_id,name,normalized_name,created_at,updated_at) VALUES('location','project','Sân trong','sân trong','2026-01-01','2026-01-01')",
    )
    .run();
  return database;
}

const scene: SceneDto = {
  id: 'scene',
  stableId: 'scene-stable',
  projectId: 'project',
  scenePlanRevisionId: 'plan',
  chapterId: 'chapter',
  chapterRevision: 1,
  planRevision: 1,
  revision: 1,
  sceneNumber: 1,
  title: 'Cánh cửa',
  summary: 'Mai bước qua cánh cửa.',
  purpose: 'INTRODUCTION',
  sourceRange: { start: 0, end: 10 },
  location: 'Sân trong',
  locationId: 'location',
  timeOfDay: 'Sáng',
  weather: 'Trong',
  mood: 'Tò mò',
  characters: [
    {
      characterId: 'mai',
      displayName: 'Mai',
      roleInScene: 'Người quan sát',
      visualState: {
        clothing: 'áo khoác xanh',
        injuries: [],
        expression: 'thận trọng',
        variantKey: 'winter',
        pose: 'đứng',
        action: 'bước vào',
        position: 'trung tâm',
        heldObjects: [],
      },
      resolutionStatus: 'RESOLVED',
    },
  ],
  importantObjects: ['Old wooden door'],
  visualDescription: 'Cánh cửa cũ mở vào sân sáng.',
  camera: { framing: 'MEDIUM', angle: 'ngang mắt', movementIntent: null },
  composition: {
    subjectFocus: 'Mai ở ngưỡng cửa',
    foreground: [],
    midground: ['Mai'],
    background: ['Sân trong'],
    characterPositions: [],
  },
  lighting: 'Ánh sáng buổi sáng',
  colorMood: 'Xanh và vàng nhạt',
  imagePrompt: 'legacy prompt',
  negativePrompt: 'text, watermark',
  continuityNotes: '',
  styleRevisionId: null,
  status: 'CURRENT',
  promptStatus: 'CURRENT',
  unresolvedReferences: [],
  generationId: null,
  inputFingerprint: 'scene-input',
  promptVersion: 'scene-v1',
  schemaVersion: 'scene-v1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const blueprint: StoryBlueprint = {
  premise: 'A quiet mystery.',
  themes: [],
  worldRules: [],
  continuityConstraints: [],
  plotDirection: '',
  characters: [
    {
      id: 'mai',
      name: 'Mai',
      role: 'observer',
      ageRange: 'adult',
      appearance: 'slim adult with a small scar',
      personality: 'careful',
      wants: '',
      fears: '',
      traits: ['careful'],
      relationships: [],
      backstory: '',
      voice: '',
      arc: '',
    },
  ],
};

const state: StoryState = {
  projectId: 'project',
  revision: 1,
  currentChapter: 1,
  rollingProgressSummary: '',
  currentArcId: null,
  currentPhase: 'RISING_ACTION',
  characterStates: [],
  threads: [],
  importantFacts: [],
  recentEvents: [],
  gapMarkers: [],
  sourceChapterId: null,
  sourceChapterRevision: null,
  previousRevision: null,
  updatedAt: '2026-01-01',
};

const style: VisualStyleSettings = {
  styleName: 'Cinematic',
  styleDescription: 'grounded',
  medium: 'digital illustration',
  realism: 'stylized realism',
  overallStyle: 'cinematic realistic',
  colorPalette: 'warm',
  cinematicStyle: 'widescreen',
  cinematicLanguage: 'layered depth',
  lightingStyle: 'motivated',
  textureStyle: 'natural',
  environmentStyle: 'detailed',
  characterRenderingStyle: 'natural faces',
  cameraStyle: 'cinematic',
  compositionStyle: 'clear',
  moodKeywords: ['immersive'],
  aspectRatio: '16:9',
  promptSuffix: '',
  positivePromptSuffix: 'coherent visual continuity',
  negativePrompt: 'watermark, text',
  referenceAssetIds: [],
};

describe('visual prompt resolver', () => {
  it('keeps stable serialization and merges distinct negatives once', () => {
    expect(fingerprintValue({ b: 2, a: 1 })).toBe(fingerprintValue({ a: 1, b: 2 }));
    expect(mergeNegativePromptFragments('text', ['Watermark', 'text'], 'watermark')).toBe(
      'text, Watermark',
    );
  });

  it('assembles canonical profiles, scene state, and style in fixed order', () => {
    const database = setup();
    const scenes = new SceneRepository(database);
    const profiles = new VisualProfileRepository(database);
    const objects = new SceneObjectResolutionRepository(database);
    const savedStyle = scenes.saveVisualStyle('project', style);
    profiles.saveCharacter({
      projectId: 'project',
      characterId: 'mai',
      payload: {
        hairColor: 'black',
        distinctiveFeatures: ['small scar'],
        negativeTraits: ['inconsistent face'],
        variants: [{ key: 'winter', description: 'thick blue cloak', promptOverrides: [] }],
      },
      inputFingerprint: 'draft-character',
      status: 'DRAFT',
    });
    const draftResult = buildVisualPromptPackage({
      projectId: 'project',
      scene,
      blueprint,
      storyState: state,
      style: savedStyle,
      profiles,
      objectResolutions: objects,
      locationMatches: (projectId, name) => scenes.listLocationMatches(projectId, name),
    });
    expect(draftResult.package.consistencyStatus).toBe('FAIL');
    expect(
      draftResult.package.consistencyIssues.some((issue) =>
        issue.message.includes('awaiting approval'),
      ),
    ).toBe(true);
    profiles.saveCharacter({
      projectId: 'project',
      characterId: 'mai',
      payload: {
        hairColor: 'black',
        distinctiveFeatures: ['small scar'],
        negativeTraits: ['inconsistent face'],
        variants: [{ key: 'winter', description: 'thick blue cloak', promptOverrides: [] }],
      },
      inputFingerprint: 'character',
      status: 'APPROVED',
    });
    profiles.saveLocation({
      projectId: 'project',
      locationId: 'location',
      locationName: 'Sân trong',
      payload: { overallDescription: 'old stone courtyard' },
      inputFingerprint: 'location',
      status: 'APPROVED',
    });
    profiles.saveObject({
      projectId: 'project',
      objectKey: 'old wooden door',
      name: 'Old wooden door',
      payload: {
        name: 'Old wooden door',
        description: 'weathered wood',
        negativeTraits: ['plastic'],
      },
      inputFingerprint: 'object',
      status: 'APPROVED',
    });
    database.sqlite
      .prepare(
        `INSERT INTO scene_plan_revisions(
          id,project_id,chapter_id,chapter_revision,revision,density,target_range,style_revision_id,
          input_fingerprint,generation_id,metadata,status,is_current,created_at,updated_at
        ) VALUES('plan','project','chapter',1,1,'MEDIUM',NULL,?,'plan-input',NULL,NULL,'CURRENT',1,'2026-01-01','2026-01-01')`,
      )
      .run(savedStyle.id);
    database.sqlite
      .prepare(
        `INSERT INTO scene_revisions(
          id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,scene_number,revision,
          title,summary,purpose,source_start_offset,source_end_offset,location_id,location_name_snapshot,
          time_of_day,weather,mood,visual_description,camera,composition,important_objects,lighting,
          color_mood,image_prompt,negative_prompt,continuity_notes,unresolved_references,status,prompt_status,
          style_revision_id,input_fingerprint,prompt_version,schema_version,generation_id,is_current,created_at,updated_at
        ) VALUES('scene','scene-stable','plan','project','chapter',1,1,1,'Cánh cửa','Mai bước qua cửa.',
          'INTRODUCTION',0,10,'location','Sân trong','Sáng','Trong','Tò mò','Cánh cửa cũ mở vào sân.',
          ?,?,?,?, 'Xanh và vàng nhạt','legacy prompt','text, watermark','', '[]','CURRENT','CURRENT',?,
          'scene-input','scene-v1','scene-v1',NULL,1,'2026-01-01','2026-01-01')`,
      )
      .run(
        JSON.stringify(scene.camera),
        JSON.stringify(scene.composition),
        JSON.stringify(scene.importantObjects),
        scene.lighting,
        savedStyle.id,
      );

    const result = buildVisualPromptPackage({
      projectId: 'project',
      scene,
      blueprint,
      storyState: state,
      style: savedStyle,
      profiles,
      objectResolutions: objects,
      locationMatches: (projectId, name) => scenes.listLocationMatches(projectId, name),
    });
    const prompt = result.package.fullPrompt;
    expect(result.package.consistencyStatus).toBe('PASS');
    expect(prompt.indexOf('Subject/action:')).toBeLessThan(prompt.indexOf('Characters:'));
    expect(prompt.indexOf('Characters:')).toBeLessThan(prompt.indexOf('Location:'));
    expect(prompt.indexOf('Location:')).toBeLessThan(prompt.indexOf('Objects:'));
    expect(prompt.indexOf('Objects:')).toBeLessThan(prompt.indexOf('Camera/composition:'));
    expect(prompt.indexOf('Camera/composition:')).toBeLessThan(prompt.indexOf('Lighting/mood:'));
    expect(prompt).toContain('variant: thick blue cloak');
    expect(prompt.indexOf('Lighting/mood:')).toBeLessThan(prompt.indexOf('Style Bible:'));
    expect(result.package.negativePrompt).toContain('text');
    expect(result.package.negativePrompt).toContain('inconsistent face');
    expect(result.package.negativePrompt).toContain('plastic');
    expect(
      missingVisualPromptConstraints(
        result.package,
        result.package.fullPrompt,
        result.package.negativePrompt,
      ),
    ).toEqual([]);
    expect(missingVisualPromptConstraints(result.package, 'Only a new subject.', null)).toEqual(
      expect.arrayContaining(['prompt:Mai', 'prompt:Sân trong', 'negative:text']),
    );
    expect(result.package.dependencies.map((item) => item.kind)).toEqual([
      'CHARACTER_PROFILE',
      'LOCATION_PROFILE',
      'OBJECT_PROFILE',
      'STYLE_BIBLE',
    ]);
    const packages = new VisualPromptPackageRepository(database);
    const firstPackage = packages.saveCurrent({
      projectId: 'project',
      sceneRevisionId: 'scene',
      payload: result.package,
    });
    expect(
      packages.saveCurrent({
        projectId: 'project',
        sceneRevisionId: 'scene',
        payload: result.package,
      }).id,
    ).toBe(firstPackage.id);
    expect(packages.invalidateDependency('project', 'CHARACTER_PROFILE', 'mai')).toEqual(['scene']);
    expect(packages.getCurrent('project', 'scene')).toBeNull();
    const rebuilt = packages.saveCurrent({
      projectId: 'project',
      sceneRevisionId: 'scene',
      payload: result.package,
    });
    expect(rebuilt.revision).toBe(2);
    expect(
      database.sqlite
        .prepare(
          'SELECT COUNT(*) as count FROM visual_prompt_package_dependencies WHERE package_id=?',
        )
        .get(rebuilt.id),
    ).toEqual({ count: 4 });
    const refined = packages.saveRefinement({
      projectId: 'project',
      sceneRevisionId: 'scene',
      packageFingerprint: result.package.inputFingerprint,
      refinementInputFingerprint: 'refinement-input',
      fullPrompt: 'Refined but canonical-safe prompt.',
      negativePrompt: result.package.negativePrompt,
    });
    expect(refined.revision).toBe(3);
    expect(refined.payload.refinedPrompt).toBe('Refined but canonical-safe prompt.');
    for (const objectKey of ['relic-a', 'relic-b'])
      profiles.saveObject({
        projectId: 'project',
        objectKey,
        name: 'Relic',
        payload: { name: 'Relic', description: 'A canonical relic.' },
        inputFingerprint: objectKey,
        status: 'APPROVED',
      });
    const ambiguous = buildVisualPromptPackage({
      projectId: 'project',
      scene: { ...scene, importantObjects: ['Relic'] },
      blueprint,
      storyState: state,
      style: savedStyle,
      profiles,
      objectResolutions: objects,
      locationMatches: (projectId, name) => scenes.listLocationMatches(projectId, name),
    });
    expect(ambiguous.package.consistencyStatus).toBe('WARN');
    expect(
      ambiguous.package.consistencyIssues.some((issue) => issue.type === 'OBJECT_CONFLICT'),
    ).toBe(true);
    const unresolved = buildVisualPromptPackage({
      projectId: 'project',
      scene: { ...scene, location: 'Unknown alley', locationId: null },
      blueprint,
      storyState: state,
      style: savedStyle,
      profiles,
      objectResolutions: objects,
      locationMatches: (projectId, name) => scenes.listLocationMatches(projectId, name),
    });
    expect(unresolved.package.consistencyStatus).toBe('FAIL');
    expect(
      unresolved.package.consistencyIssues.some((issue) => issue.type === 'UNRESOLVED_REFERENCE'),
    ).toBe(true);
    const mappedProfile = profiles.saveObject({
      projectId: 'project',
      objectKey: 'relic-canonical',
      name: 'Relic',
      payload: { name: 'Relic', description: 'The selected canonical relic.' },
      inputFingerprint: 'relic-canonical',
      status: 'APPROVED',
    });
    objects.save({
      projectId: 'project',
      sceneRevisionId: 'scene',
      sourceLabel: 'Relic',
      normalizedKey: 'relic',
      visualObjectProfileId: mappedProfile.id,
      resolutionStatus: 'RESOLVED',
    });
    const mapped = buildVisualPromptPackage({
      projectId: 'project',
      scene: { ...scene, importantObjects: ['Relic'] },
      blueprint,
      storyState: state,
      style: savedStyle,
      profiles,
      objectResolutions: objects,
      locationMatches: (projectId, name) => scenes.listLocationMatches(projectId, name),
    });
    expect(mapped.package.objects[0]?.profileId).toBe(mappedProfile.id);
  });

  it('compiles deterministic Shot prompts with exact bindings and no semantic pollution', () => {
    const database = setup();
    const scenes = new SceneRepository(database);
    const profiles = new VisualProfileRepository(database);
    const objects = new SceneObjectResolutionRepository(database);
    const savedStyle = scenes.saveVisualStyle('project', style);
    profiles.saveCharacter({
      projectId: 'project',
      characterId: 'mai',
      payload: { hairColor: 'black' },
      inputFingerprint: 'character',
      status: 'APPROVED',
    });
    profiles.saveLocation({
      projectId: 'project',
      locationId: 'location',
      locationName: 'Sân trong',
      payload: { overallDescription: 'old stone courtyard' },
      inputFingerprint: 'location',
      status: 'APPROVED',
    });
    const stateFingerprint = 'd'.repeat(64);
    const shot: Shot = {
      id: 'shot-1',
      beatId: 'beat-1',
      ordinal: 1,
      sourceRange: { startOffset: 0, endOffset: 10 },
      primaryBeat: 'ACTION',
      eventKinds: ['ACTION'],
      eventCount: 1,
      importance: 'HIGH',
      hero: true,
      identitySensitive: true,
      dialogueMode: 'OFFSCREEN_SPOKEN',
      dialogueText: 'Mai gọi từ ngoài khung hình',
      speakerCharacterId: 'mai',
      visualCarrier: 'the door reacts by opening',
      offscreenRationale: 'Mai remains outside the room',
      visibleCharacterIds: [],
      offscreenCharacterIds: ['mai'],
      staticIntent: {
        subject: 'Old wooden door',
        action: 'opens toward off-camera direction',
        pose: '',
        expression: '',
        relationship: '',
        importantObjectIds: [],
        framing: 'CLOSE_UP',
        angle: 'eye level',
        composition: 'door fills frame',
        lighting: 'soft morning light',
        colorMood: 'muted blue',
        atmosphere: 'quiet',
      },
      dynamicIntent: {
        subjectMotion: 'door opens slowly',
        cameraMotion: 'STATIC',
        cameraSpeed: 'NONE',
        environmentMotion: '',
        emotionalTiming: '',
        speakingMotion: '',
        stabilityConstraints: [],
      },
      initialState: {
        characters: [],
        objects: [],
        cameraAxis: '',
        locationId: 'location',
        sourceShotId: null,
        fingerprint: stateFingerprint,
      },
      finalState: {
        characters: [],
        objects: [],
        cameraAxis: '',
        locationId: 'location',
        sourceShotId: null,
        fingerprint: stateFingerprint,
      },
      continuation: {
        mode: 'NEW_KEYFRAME',
        eligible: false,
        reason: 'First shot',
        version: 'v1',
      },
      plannedDurationMs: 2_000,
      variationIntent: 'NORMAL',
    };
    const bindings: ReferenceBinding[] = [
      {
        ordinal: 1,
        role: 'LOCATION',
        assetId: 'location-asset',
        entityId: 'location',
        stageId: null,
        sha256: 'a'.repeat(64),
        revision: 1,
        fingerprint: 'location-ref',
      },
      {
        ordinal: 2,
        role: 'PRIMARY_CHARACTER',
        assetId: 'character-asset',
        entityId: 'mai',
        stageId: 'winter',
        sha256: 'b'.repeat(64),
        revision: 2,
        fingerprint: 'character-ref',
      },
    ];
    const result = buildShotVisualPromptPackage({
      projectId: 'project',
      scene: {
        ...scene,
        summary: 'secret knowledge: Mai knows the code',
        characters: scene.characters.map((character) => ({
          ...character,
          roleInScene: 'secret keeper',
        })),
      },
      shot,
      referenceBindings: bindings,
      blueprint,
      storyState: {
        ...state,
        characterStates: [
          {
            characterId: 'mai',
            location: 'hidden archive',
            currentGoal: 'steal the secret',
            powerLevel: '',
            injuries: [],
            possessions: [],
            relationships: [],
            lastUpdatedChapter: null,
            knowledge: ['the hidden code'],
          },
        ],
      },
      style: savedStyle,
      profiles,
      objectResolutions: objects,
      locationMatches: (projectId, name) => scenes.listLocationMatches(projectId, name),
    });
    expect(result.package.characters).toEqual([]);
    expect(result.package.fullPrompt).not.toContain('secret');
    expect(result.package.fullPrompt).not.toContain('{"camera"');
    expect(result.package.fullPrompt).not.toContain('Mai');
    expect(result.package.fullPrompt).not.toContain('primary character mai');
    expect(result.package.fullPrompt).toContain('[REF_1] location location');
    expect(result.package.dynamicIntent?.subjectMotion).toBe('door opens slowly');
    expect(result.package.fullPrompt).not.toContain('door opens slowly');
    expect(orderReferenceBindings('WIDE', bindings).map((binding) => binding.role)).toEqual([
      'LOCATION',
      'PRIMARY_CHARACTER',
    ]);
    expect(
      validateReferencePlaceholderRewrite(
        result.package.fullPrompt,
        result.package.fullPrompt,
        result.package.referenceBindings,
      ),
    ).toBe(true);
    expect(
      validateReferencePlaceholderRewrite(
        result.package.fullPrompt,
        result.package.fullPrompt.replace('[REF_1]', '[REF_2]'),
        result.package.referenceBindings,
      ),
    ).toBe(false);
  });
});
