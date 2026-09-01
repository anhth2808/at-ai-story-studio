import { createHash, randomUUID } from 'node:crypto';
import {
  aiUsageSchema,
  locationSchema,
  locationStatusSchema,
  locationUpdateSchema,
  sceneCameraSchema,
  sceneCharacterResolutionStatusSchema,
  sceneCharacterVisualStateSchema,
  sceneCompositionSchema,
  sceneCountRangeSchema,
  sceneDensitySchema,
  sceneEditSchema,
  scenePlanItemSchema,
  scenePromptStatusSchema,
  scenePurposeSchema,
  sceneSourceRangeSchema,
  sceneStatusSchema,
  sceneStringArraySchema,
  visualStyleSettingsSchema,
  type AiUsage,
  type GenerationMetadata,
  type Id,
  type Location,
  type LocationDto,
  type SceneCharacter,
  type SceneCharacterDto,
  type SceneCountRange,
  type SceneDensity,
  type SceneDto,
  type SceneSourceRange,
  type SceneEdit,
  type ScenePlanDto,
  type ScenePlanItem,
  type ScenePromptStatus,
  type SceneStatus,
  type VisualStyleSettings,
  type VisualStyleSettingsDto,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';
const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const parseJson = (value: string): unknown => JSON.parse(value);

export function normalizeLocationName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/^(the)\s+/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export type LocationResolution = {
  locationId: Id | null;
  name: string | null;
  normalizedName: string;
  ambiguousIds: Id[];
  createdDraft: boolean;
};

export type SceneCharacterPersistence = {
  characterId: string | null;
  displayName: string;
  roleInScene: string;
  visualState: SceneCharacter['visualState'];
  resolutionStatus: 'RESOLVED' | 'UNRESOLVED';
  dependencyFingerprint: string | null;
};

export type ScenePersistenceInput = Omit<ScenePlanItem, 'characters'> & {
  stableId?: string;
  characters: SceneCharacterPersistence[];
  locationId: Id | null;
  unresolvedReferences: string[];
  styleRevisionId: Id | null;
  inputFingerprint: string;
  promptVersion: string;
  schemaVersion: string;
  status?: SceneStatus;
  sourceContent?: string;
  promptStatus?: ScenePromptStatus;
};

export type ScenePlanPersistenceInput = {
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  density: SceneDensity;
  targetRange: SceneCountRange | null;
  styleRevisionId: Id | null;
  generationId: Id;
  inputFingerprint: string;
  metadata: GenerationMetadata;
  scenes: ScenePersistenceInput[];
  usage?: Omit<AiUsage, 'id' | 'createdAt'>;
};

export type SceneRevisionPersistenceInput = ScenePersistenceInput & {
  sceneId: Id;
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  scenePlanRevisionId: Id;
  generationId: Id;
  metadata: GenerationMetadata;
  usage?: Omit<AiUsage, 'id' | 'createdAt'>;
};

export type ScenePromptPersistenceInput = {
  sceneId: Id;
  imagePrompt: string;
  negativePrompt: string | null;
  styleRevisionId: Id | null;
  inputFingerprint: string;
  promptVersion: string;
  schemaVersion: string;
  generationId: Id;
  metadata: GenerationMetadata;
  usage?: Omit<AiUsage, 'id' | 'createdAt'>;
};

type LocationRow = {
  id: Id;
  projectId: Id;
  name: string;
  normalizedName: string;
  description: string;
  type: string;
  visualDescription: string;
  environment: string;
  architecture: string;
  importantObjects: string;
  lightingDefaults: string;
  status: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

type ScenePlanRow = {
  id: Id;
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  revision: number;
  density: string;
  targetRange: string | null;
  styleRevisionId: Id | null;
  inputFingerprint: string;
  generationId: Id | null;
  status: string;
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
};

type SceneRow = {
  id: Id;
  stableId: string;
  planRevisionId: Id;
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  planRevision: number;
  sceneNumber: number;
  revision: number;
  title: string;
  summary: string;
  purpose: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  locationId: Id | null;
  locationNameSnapshot: string | null;
  timeOfDay: string;
  weather: string;
  mood: string;
  visualDescription: string;
  camera: string;
  composition: string;
  importantObjects: string;
  lighting: string;
  colorMood: string;
  imagePrompt: string;
  negativePrompt: string | null;
  continuityNotes: string;
  unresolvedReferences: string;
  status: string;
  promptStatus: string;
  styleRevisionId: Id | null;
  inputFingerprint: string;
  promptVersion: string;
  schemaVersion: string;
  generationId: Id | null;
  createdAt: string;
  updatedAt: string;
  sourceContent: string;
};

type SceneCharacterRow = {
  characterId: string | null;
  displayName: string;
  resolutionStatus: string;
  roleInScene: string;
  visualState: string;
};

type SceneInsertInput = {
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  sceneStableId: string;
  scenePlanRevisionId: Id;
  styleRevisionId: Id | null;
  generationId: Id | null;
  sceneNumber: number;
  revision: number;
  scene: ScenePersistenceInput;
};

export class SceneRepository {
  constructor(private readonly database: DatabaseHandle) {}

  getVisualStyle(projectId: Id): VisualStyleSettingsDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,revision,style_name as styleName,
          style_description as styleDescription,medium,realism,color_palette as colorPalette,
          cinematic_style as cinematicStyle,aspect_ratio as aspectRatio,prompt_suffix as promptSuffix,
          input_fingerprint as inputFingerprint,created_at as createdAt,updated_at as updatedAt
         FROM visual_style_settings WHERE project_id=? AND is_current=1`,
      )
      .get(projectId) as VisualStyleSettingsDto | undefined;
    return row ? row : null;
  }

  saveVisualStyle(
    projectId: Id,
    input: VisualStyleSettings,
    expectedRevision?: number,
  ): VisualStyleSettingsDto {
    const style = visualStyleSettingsSchema.parse(input);
    const current = this.getVisualStyle(projectId);
    if (expectedRevision !== undefined && current?.revision !== expectedRevision)
      throw new Error('Revision conflict');
    const revision = (current?.revision ?? 0) + 1;
    const id = randomUUID();
    const stamp = now();
    const inputFingerprint = this.fingerprint({ projectId, revision, style });
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('UPDATE visual_style_settings SET is_current=0,updated_at=? WHERE project_id=?')
        .run(stamp, projectId);
      this.database.sqlite
        .prepare(
          `INSERT INTO visual_style_settings(
            id,project_id,revision,style_name,style_description,medium,realism,color_palette,
            cinematic_style,aspect_ratio,prompt_suffix,input_fingerprint,row_version,is_current,
            created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)`,
        )
        .run(
          id,
          projectId,
          revision,
          style.styleName,
          style.styleDescription,
          style.medium,
          style.realism,
          style.colorPalette,
          style.cinematicStyle,
          style.aspectRatio,
          style.promptSuffix,
          inputFingerprint,
          stamp,
          stamp,
        );
      this.markProjectPromptsStaleInTransaction(projectId, stamp);
    })();
    return this.getVisualStyle(projectId)!;
  }

  listLocations(projectId: Id, limit = 100, offset = 0): LocationDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,name,normalized_name as normalizedName,description,type,
          visual_description as visualDescription,environment,architecture,important_objects as importantObjects,
          lighting_defaults as lightingDefaults,status,row_version as rowVersion,created_at as createdAt,
          updated_at as updatedAt
         FROM locations WHERE project_id=? ORDER BY name LIMIT ? OFFSET ?`,
      )
      .all(projectId, Math.max(1, Math.min(200, limit)), Math.max(0, offset)) as LocationRow[];
    return rows.map((row) => this.parseLocationRow(row));
  }

  getLocation(projectId: Id, locationId: Id): LocationDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,name,normalized_name as normalizedName,description,type,
          visual_description as visualDescription,environment,architecture,important_objects as importantObjects,
          lighting_defaults as lightingDefaults,status,row_version as rowVersion,created_at as createdAt,
          updated_at as updatedAt
         FROM locations WHERE project_id=? AND id=?`,
      )
      .get(projectId, locationId) as LocationRow | undefined;
    return row ? this.parseLocationRow(row) : null;
  }

  createLocation(projectId: Id, input: Location): LocationDto {
    const location = locationSchema.parse(input);
    const normalizedName = normalizeLocationName(location.name);
    if (!normalizedName) throw new Error('Location name is invalid');
    if (this.findLocations(projectId, normalizedName).length)
      throw new Error('A location with the same normalized name already exists');
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO locations(
          id,project_id,name,normalized_name,description,type,visual_description,environment,
          architecture,important_objects,lighting_defaults,status,row_version,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      )
      .run(
        id,
        projectId,
        location.name,
        normalizedName,
        location.description,
        location.type,
        location.visualDescription,
        location.environment,
        location.architecture,
        json(location.importantObjects),
        location.lightingDefaults,
        location.status,
        stamp,
        stamp,
      );
    return this.getLocation(projectId, id)!;
  }

  updateLocation(projectId: Id, locationId: Id, input: unknown): LocationDto {
    const update = locationUpdateSchema.parse(input);
    const { expectedRowVersion, ...patch } = update;
    const current = this.getLocation(projectId, locationId);
    if (!current) throw new Error('Location not found');
    if (expectedRowVersion !== undefined && current.rowVersion !== expectedRowVersion)
      throw new Error('Revision conflict');
    const next = locationSchema.parse({ ...this.locationPayload(current), ...patch });
    const normalizedName = normalizeLocationName(next.name);
    if (!normalizedName) throw new Error('Location name is invalid');
    const collisions = this.findLocations(projectId, normalizedName).filter(
      (row) => row.id !== locationId,
    );
    if (collisions.length)
      throw new Error('A location with the same normalized name already exists');
    const stamp = now();
    const result = this.database.sqlite
      .prepare(
        `UPDATE locations SET name=?,normalized_name=?,description=?,type=?,visual_description=?,
          environment=?,architecture=?,important_objects=?,lighting_defaults=?,status=?,row_version=row_version+1,
          updated_at=? WHERE project_id=? AND id=? AND row_version=?`,
      )
      .run(
        next.name,
        normalizedName,
        next.description,
        next.type,
        next.visualDescription,
        next.environment,
        next.architecture,
        json(next.importantObjects),
        next.lightingDefaults,
        next.status,
        stamp,
        projectId,
        locationId,
        current.rowVersion,
      );
    if (result.changes !== 1) throw new Error('Revision conflict');
    this.markLocationPromptsStale(projectId, locationId);
    return this.getLocation(projectId, locationId)!;
  }

  resolveLocation(projectId: Id, name: string | null): LocationResolution {
    if (!name?.trim())
      return {
        locationId: null,
        name: null,
        normalizedName: '',
        ambiguousIds: [],
        createdDraft: false,
      };
    const normalizedName = normalizeLocationName(name);
    if (!normalizedName)
      return { locationId: null, name, normalizedName: '', ambiguousIds: [], createdDraft: false };
    const rows = this.findLocations(projectId, normalizedName);
    if (rows.length === 1)
      return {
        locationId: rows[0]!.id,
        name: rows[0]!.name,
        normalizedName,
        ambiguousIds: [],
        createdDraft: false,
      };
    if (rows.length > 1)
      return {
        locationId: null,
        name,
        normalizedName,
        ambiguousIds: rows.map((row) => row.id),
        createdDraft: false,
      };
    const created = this.insertDraftLocation(projectId, name, normalizedName);
    return {
      locationId: created.id,
      name: created.name,
      normalizedName,
      ambiguousIds: [],
      createdDraft: true,
    };
  }

  getScenePlan(chapterId: Id): ScenePlanDto | null {
    const row = this.database.sqlite
      .prepare('SELECT id FROM scene_plan_revisions WHERE chapter_id=? AND is_current=1')
      .get(chapterId) as { id: Id } | undefined;
    return row ? this.getScenePlanById(row.id) : null;
  }

  getScenePlanById(planId: Id): ScenePlanDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT p.id,p.project_id as projectId,p.chapter_id as chapterId,p.chapter_revision as chapterRevision,
          p.revision,p.density,p.target_range as targetRange,p.style_revision_id as styleRevisionId,
          p.status,COUNT(s.id) as sceneCount,p.input_fingerprint as inputFingerprint,
          p.generation_id as generationId,p.created_at as createdAt,p.updated_at as updatedAt
         FROM scene_plan_revisions p
         LEFT JOIN scene_revisions s ON s.scene_plan_revision_id=p.id AND s.is_current=1
         WHERE p.id=? GROUP BY p.id`,
      )
      .get(planId) as ScenePlanRow | undefined;
    return row ? this.parsePlanRow(row) : null;
  }

  listScenes(chapterId: Id, limit = 100, offset = 0, includeExcerpt = false): SceneDto[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT s.id FROM scene_revisions s
         JOIN scene_plan_revisions p ON p.id=s.scene_plan_revision_id AND p.is_current=1
         WHERE s.chapter_id=? AND s.is_current=1
         ORDER BY s.scene_number LIMIT ? OFFSET ?`,
      )
      .all(chapterId, Math.max(1, Math.min(200, limit)), Math.max(0, offset)) as Array<{ id: Id }>;
    return rows.flatMap((row) => {
      const scene = this.getScene(row.id, includeExcerpt);
      return scene ? [scene] : [];
    });
  }
  listCurrentSceneIds(chapterId: Id | null, projectId?: Id, locationId?: Id): Id[] {
    const filters = ['s.is_current=1'];
    const parameters: string[] = [];
    if (chapterId) {
      filters.push('s.chapter_id=?');
      parameters.push(chapterId);
    }
    if (projectId) {
      filters.push('s.project_id=?');
      parameters.push(projectId);
    }
    if (locationId) {
      filters.push('s.location_id=?');
      parameters.push(locationId);
    }
    return (
      this.database.sqlite
        .prepare(
          `SELECT s.id FROM scene_revisions s JOIN scene_plan_revisions p
           ON p.id=s.scene_plan_revision_id AND p.is_current=1
           WHERE ${filters.join(' AND ')}`,
        )
        .all(...parameters) as Array<{ id: Id }>
    ).map((row) => row.id);
  }

  listProjectCurrentSceneIds(projectId: Id): Id[] {
    return this.listCurrentSceneIds(null, projectId);
  }

  listProjectSceneChapters(
    projectId: Id,
    limit = 25,
    offset = 0,
    status: SceneStatus | '' = '',
  ): Array<{
    chapterId: Id;
    chapterNumber: number;
    chapterTitle: string;
    chapterRevision: number;
    planRevision: number | null;
    planStatus: SceneStatus | null;
    sceneCount: number;
    stalePromptCount: number;
  }> {
    const statusClause = status ? ' AND p.status=?' : '';
    const rows = this.database.sqlite
      .prepare(
        `SELECT c.id as chapterId,c.number as chapterNumber,c.title as chapterTitle,c.revision as chapterRevision,
          p.revision as planRevision,p.status as planStatus,COUNT(s.id) as sceneCount,
          COALESCE(SUM(CASE WHEN s.prompt_status='STALE' THEN 1 ELSE 0 END),0) as stalePromptCount
         FROM chapters c
         LEFT JOIN scene_plan_revisions p ON p.chapter_id=c.id AND p.is_current=1
         LEFT JOIN scene_revisions s ON s.scene_plan_revision_id=p.id AND s.is_current=1
         WHERE c.project_id=?${statusClause}
         GROUP BY c.id,p.id ORDER BY c.number LIMIT ? OFFSET ?`,
      )
      .all(
        projectId,
        ...(status ? [status] : []),
        Math.max(1, Math.min(100, limit)),
        Math.max(0, offset),
      ) as Array<{
      chapterId: Id;
      chapterNumber: number;
      chapterTitle: string;
      chapterRevision: number;
      planRevision: number | null;
      planStatus: string | null;
      sceneCount: number;
      stalePromptCount: number;
    }>;
    return rows.map((row) => ({
      ...row,
      planStatus: row.planStatus ? sceneStatusSchema.parse(row.planStatus) : null,
    }));
  }
  getScene(sceneId: Id, includeExcerpt = false): SceneDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT s.id,s.stable_id as stableId,s.scene_plan_revision_id as planRevisionId,s.project_id as projectId,
          s.chapter_id as chapterId,s.chapter_revision as chapterRevision,p.revision as planRevision,
          s.scene_number as sceneNumber,s.revision,s.title,s.summary,s.purpose,
          s.source_start_offset as sourceStartOffset,s.source_end_offset as sourceEndOffset,
          s.location_id as locationId,s.location_name_snapshot as locationNameSnapshot,s.time_of_day as timeOfDay,
          s.weather,s.mood,s.visual_description as visualDescription,s.camera,s.composition,
          s.important_objects as importantObjects,s.lighting,s.color_mood as colorMood,s.image_prompt as imagePrompt,
          s.negative_prompt as negativePrompt,s.continuity_notes as continuityNotes,
          s.unresolved_references as unresolvedReferences,s.status,s.prompt_status as promptStatus,
          s.style_revision_id as styleRevisionId,s.input_fingerprint as inputFingerprint,
          s.prompt_version as promptVersion,s.schema_version as schemaVersion,s.generation_id as generationId,
          s.created_at as createdAt,s.updated_at as updatedAt,s.source_content as sourceContent
         FROM scene_revisions s
         JOIN scene_plan_revisions p ON p.id=s.scene_plan_revision_id AND p.is_current=1
         JOIN chapters c ON c.id=s.chapter_id
         WHERE s.id=? AND s.is_current=1`,
      )
      .get(sceneId) as SceneRow | undefined;
    if (!row) return null;
    const characterRows = this.database.sqlite
      .prepare(
        `SELECT character_id as characterId,display_name as displayName,resolution_status as resolutionStatus,
          role_in_scene as roleInScene,visual_state as visualState
         FROM scene_characters WHERE scene_revision_id=? ORDER BY id`,
      )
      .all(sceneId) as SceneCharacterRow[];
    const characterValues = characterRows.map((character) => ({
      characterId: character.characterId,
      displayName: character.displayName,
      roleInScene: character.roleInScene,
      visualState: sceneCharacterVisualStateSchema.parse(parseJson(character.visualState)),
    }));
    const characters: SceneCharacterDto[] = characterRows.map((character, index) => ({
      ...characterValues[index]!,
      resolutionStatus: sceneCharacterResolutionStatusSchema.parse(character.resolutionStatus),
    }));
    const item = scenePlanItemSchema.parse({
      sceneNumber: row.sceneNumber,
      title: row.title,
      summary: row.summary,
      purpose: scenePurposeSchema.parse(row.purpose),
      sourceRange: sceneSourceRangeSchema.parse({
        start: row.sourceStartOffset,
        end: row.sourceEndOffset,
      }),
      location: row.locationNameSnapshot,
      timeOfDay: row.timeOfDay,
      weather: row.weather,
      mood: row.mood,
      characters: characterValues,
      importantObjects: sceneStringArraySchema.parse(parseJson(row.importantObjects)),
      visualDescription: row.visualDescription,
      camera: sceneCameraSchema.parse(parseJson(row.camera)),
      composition: sceneCompositionSchema.parse(parseJson(row.composition)),
      lighting: row.lighting,
      colorMood: row.colorMood,
      imagePrompt: row.imagePrompt,
      negativePrompt: row.negativePrompt,
      continuityNotes: row.continuityNotes,
    });
    return {
      ...item,
      id: row.id,
      stableId: row.stableId,
      scenePlanRevisionId: row.planRevisionId,
      projectId: row.projectId,
      chapterId: row.chapterId,
      chapterRevision: row.chapterRevision,
      planRevision: row.planRevision,
      revision: row.revision,
      characters,
      locationId: row.locationId,
      styleRevisionId: row.styleRevisionId,
      status: sceneStatusSchema.parse(row.status),
      promptStatus: scenePromptStatusSchema.parse(row.promptStatus),
      unresolvedReferences: sceneStringArraySchema.parse(parseJson(row.unresolvedReferences)),
      ...(includeExcerpt
        ? {
            sourceExcerpt: row.sourceContent
              .slice(row.sourceStartOffset, row.sourceEndOffset)
              .slice(0, 8_000),
          }
        : {}),
      generationId: row.generationId,
      inputFingerprint: row.inputFingerprint,
      promptVersion: row.promptVersion,
      schemaVersion: row.schemaVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  saveGeneratedPlan(input: ScenePlanPersistenceInput): ScenePlanDto {
    sceneCountRangeSchema.nullable().parse(input.targetRange);
    this.validateSourceRanges(
      input.chapterId,
      input.scenes.map((scene) => scene.sourceRange),
    );
    const stamp = now();
    const planId = randomUUID();
    const revisionRow = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0)+1 as revision FROM scene_plan_revisions WHERE chapter_id=?',
      )
      .get(input.chapterId) as { revision: number };
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE scene_plan_revisions SET is_current=0,status='STALE',updated_at=? WHERE chapter_id=? AND is_current=1",
        )
        .run(stamp, input.chapterId);
      this.database.sqlite
        .prepare(
          "UPDATE scene_revisions SET is_current=0,status='STALE',prompt_status='STALE',updated_at=? WHERE chapter_id=? AND is_current=1",
        )
        .run(stamp, input.chapterId);
      this.database.sqlite
        .prepare(
          `INSERT INTO scene_plan_revisions(
            id,project_id,chapter_id,chapter_revision,revision,density,target_range,style_revision_id,
            input_fingerprint,generation_id,metadata,status,is_current,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'CURRENT',1,?,?)`,
        )
        .run(
          planId,
          input.projectId,
          input.chapterId,
          input.chapterRevision,
          revisionRow.revision,
          input.density,
          input.targetRange ? json(input.targetRange) : null,
          input.styleRevisionId,
          input.inputFingerprint,
          input.generationId,
          json(input.metadata),
          stamp,
          stamp,
        );
      for (const scene of input.scenes) {
        this.insertSceneRevisionInTransaction({
          projectId: input.projectId,
          chapterId: input.chapterId,
          chapterRevision: input.chapterRevision,
          sceneStableId: scene.stableId ?? randomUUID(),
          scenePlanRevisionId: planId,
          styleRevisionId: input.styleRevisionId,
          generationId: input.generationId,
          sceneNumber: scene.sceneNumber,
          revision: 1,
          scene,
        });
      }
      this.completeGenerationInTransaction(input.generationId, input.metadata, input.usage);
    })();
    return this.getScenePlanById(planId)!;
  }

  saveRegeneratedScene(input: SceneRevisionPersistenceInput): SceneDto {
    const current = this.getScene(input.sceneId);
    if (!current || current.projectId !== input.projectId || current.chapterId !== input.chapterId)
      throw new Error('Scene not found');
    const currentPlanId = this.getScenePlanRevisionId(current.id);
    if (this.getScenePlanById(currentPlanId)?.status !== 'CURRENT')
      throw new Error('Scene plan is stale');
    if (currentPlanId !== input.scenePlanRevisionId) throw new Error('Scene plan is stale');
    if (current.status !== 'CURRENT') throw new Error('Scene is stale');
    if (current.chapterRevision !== input.chapterRevision)
      throw new Error('Chapter revision is stale');
    this.validateSourceRanges(input.chapterId, [input.sourceRange], current.id);
    const stamp = now();
    const nextId = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('UPDATE scene_revisions SET is_current=0,updated_at=? WHERE id=? AND is_current=1')
        .run(stamp, current.id);
      const id = this.insertSceneRevisionInTransaction({
        projectId: input.projectId,
        chapterId: input.chapterId,
        chapterRevision: input.chapterRevision,
        sceneStableId: current.stableId,
        scenePlanRevisionId: input.scenePlanRevisionId,
        styleRevisionId: input.styleRevisionId,
        generationId: input.generationId,
        sceneNumber: input.sceneNumber,
        scene: { ...input, sourceContent: this.getSceneSourceContent(current.id) },
        revision: current.revision + 1,
      });
      this.completeGenerationInTransaction(input.generationId, input.metadata, input.usage);
      return id;
    })();
    return this.getScene(nextId)!;
  }
  savePromptRefresh(input: ScenePromptPersistenceInput): SceneDto {
    const current = this.getScene(input.sceneId);
    if (!current) throw new Error('Scene not found');
    const planId = this.getScenePlanRevisionId(current.id);
    if (this.getScenePlanById(planId)?.status !== 'CURRENT') throw new Error('Scene plan is stale');
    if (current.status !== 'CURRENT') throw new Error('Scene is stale');

    const stamp = now();
    const nextId = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('UPDATE scene_revisions SET is_current=0,updated_at=? WHERE id=? AND is_current=1')
        .run(stamp, current.id);
      const scene = this.scenePersistenceFromDto(current);
      scene.imagePrompt = input.imagePrompt;
      scene.negativePrompt = input.negativePrompt;
      scene.styleRevisionId = input.styleRevisionId;
      scene.inputFingerprint = input.inputFingerprint;
      scene.promptVersion = input.promptVersion;
      scene.schemaVersion = input.schemaVersion;
      scene.status = 'CURRENT';
      scene.promptStatus = 'CURRENT';
      const id = this.insertSceneRevisionInTransaction({
        projectId: current.projectId,
        chapterId: current.chapterId,
        chapterRevision: current.chapterRevision,
        sceneStableId: current.stableId,
        scenePlanRevisionId: this.getScenePlanRevisionId(current.id),
        styleRevisionId: input.styleRevisionId,
        generationId: input.generationId,
        sceneNumber: current.sceneNumber,
        revision: current.revision + 1,
        scene,
      });
      this.completeGenerationInTransaction(input.generationId, input.metadata, input.usage);
      return id;
    })();
    return this.getScene(nextId)!;
  }

  updateScene(sceneId: Id, input: SceneEdit): SceneDto {
    const edit = sceneEditSchema.parse(input);
    const current = this.getScene(sceneId);
    if (!current) throw new Error('Scene not found');
    const { expectedRevision, ...changes } = edit;
    if (expectedRevision !== current.revision) throw new Error('Revision conflict');
    const currentItem = this.sceneItemFromDto(current);
    const merged = scenePlanItemSchema.parse({ ...currentItem, ...changes });
    const location = this.resolveLocation(current.projectId, merged.location);
    if (location.ambiguousIds.length) throw new Error('Location match is ambiguous');
    const unresolvedReferences = current.unresolvedReferences.filter(
      (reference) => !reference.startsWith('location:'),
    );
    if (location.createdDraft && merged.location)
      unresolvedReferences.push(`location:${merged.location}`);
    const visualFields = [
      'title',
      'summary',
      'purpose',
      'location',
      'timeOfDay',
      'weather',
      'mood',
      'visualDescription',
      'camera',
      'composition',
      'lighting',
      'colorMood',
      'negativePrompt',
      'continuityNotes',
    ];
    const visualChanged = Object.keys(changes).some((key) => visualFields.includes(key));
    const sceneStatus = current.status;
    const scene: ScenePersistenceInput = {
      ...merged,
      locationId: location.locationId,
      sourceContent: this.getSceneSourceContent(current.id),
      unresolvedReferences,
      styleRevisionId: current.styleRevisionId,
      inputFingerprint: this.fingerprint({ operation: 'MANUAL_SCENE_EDIT', sceneId, edit }),
      promptVersion: 'manual-scene-v1',
      schemaVersion: current.schemaVersion,
      status: sceneStatus,
      promptStatus:
        sceneStatus !== 'CURRENT'
          ? 'STALE'
          : changes.imagePrompt !== undefined || !visualChanged
            ? 'CURRENT'
            : 'STALE',
      characters: current.characters.map((character) => ({
        characterId: character.characterId,
        displayName: character.displayName,
        roleInScene: character.roleInScene,
        visualState: character.visualState,
        resolutionStatus: character.resolutionStatus,
        dependencyFingerprint: null,
      })),
    };
    const stamp = now();
    const nextId = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('UPDATE scene_revisions SET is_current=0,updated_at=? WHERE id=? AND is_current=1')
        .run(stamp, current.id);
      return this.insertSceneRevisionInTransaction({
        projectId: current.projectId,
        chapterId: current.chapterId,
        chapterRevision: current.chapterRevision,
        sceneStableId: current.stableId,
        scenePlanRevisionId: this.getScenePlanRevisionId(current.id),
        styleRevisionId: current.styleRevisionId,
        generationId: null,
        sceneNumber: current.sceneNumber,
        revision: current.revision + 1,
        scene,
      });
    })();
    return this.getScene(nextId)!;
  }

  markChapterStale(chapterId: Id): void {
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE scene_plan_revisions SET status='STALE',updated_at=? WHERE chapter_id=? AND is_current=1",
        )
        .run(stamp, chapterId);
      this.database.sqlite
        .prepare(
          "UPDATE scene_revisions SET status='STALE',prompt_status='STALE',updated_at=? WHERE chapter_id=? AND is_current=1",
        )
        .run(stamp, chapterId);
    })();
  }

  markProjectStale(projectId: Id): void {
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE scene_plan_revisions SET status='STALE',updated_at=? WHERE project_id=? AND is_current=1",
        )
        .run(stamp, projectId);
      this.database.sqlite
        .prepare(
          "UPDATE scene_revisions SET status='STALE',prompt_status='STALE',updated_at=? WHERE project_id=? AND is_current=1",
        )
        .run(stamp, projectId);
    })();
  }

  markProjectPromptsStale(projectId: Id): void {
    this.database.sqlite
      .prepare(
        "UPDATE scene_revisions SET prompt_status='STALE',updated_at=? WHERE project_id=? AND is_current=1 AND status='CURRENT'",
      )
      .run(now(), projectId);
  }

  markLocationPromptsStale(projectId: Id, locationId: Id): void {
    this.database.sqlite
      .prepare(
        "UPDATE scene_revisions SET prompt_status='STALE',updated_at=? WHERE project_id=? AND location_id=? AND is_current=1 AND status='CURRENT'",
      )
      .run(now(), projectId, locationId);
  }

  markCharacterPromptsStale(projectId: Id, characterId: string): void {
    this.database.sqlite
      .prepare(
        `UPDATE scene_revisions SET prompt_status='STALE',updated_at=?
         WHERE project_id=? AND is_current=1 AND status='CURRENT' AND id IN (
           SELECT scene_revision_id FROM scene_characters WHERE character_id=?
         )`,
      )
      .run(now(), projectId, characterId);
  }

  getCompletedPlanForWorkflow(
    projectId: Id,
    chapterId: Id,
    workflowStepId: Id,
    inputFingerprint?: string,
  ): ScenePlanDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT p.id FROM scene_plan_revisions p
         JOIN story_generation_records g ON g.id=p.generation_id
         WHERE p.project_id=? AND p.chapter_id=? AND g.operation='SCENE_PLANNING'
           AND g.workflow_step_id=? AND g.status='COMPLETED'
           AND (? IS NULL OR g.input_fingerprint=?)
         ORDER BY p.created_at DESC LIMIT 1`,
      )
      .get(
        projectId,
        chapterId,
        workflowStepId,
        inputFingerprint ?? null,
        inputFingerprint ?? null,
      ) as { id: Id } | undefined;
    return row ? this.getScenePlanById(row.id) : null;
  }

  getCompletedSceneForWorkflow(
    projectId: Id,
    sceneId: Id,
    workflowStepId: Id,
    inputFingerprint?: string,
  ): SceneDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT s.id FROM scene_revisions s
         JOIN story_generation_records g ON g.id=s.generation_id
         WHERE s.project_id=? AND g.operation='SCENE_REGENERATION' AND g.workflow_step_id=?
           AND g.target_id=? AND g.status='COMPLETED'
           AND (? IS NULL OR g.input_fingerprint=?)
         ORDER BY s.created_at DESC LIMIT 1`,
      )
      .get(
        projectId,
        workflowStepId,
        sceneId,
        inputFingerprint ?? null,
        inputFingerprint ?? null,
      ) as { id: Id } | undefined;
    return row ? this.getScene(row.id) : null;
  }

  getCompletedPromptForWorkflow(
    projectId: Id,
    sceneId: Id,
    workflowStepId: Id,
    inputFingerprint?: string,
  ): SceneDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT s.id FROM scene_revisions s
         JOIN story_generation_records g ON g.id=s.generation_id
         WHERE s.project_id=? AND g.operation='SCENE_PROMPT' AND g.workflow_step_id=?
           AND g.target_id=? AND g.status='COMPLETED'
           AND (? IS NULL OR g.input_fingerprint=?)
         ORDER BY s.created_at DESC LIMIT 1`,
      )
      .get(
        projectId,
        workflowStepId,
        sceneId,
        inputFingerprint ?? null,
        inputFingerprint ?? null,
      ) as { id: Id } | undefined;
    return row ? this.getScene(row.id) : null;
  }

  private validateSourceRanges(
    chapterId: Id,
    ranges: SceneSourceRange[],
    excludeSceneId?: Id,
  ): void {
    const chapter = this.database.sqlite
      .prepare('SELECT content FROM chapters WHERE id=?')
      .get(chapterId) as { content: string } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    const normalized = ranges
      .map((range) => sceneSourceRangeSchema.parse(range))
      .sort((left, right) => left.start - right.start || left.end - right.end);
    for (const range of normalized) {
      if (range.end > chapter.content.length)
        throw new Error('Scene source range is outside the chapter text');
    }
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index - 1]!.end > normalized[index]!.start)
        throw new Error('Scene source ranges must not overlap');
    }
    if (!excludeSceneId) return;
    const existing = this.database.sqlite
      .prepare(
        `SELECT source_start_offset as start,source_end_offset as end FROM scene_revisions
         WHERE chapter_id=? AND is_current=1 AND id<>?`,
      )
      .all(chapterId, excludeSceneId) as SceneSourceRange[];
    for (const range of existing) {
      if (
        normalized.some((candidate) => candidate.start < range.end && range.start < candidate.end)
      )
        throw new Error('Scene source ranges must not overlap');
    }
  }

  private parseLocationRow(row: LocationRow): LocationDto {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      normalizedName: row.normalizedName,
      description: row.description,
      type: row.type,
      visualDescription: row.visualDescription,
      environment: row.environment,
      architecture: row.architecture,
      importantObjects: sceneStringArraySchema.parse(parseJson(row.importantObjects)),
      lightingDefaults: row.lightingDefaults,
      status: locationStatusSchema.parse(row.status),
      rowVersion: row.rowVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private parsePlanRow(row: ScenePlanRow): ScenePlanDto {
    return {
      id: row.id,
      projectId: row.projectId,
      chapterId: row.chapterId,
      chapterRevision: row.chapterRevision,
      revision: row.revision,
      density: sceneDensitySchema.parse(row.density),
      targetRange: row.targetRange ? sceneCountRangeSchema.parse(parseJson(row.targetRange)) : null,
      styleRevisionId: row.styleRevisionId,
      styleRevision: row.styleRevisionId
        ? ((
            this.database.sqlite
              .prepare('SELECT revision FROM visual_style_settings WHERE id=?')
              .get(row.styleRevisionId) as { revision: number } | undefined
          )?.revision ?? null)
        : null,
      status: sceneStatusSchema.parse(row.status),
      sceneCount: row.sceneCount,
      inputFingerprint: row.inputFingerprint,
      generationId: row.generationId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private findLocations(projectId: Id, normalizedName: string): Array<{ id: Id; name: string }> {
    return this.database.sqlite
      .prepare('SELECT id,name FROM locations WHERE project_id=? AND normalized_name=? ORDER BY id')
      .all(projectId, normalizedName) as Array<{ id: Id; name: string }>;
  }

  private insertDraftLocation(
    projectId: Id,
    name: string,
    normalizedName: string,
  ): { id: Id; name: string } {
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO locations(id,project_id,name,normalized_name,description,type,visual_description,
          environment,architecture,important_objects,lighting_defaults,status,row_version,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,'DRAFT',1,?,?)`,
      )
      .run(id, projectId, name.trim(), normalizedName, '', '', '', '', '', '[]', '', stamp, stamp);
    return { id, name: name.trim() };
  }
  private getChapterSourceContent(chapterId: Id): string {
    const row = this.database.sqlite
      .prepare('SELECT content FROM chapters WHERE id=?')
      .get(chapterId) as { content: string } | undefined;
    if (!row) throw new Error('Chapter not found');
    return row.content;
  }

  private getSceneSourceContent(sceneId: Id): string {
    const row = this.database.sqlite
      .prepare('SELECT source_content as sourceContent FROM scene_revisions WHERE id=?')
      .get(sceneId) as { sourceContent: string } | undefined;
    if (!row) throw new Error('Scene source snapshot not found');
    return row.sourceContent;
  }

  private getScenePlanRevisionId(sceneId: Id): Id {
    const row = this.database.sqlite
      .prepare('SELECT scene_plan_revision_id as planRevisionId FROM scene_revisions WHERE id=?')
      .get(sceneId) as { planRevisionId: Id } | undefined;
    if (!row) throw new Error('Scene plan not found');
    return row.planRevisionId;
  }

  private insertSceneRevisionInTransaction(input: SceneInsertInput): Id {
    const sceneId = randomUUID();
    const item = scenePlanItemSchema.parse({
      sceneNumber: input.sceneNumber,
      title: input.scene.title,
      summary: input.scene.summary,
      purpose: input.scene.purpose,
      sourceRange: input.scene.sourceRange,
      location: input.scene.location,
      timeOfDay: input.scene.timeOfDay,
      weather: input.scene.weather,
      mood: input.scene.mood,
      characters: input.scene.characters.map(
        ({ characterId, displayName, roleInScene, visualState }) => ({
          characterId,
          displayName,
          roleInScene,
          visualState,
        }),
      ),
      importantObjects: input.scene.importantObjects,
      visualDescription: input.scene.visualDescription,
      camera: input.scene.camera,
      composition: input.scene.composition,
      lighting: input.scene.lighting,
      colorMood: input.scene.colorMood,
      imagePrompt: input.scene.imagePrompt,
      negativePrompt: input.scene.negativePrompt,
      continuityNotes: input.scene.continuityNotes,
    });
    const sourceRange = sceneSourceRangeSchema.parse(item.sourceRange);
    const camera = sceneCameraSchema.parse(item.camera);
    const composition = sceneCompositionSchema.parse(item.composition);
    const status = sceneStatusSchema.parse(input.scene.status ?? 'CURRENT');
    const promptStatus = scenePromptStatusSchema.parse(
      input.scene.promptStatus ?? (item.imagePrompt ? 'CURRENT' : 'MISSING'),
    );
    const stamp = now();
    const sourceContent =
      input.scene.sourceContent ?? this.getChapterSourceContent(input.chapterId);
    this.database.sqlite
      .prepare(
        `INSERT INTO scene_revisions(
          id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,source_content,scene_number,revision,
          title,summary,purpose,source_start_offset,source_end_offset,location_id,location_name_snapshot,
          time_of_day,weather,mood,visual_description,camera,composition,important_objects,lighting,color_mood,
          image_prompt,negative_prompt,continuity_notes,unresolved_references,status,prompt_status,style_revision_id,
          input_fingerprint,prompt_version,schema_version,generation_id,is_current,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      )
      .run(
        sceneId,
        input.sceneStableId,
        input.scenePlanRevisionId,
        input.projectId,
        input.chapterId,
        input.chapterRevision,
        sourceContent,
        item.sceneNumber,
        input.revision,
        item.title,
        item.summary,
        item.purpose,
        sourceRange.start,
        sourceRange.end,
        input.scene.locationId,
        item.location,
        item.timeOfDay,
        item.weather,
        item.mood,
        item.visualDescription,
        json(camera),
        json(composition),
        json(item.importantObjects),
        item.lighting,
        item.colorMood,
        item.imagePrompt,
        item.negativePrompt,
        item.continuityNotes,
        json(input.scene.unresolvedReferences),
        status,
        promptStatus,
        input.styleRevisionId,
        input.scene.inputFingerprint,
        input.scene.promptVersion,
        input.scene.schemaVersion,
        input.generationId,
        stamp,
        stamp,
      );
    for (const character of input.scene.characters) {
      this.database.sqlite
        .prepare(
          `INSERT INTO scene_characters(
            id,scene_revision_id,character_id,display_name,resolution_status,role_in_scene,visual_state,
            dependency_fingerprint,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          randomUUID(),
          sceneId,
          character.characterId,
          character.displayName,
          sceneCharacterResolutionStatusSchema.parse(character.resolutionStatus),
          character.roleInScene,
          json(character.visualState),
          character.dependencyFingerprint,
          stamp,
        );
    }
    return sceneId;
  }

  private completeGenerationInTransaction(
    generationId: Id,
    metadata: GenerationMetadata,
    usage?: Omit<AiUsage, 'id' | 'createdAt'>,
  ): void {
    const result = this.database.sqlite
      .prepare(
        "UPDATE story_generation_records SET status='COMPLETED',metadata=?,error=NULL,completed_at=? WHERE id=?",
      )
      .run(json(metadata), now(), generationId);
    if (result.changes !== 1) throw new Error('Generation record not found');
    if (!usage) return;
    const value = aiUsageSchema.parse({ id: randomUUID(), createdAt: now(), ...usage });
    this.database.sqlite
      .prepare(
        `INSERT INTO ai_usage(
          id,project_id,operation,entity_id,attempt,provider,model,input_tokens,output_tokens,
          duration_ms,cost_usd,currency,status,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        value.id,
        value.projectId,
        value.operation,
        value.entityId,
        value.attempt,
        value.provider,
        value.model,
        value.inputTokens,
        value.outputTokens,
        value.durationMs,
        value.costUsd,
        value.currency,
        value.status,
        value.createdAt,
      );
  }

  private markProjectPromptsStaleInTransaction(projectId: Id, stamp: string): void {
    this.database.sqlite
      .prepare(
        "UPDATE scene_revisions SET prompt_status='STALE',updated_at=? WHERE project_id=? AND is_current=1 AND status='CURRENT'",
      )
      .run(stamp, projectId);
  }

  private locationPayload(location: LocationDto): Location {
    return locationSchema.parse({
      name: location.name,
      description: location.description,
      type: location.type,
      visualDescription: location.visualDescription,
      environment: location.environment,
      architecture: location.architecture,
      importantObjects: location.importantObjects,
      lightingDefaults: location.lightingDefaults,
      status: location.status,
    });
  }

  private sceneItemFromDto(scene: SceneDto): ScenePlanItem {
    return scenePlanItemSchema.parse({
      sceneNumber: scene.sceneNumber,
      title: scene.title,
      summary: scene.summary,
      purpose: scene.purpose,
      sourceRange: scene.sourceRange,
      location: scene.location,
      timeOfDay: scene.timeOfDay,
      weather: scene.weather,
      mood: scene.mood,
      characters: scene.characters.map(
        ({ characterId, displayName, roleInScene, visualState }) => ({
          characterId,
          displayName,
          roleInScene,
          visualState,
        }),
      ),
      importantObjects: scene.importantObjects,
      visualDescription: scene.visualDescription,
      camera: scene.camera,
      composition: scene.composition,
      lighting: scene.lighting,
      colorMood: scene.colorMood,
      imagePrompt: scene.imagePrompt,
      negativePrompt: scene.negativePrompt,
      continuityNotes: scene.continuityNotes,
    });
  }

  private scenePersistenceFromDto(scene: SceneDto): ScenePersistenceInput {
    return {
      ...this.sceneItemFromDto(scene),
      stableId: scene.stableId,
      sourceContent: this.getSceneSourceContent(scene.id),
      locationId: scene.locationId,
      unresolvedReferences: scene.unresolvedReferences,
      styleRevisionId: scene.styleRevisionId,
      inputFingerprint: scene.inputFingerprint,
      promptVersion: scene.promptVersion,
      schemaVersion: scene.schemaVersion,
      status: scene.status,
      promptStatus: scene.promptStatus,
      characters: scene.characters.map((character) => ({
        characterId: character.characterId,
        displayName: character.displayName,
        roleInScene: character.roleInScene,
        visualState: character.visualState,
        resolutionStatus: character.resolutionStatus,
        dependencyFingerprint: null,
      })),
    };
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
