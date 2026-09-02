import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  AssetRepository,
  ChapterRepository,
  ProjectRepository,
  StoryBatchRepository,
  StoryRepository,
  SceneRepository,
  SceneObjectResolutionRepository,
  VisualProfileRepository,
  VisualPromptPackageRepository,
  WorkflowRepository,
  type ClaimedStep,
  type ChapterStatusFilter,
  type DatabaseHandle,
} from '@studio/database';
import {
  FfmpegTools,
  ProcessRunner,
  buildChapterVideoArguments,
  buildConcatArguments,
  buildProjectVideoArguments,
  buildRenderArguments,
  buildSceneClipArguments,
  promoteManagedFile,
  safeWorkspacePath,
  type WorkspacePaths,
  initializeWorkspace,
  promoteFile,
  relativeAssetPath,
  sha256File,
  validateHierarchicalVideo,
} from '@studio/media';
import {
  AppError,
  locationSchema,
  locationUpdateSchema,
  sceneBatchRequestSchema,
  sceneEditSchema,
  sceneGenerationRequestSchema,
  motionPlanUpdateSchema,
  sceneTimingUpdateSchema,
  scenePromptRequestSchema,
  sceneRegenerationRequestSchema,
  visualProfileGenerateRequestSchema,
  visualObjectKeySchema,
  visualPromptRefinementRequestSchema,
  storyArcSchema,
  storyGenerationBatchRequestSchema,
  storyPlanWindowResultSchema,
  type ChapterDto,
  type ChapterInput,
  type Id,
  type JobDto,
  type ProjectDto,
  type ProjectInput,
  type RenderPlan,
  type RenderRequest,
  type SceneDto,
  type SceneStatus,
  type StatusSummary,
  type StoryArc,
  type StoryGenerationBatch,
  type StoryGenerationBatchItem,
  type StoryGenerationBatchRequest,
  type StoryPlanWindowResult,
  type VisualProfileGenerationKind,
  type WorkflowStatus,
  type SceneTimingUpdate,
  renderConfigSchema,
} from '@studio/shared';
import { segmentNarrationText, serializeSrt, subtitlesFromSegments } from './text.js';
import {
  buildChapterGenerationContextV2,
  planWindowBoundary,
  renderChapterGenerationPrompt,
  renderSummaryGenerationPrompt,
  type StoryEngine,
} from './story-engine.js';
import { buildSceneGenerationContext, buildSceneRegenerationContext } from './scene-context.js';
import type { AiAgentProgress } from './omp-agent.js';
import { SceneEngine } from './scene-engine.js';
import { VisualConsistencyService, createVisualConsistencyService } from './visual-service.js';
import { ImageGenerationService, createImageGenerationService } from './image-service.js';
import { ComfyUiImageProvider, ImageProviderError } from './comfyui.js';
export {
  ComfyUiImageProvider,
  ImageGenerationService,
  ImageProviderError,
  SceneEngine,
  VisualConsistencyService,
  createImageGenerationService,
  createVisualConsistencyService,
};
import {
  renderArcPlanningPrompt,
  renderBlueprintPrompt,
  renderChapterGenerationV2Prompt,
  renderChapterPlanWindowPrompt,
  renderChapterPlansPrompt,
  renderSummaryCompactionPrompt,
  renderScenePlanningPrompt,
  renderScenePromptRefreshPrompt,
  renderSceneRegenerationPrompt,
} from './story-prompts.js';
import {
  projectVideoRole,
  renderChapterPayloadSchema,
  renderProjectPayloadSchema,
  renderSceneClipPayloadSchema,
  TimelineWorkflowService,
} from './timeline-workflow.js';
export {
  imageGenerationFingerprint,
  imageSettingsFingerprint,
  resolveImageSeed,
} from './image-generation.js';
export { projectVideoRole } from './timeline-workflow.js';
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
  readonly scenes: SceneRepository;
  readonly batches: StoryBatchRepository;
  readonly workflow: WorkflowRepository;
  readonly assets: AssetRepository;
  readonly visualProfiles: VisualProfileRepository;
  readonly sceneObjectResolutions: SceneObjectResolutionRepository;
  readonly visualPackages: VisualPromptPackageRepository;
  readonly visual: VisualConsistencyService;
  readonly images: ImageGenerationService;
  readonly timeline: TimelineWorkflowService;
  constructor(private readonly context: StudioContext) {
    this.projects = new ProjectRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.story = new StoryRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.batches = new StoryBatchRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.assets = new AssetRepository(context.database);
    this.visualProfiles = new VisualProfileRepository(context.database);
    this.sceneObjectResolutions = new SceneObjectResolutionRepository(context.database);
    this.visualPackages = new VisualPromptPackageRepository(context.database);
    this.visual = new VisualConsistencyService(
      this.scenes,
      this.chapters,
      this.story,
      this.visualProfiles,
      this.sceneObjectResolutions,
      this.visualPackages,
      this.assets,
    );
    this.images = createImageGenerationService(context);
    this.timeline = new TimelineWorkflowService(context);
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
  listChapterPage(
    projectId: Id,
    limit = 25,
    offset = 0,
    search = '',
    status: ChapterStatusFilter | '' = '',
  ): ChapterDto[] {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.chapters.listPage(projectId, limit, offset, search, status);
  }
  updateChapter(id: Id, input: ChapterInput): ChapterDto {
    const current = this.chapters.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const sceneChanged = input.content !== current.content || input.title !== current.title;
    const narrationChanged = input.content !== current.content;
    let chapter: ChapterDto;
    try {
      chapter = this.chapters.update(id, input);
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      throw error;
    }
    if (sceneChanged) {
      if (narrationChanged) this.invalidateChapterDescendants(chapter.projectId, chapter.id);
      this.scenes.markChapterStale(chapter.id);
      this.timeline.timeline.invalidateSceneTiming(chapter.id, 'Chapter content changed');
      this.invalidateSceneWorkflowForChapter(chapter.id);
      this.story.markManualContinuityReview(chapter.projectId, chapter.number);
    }
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
    const current = this.getRenderConfig(projectId);
    const next = renderConfigSchema.parse(input);
    this.projects.setRenderConfig(projectId, next);
    this.invalidateRender(projectId);
    if (JSON.stringify(current) !== JSON.stringify(next))
      this.timeline.invalidateRenderOutputs(projectId);
  }
  getScenePlan(projectId: Id, chapterId: Id) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    return this.scenes.getScenePlan(chapterId);
  }
  listSceneChapters(projectId: Id, limit = 25, offset = 0, status: SceneStatus | '' = '') {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.scenes.listProjectSceneChapters(projectId, limit, offset, status);
  }

  listScenes(projectId: Id, chapterId: Id, limit = 100, offset = 0, includeExcerpt = false) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    return this.scenes.listScenes(chapterId, limit, offset, includeExcerpt);
  }

  getScene(projectId: Id, sceneId: Id) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const scene = this.scenes.getScene(sceneId, true);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    return scene;
  }

  getSceneById(sceneId: Id) {
    const scene = this.scenes.getScene(sceneId, true);
    if (!scene) throw new AppError('NOT_FOUND', 'Scene not found', 404);
    return scene;
  }
  getVisualStyle(projectId: Id) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.visual.getStyleBible(projectId);
  }
  saveVisualStyle(projectId: Id, input: unknown) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const saved = this.visual.saveStyleBible(projectId, input);
    this.invalidateSceneVisualWorkflowForProject(projectId, 'Visual style changed');
    return saved;
  }

  listLocations(projectId: Id, limit = 100, offset = 0) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.scenes.listLocations(projectId, limit, offset);
  }
  createLocation(projectId: Id, input: unknown) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    try {
      return this.scenes.createLocation(projectId, locationSchema.parse(input));
    } catch (error) {
      if (error instanceof Error && error.message === 'Location name is invalid')
        throw new AppError('INVALID_INPUT', error.message, 400);
      if (
        error instanceof Error &&
        error.message === 'A location with the same normalized name already exists'
      )
        throw new AppError('LOCATION_CONFLICT', error.message, 409);
      throw error;
    }
  }

  updateLocation(projectId: Id, locationId: Id, input: unknown) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    try {
      const saved = this.scenes.updateLocation(
        projectId,
        locationId,
        locationUpdateSchema.parse(input),
      );
      const sceneIds = this.scenes.listCurrentSceneIds(null, projectId, locationId);
      this.workflow.invalidateEntities(
        sceneIds,
        [
          'REGENERATE_SCENE',
          'GENERATE_SCENE_PROMPT',
          'BUILD_VISUAL_PROMPT',
          'GENERATE_SCENE_IMAGE',
        ],
        'Location changed',
      );
      return saved;
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      if (error instanceof Error && error.message === 'Location name is invalid')
        throw new AppError('INVALID_INPUT', error.message, 400);
      if (
        error instanceof Error &&
        error.message === 'A location with the same normalized name already exists'
      )
        throw new AppError('LOCATION_CONFLICT', error.message, 409);
      throw error;
    }
  }

  updateScene(projectId: Id, sceneId: Id, input: unknown) {
    const scene = this.getScene(projectId, sceneId);
    try {
      const saved = this.scenes.updateScene(scene.id, sceneEditSchema.parse(input));
      this.workflow.invalidateEntities(
        [scene.id],
        [
          'REGENERATE_SCENE',
          'GENERATE_SCENE_PROMPT',
          'BUILD_VISUAL_PROMPT',
          'GENERATE_SCENE_IMAGE',
        ],
        'Scene changed',
      );
      return saved;
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      if (error instanceof Error && error.message === 'Location match is ambiguous')
        throw new AppError('LOCATION_AMBIGUOUS', error.message, 409);
      throw error;
    }
  }
  private assertSceneSchedulingCurrent(scene: SceneDto): void {
    const chapter = this.chapters.get(scene.chapterId);
    const plan = this.scenes.getScenePlan(scene.chapterId);
    if (
      !chapter ||
      chapter.revision !== scene.chapterRevision ||
      scene.status !== 'CURRENT' ||
      plan?.status !== 'CURRENT'
    )
      throw new AppError(
        'STALE_INPUT',
        'Scene plan is stale; generate a current scene plan before this operation',
        409,
      );
  }
  private invalidateSceneWorkflowForChapter(chapterId: Id): void {
    const error = 'Scene input changed';
    this.workflow.invalidateSteps(chapterId, ['GENERATE_SCENES'], error);
    const sceneIds = this.scenes.listCurrentSceneIds(chapterId);
    this.workflow.invalidateEntities(
      sceneIds,
      ['REGENERATE_SCENE', 'GENERATE_SCENE_PROMPT', 'BUILD_VISUAL_PROMPT', 'GENERATE_SCENE_IMAGE'],
      error,
    );
  }

  private invalidateSceneVisualWorkflowForProject(projectId: Id, error: string): void {
    const sceneIds = this.scenes.listProjectCurrentSceneIds(projectId);
    this.workflow.invalidateEntities(
      sceneIds,
      ['REGENERATE_SCENE', 'GENERATE_SCENE_PROMPT', 'BUILD_VISUAL_PROMPT', 'GENERATE_SCENE_IMAGE'],
      error,
    );
  }

  scheduleSceneGeneration(
    projectId: Id,
    chapterId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const request = sceneGenerationRequestSchema.parse(requestInput);
    if (
      request.expectedChapterRevision !== undefined &&
      request.expectedChapterRevision !== chapter.revision
    )
      throw new AppError('REVISION_CONFLICT', 'Chapter revision is stale', 409);
    const context = buildSceneGenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      chapterId,
      density: request.density,
      targetRange: request.targetRange,
      style: this.scenes.getVisualStyle(projectId),
    });
    const prompt = renderScenePlanningPrompt(
      context,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `scene-planning:${chapterId}:${chapter.revision}:${prompt.inputFingerprint}`,
      'GENERATE_SCENES',
      chapterId,
      prompt.inputFingerprint,
      3,
      request,
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('GENERATE_SCENES', chapterId, stepId),
    };
  }

  scheduleSceneRegeneration(
    projectId: Id,
    sceneId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    this.assertSceneSchedulingCurrent(scene);
    const request = sceneRegenerationRequestSchema.parse(requestInput);
    if (request.expectedRevision !== undefined && request.expectedRevision !== scene.revision)
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    const context = buildSceneRegenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      sceneId,
      style: this.scenes.getVisualStyle(projectId),
      instructions: request.instructions ? [request.instructions] : [],
    });
    const prompt = renderSceneRegenerationPrompt(
      context,
      scene,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `scene-regeneration:${sceneId}:${scene.revision}:${prompt.inputFingerprint}`,
      'REGENERATE_SCENE',
      sceneId,
      prompt.inputFingerprint,
      3,
      request,
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('REGENERATE_SCENE', sceneId, stepId),
    };
  }

  scheduleScenePromptRefresh(
    projectId: Id,
    sceneId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    this.assertSceneSchedulingCurrent(scene);
    const request = scenePromptRequestSchema.parse(requestInput);
    if (request.expectedRevision !== undefined && request.expectedRevision !== scene.revision)
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    const context = buildSceneRegenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      sceneId,
      style: this.scenes.getVisualStyle(projectId),
      instructions: request.instructions ? [request.instructions] : [],
    });
    const prompt = renderScenePromptRefreshPrompt(
      context,
      scene,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `scene-prompt:${sceneId}:${scene.revision}:${prompt.inputFingerprint}`,
      'GENERATE_SCENE_PROMPT',
      sceneId,
      prompt.inputFingerprint,
      3,
      request,
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('GENERATE_SCENE_PROMPT', sceneId, stepId),
    };
  }

  scheduleSceneBatch(
    projectId: Id,
    requestInput: unknown,
  ): { executionId: Id; jobIds: Id[]; skippedChapterIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const request = sceneBatchRequestSchema.parse(requestInput);
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const jobIds: Id[] = [];
    const skippedChapterIds: Id[] = [];
    for (const chapterId of request.chapterIds) {
      const chapter = this.chapters.get(chapterId);
      if (!chapter || chapter.projectId !== projectId)
        throw new AppError('NOT_FOUND', 'Chapter not found', 404);
      const currentPlan = this.scenes.getScenePlan(chapterId);
      if (request.onlyMissing && currentPlan?.status === 'CURRENT' && currentPlan.sceneCount > 0) {
        skippedChapterIds.push(chapterId);
        continue;
      }
      const context = buildSceneGenerationContext({
        story: this.story,
        chapters: this.chapters,
        scenes: this.scenes,
        projectId,
        chapterId,
        density: request.density,
        targetRange: request.targetRange,
        style: this.scenes.getVisualStyle(projectId),
      });
      const prompt = renderScenePlanningPrompt(
        context,
        this.story.getSettings(projectId)?.generation.model ?? null,
      );
      const stepId = this.workflow.createStep(
        executionId,
        `scene-planning:${chapterId}:${chapter.revision}:${prompt.inputFingerprint}`,
        'GENERATE_SCENES',
        chapterId,
        prompt.inputFingerprint,
        3,
        {
          density: request.density,
          targetRange: request.targetRange,
          expectedChapterRevision: chapter.revision,
        },
      );
      jobIds.push(this.workflow.createJob('GENERATE_SCENES', chapterId, stepId));
    }
    return { executionId, jobIds, skippedChapterIds };
  }
  scheduleVisualProfileGeneration(
    projectId: Id,
    kind: VisualProfileGenerationKind,
    subjectId: string,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    if (!['CHARACTER', 'LOCATION', 'OBJECT'].includes(kind))
      throw new AppError('INVALID_INPUT', 'Unknown visual profile kind', 400);
    const request = visualProfileGenerateRequestSchema.parse(requestInput);
    const visualSubjectId = kind === 'OBJECT' ? visualObjectKeySchema.parse(subjectId) : subjectId;
    if (
      kind === 'CHARACTER' &&
      !this.story
        .getBlueprint(projectId)
        ?.blueprint.characters.some((item) => item.id === visualSubjectId)
    )
      throw new AppError('NOT_FOUND', 'Story character not found', 404);
    if (kind === 'LOCATION' && !this.scenes.getLocation(projectId, visualSubjectId))
      throw new AppError('NOT_FOUND', 'Location not found', 404);
    if (kind === 'OBJECT' && !visualSubjectId)
      throw new AppError('INVALID_INPUT', 'Object key is required', 400);
    const settings = this.story.getSettings(projectId);
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const operation = `${kind}_VISUAL_PROFILE`;
    const stepType = `GENERATE_${operation}`;
    const stepId = this.workflow.createStep(
      executionId,
      `visual-profile:${kind.toLocaleLowerCase('en-US')}:${visualSubjectId}`,
      stepType,
      visualSubjectId,
      fingerprint({ operation, projectId, subjectId: visualSubjectId, request }),
      settings?.generation.maxRetries ?? 3,
      { projectId, kind, subjectId: visualSubjectId, instructions: request.instructions },
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob(stepType, visualSubjectId, stepId),
    };
  }

  scheduleVisualPromptBuild(
    projectId: Id,
    sceneId: Id,
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const inputFingerprint = fingerprint({
      operation: 'BUILD_VISUAL_PROMPT',
      projectId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
    });
    const stepId = this.workflow.createStep(
      executionId,
      `visual-prompt:${scene.id}:${scene.revision}`,
      'BUILD_VISUAL_PROMPT',
      scene.id,
      inputFingerprint,
      3,
      { projectId, sceneId: scene.id, sceneRevision: scene.revision },
    );
    return {
      executionId,
      jobId: this.workflow.createJob('BUILD_VISUAL_PROMPT', scene.id, stepId),
      stepId,
    };
  }
  scheduleVisualPromptBatch(
    projectId: Id,
    chapterId: Id,
    limit = 200,
    offset = 0,
  ): { executionId: Id; jobIds: Id[]; stepIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const scenes = this.scenes.listScenes(
      chapterId,
      Math.min(200, Math.max(1, limit)),
      Math.max(0, offset),
    );
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const jobIds: Id[] = [];
    const stepIds: Id[] = [];
    for (const scene of scenes) {
      const inputFingerprint = fingerprint({
        operation: 'BUILD_VISUAL_PROMPT',
        projectId,
        sceneId: scene.id,
        sceneRevision: scene.revision,
      });
      const stepId = this.workflow.createStep(
        executionId,
        `visual-prompt:${scene.id}:${scene.revision}`,
        'BUILD_VISUAL_PROMPT',
        scene.id,
        inputFingerprint,
        3,
        { projectId, sceneId: scene.id, sceneRevision: scene.revision },
      );
      stepIds.push(stepId);
      jobIds.push(this.workflow.createJob('BUILD_VISUAL_PROMPT', scene.id, stepId));
    }
    return { executionId, jobIds, stepIds };
  }

  scheduleVisualPromptRefinement(
    projectId: Id,
    packageId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const request = visualPromptRefinementRequestSchema.parse(requestInput);
    const packageDto = this.visualPackages.get(projectId, packageId);
    if (!packageDto) throw new AppError('NOT_FOUND', 'Visual prompt package not found', 404);
    if (packageDto.status !== 'CURRENT')
      throw new AppError('STALE_INPUT', 'Visual prompt package is stale', 409);
    if (
      request.expectedPackageRevision !== undefined &&
      request.expectedPackageRevision !== packageDto.revision
    )
      throw new AppError('REVISION_CONFLICT', 'Visual prompt package revision is stale', 409);
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const inputFingerprint = fingerprint({
      operation: 'VISUAL_PROMPT_REFINEMENT',
      projectId,
      packageId,
      packageRevision: packageDto.revision,
      instructions: request.instructions,
    });
    const stepId = this.workflow.createStep(
      executionId,
      `visual-prompt-refinement:${packageId}:${packageDto.revision}`,
      'REFINE_VISUAL_PROMPT',
      packageId,
      inputFingerprint,
      3,
      { projectId, packageId, request },
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('REFINE_VISUAL_PROMPT', packageId, stepId),
    };
  }

  scheduleStoryBlueprint(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-blueprint:${projectId}`,
      'GENERATE_STORY_BLUEPRINT',
      projectId,
      renderBlueprintPrompt(settings).inputFingerprint,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_STORY_BLUEPRINT', projectId, stepId),
    };
  }
  scheduleStoryPlans(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const blueprint = this.story.getBlueprint(projectId);
    const settings = this.story.getSettings(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    if (settings.targetChapterCount > 20)
      throw new AppError(
        'INVALID_PLAN',
        'Stories over 20 chapters require arcs and bounded planning windows',
        422,
      );
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-plans:${projectId}:${blueprint.revision}`,
      'GENERATE_CHAPTER_PLANS',
      projectId,
      renderChapterPlansPrompt(settings, blueprint.blueprint).inputFingerprint,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_PLANS', projectId, stepId),
    };
  }
  scheduleStoryStages(projectId: Id): { executionId: Id; jobIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const blueprintStep = this.workflow.createStep(
      executionId,
      `story-blueprint:${projectId}`,
      'GENERATE_STORY_BLUEPRINT',
      projectId,
      renderBlueprintPrompt(settings).inputFingerprint,
    );
    const longStory = settings.targetChapterCount > 20;
    const planningType = longStory ? 'GENERATE_STORY_ARCS' : 'GENERATE_CHAPTER_PLANS';
    const planningStep = this.workflow.createStep(
      executionId,
      longStory ? `story-arcs:${projectId}` : `story-plans:${projectId}`,
      planningType,
      projectId,
      fingerprint({
        operation: longStory ? 'ARC_PLANNING_DEFERRED' : 'CHAPTER_PLANS_DEFERRED',
        settingsRevision: settings.revision,
      }),
    );
    this.workflow.dependency(planningStep, blueprintStep);
    return {
      executionId,
      jobIds: [
        this.workflow.createJob('GENERATE_STORY_BLUEPRINT', projectId, blueprintStep),
        this.workflow.createJob(planningType, projectId, planningStep),
      ],
    };
  }
  scheduleStoryArcs(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-arcs:${projectId}:${blueprint.revision}`,
      'GENERATE_STORY_ARCS',
      projectId,
      renderArcPlanningPrompt(settings, blueprint.blueprint).inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );

    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_STORY_ARCS', projectId, stepId),
    };
  }
  updateArc(projectId: Id, arcId: string, input: unknown): StoryArc {
    const current = this.story.getArc(projectId, arcId);
    if (!current) throw new AppError('NOT_FOUND', 'Arc not found', 404);
    const arc = storyArcSchema.parse(input);
    if (arc.id !== arcId)
      throw new AppError('INVALID_ARC_PLAN', 'Arc identifier cannot change', 400);
    const saved = this.story.saveArc(
      projectId,
      arc,
      null,
      this.story.fingerprint({ operation: 'MANUAL_ARC', arcId, arc }),
    );
    const planItemIds = this.story.markArcDependentsStale(projectId, arcId);
    for (const planItemId of planItemIds)
      this.story.invalidateScope({ projectId, kind: 'PLAN_ITEM', stableId: planItemId });
    return saved;
  }

  scheduleStoryPlanWindow(
    projectId: Id,
    arcId: string,
    startChapter: number,
    endChapter: number,
  ): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    const arc = this.story.getArc(projectId, arcId);
    if (!settings || !blueprint || !arc)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Story settings, blueprint, and arc are required',
        409,
      );
    if (
      !Number.isInteger(startChapter) ||
      !Number.isInteger(endChapter) ||
      startChapter < arc.startChapter ||
      endChapter > arc.endChapter ||
      startChapter > endChapter ||
      endChapter - startChapter + 1 > (settings.generation.planningWindow ?? 20)
    )
      throw new AppError(
        'INVALID_PLAN_WINDOW',
        'Requested plan window is outside its configured bounds',
        400,
      );
    const previousWindow =
      this.story
        .getPlanWindows(projectId)
        .filter((window) => window.window.endChapter < startChapter)
        .sort((left, right) => right.window.endChapter - left.window.endChapter)[0] ?? null;
    const prompt = renderChapterPlanWindowPrompt(
      settings,
      blueprint.blueprint,
      arc,
      planWindowBoundary(previousWindow),
      startChapter,
      endChapter,
    );
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-plan-window:${arcId}:${startChapter}:${endChapter}`,
      'GENERATE_CHAPTER_PLAN_WINDOW',
      projectId,
      prompt.inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_PLAN_WINDOW', projectId, stepId),
    };
  }
  updatePlanWindow(projectId: Id, windowId: string, input: unknown): StoryPlanWindowResult {
    const current = this.story.getPlanWindow(projectId, windowId);
    if (!current) throw new AppError('NOT_FOUND', 'Plan window not found', 404);
    const result = storyPlanWindowResultSchema.parse(input);
    if (result.window.id !== windowId)
      throw new AppError('INVALID_PLAN_WINDOW', 'Plan window identifier cannot change', 400);
    const blueprint = this.story.getBlueprint(projectId);
    if (!blueprint || result.window.sourceBlueprintRevision !== blueprint.revision)
      throw new AppError('STALE_INPUT', 'Blueprint revision is no longer current', 409);
    const normalized = {
      ...result,
      window: {
        ...result.window,
        status: 'CURRENT' as const,
      },
    };
    const saved = this.story.savePlanWindow(
      projectId,
      normalized,
      this.story.fingerprint({ operation: 'MANUAL_PLAN_WINDOW', windowId, result: normalized }),
    );
    const planItemIds = new Set([
      ...current.items.map((item) => item.id),
      ...saved.items.map((item) => item.id),
    ]);
    for (const planItemId of planItemIds)
      this.story.invalidateScope({ projectId, kind: 'PLAN_ITEM', stableId: planItemId });
    return saved;
  }

  scheduleStoryChapterV2(projectId: Id, planItemId: string): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    const planItem = this.story.getPlanItem(projectId, planItemId)?.item;
    if (!settings || !blueprint || !planItem)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Long-story settings, blueprint, and plan item are required',
        409,
      );
    if (planItem.chapterNumber > settings.targetChapterCount)
      throw new AppError('INVALID_PLAN', 'Chapter plan is outside the configured target', 400);
    const manual = this.context.database.sqlite
      .prepare(
        "SELECT id FROM chapters WHERE project_id=? AND number=? AND story_origin='MANUAL' LIMIT 1",
      )
      .get(projectId, planItem.chapterNumber) as { id: Id } | undefined;
    if (manual)
      throw new AppError(
        'MANUAL_EDIT_CONFLICT',
        'A manual chapter occupies the requested chapter number',
        409,
      );
    const active = this.context.database.sqlite
      .prepare(
        `SELECT s.id FROM workflow_steps s
         JOIN workflow_executions e ON e.id=s.execution_id
         WHERE e.project_id=? AND s.type IN ('GENERATE_CHAPTER_V2','GENERATE_CHAPTER') AND s.entity_id=?
           AND s.status IN ('PENDING','RUNNING') LIMIT 1`,
      )
      .get(projectId, planItemId) as { id: Id } | undefined;
    if (active)
      throw new AppError('WORKFLOW_CONFLICT', 'Chapter generation is already scheduled', 409);
    const state = this.story.getStoryState(projectId);
    const followsSkippedGap =
      planItem.chapterNumber === state.currentChapter + 2 &&
      state.gapMarkers.some((marker) => marker.chapterNumber === state.currentChapter + 1);
    if (planItem.chapterNumber > state.currentChapter + 1 && !followsSkippedGap) {
      const existing = this.context.database.sqlite
        .prepare(
          "SELECT id FROM chapters WHERE project_id=? AND number=? AND story_origin='GENERATED' LIMIT 1",
        )
        .get(projectId, planItem.chapterNumber) as { id: Id } | undefined;
      if (!existing)
        throw new AppError(
          'CONTINUITY_ERROR',
          `Chapter ${planItem.chapterNumber} must follow chapter ${state.currentChapter}`,
          409,
        );
      throw new AppError(
        'CONTINUITY_ERROR',
        `Chapter ${planItem.chapterNumber} has no current checkpoint; rebuild continuity before regeneration`,
        409,
      );
    }
    const context = buildChapterGenerationContextV2(this.story, this.chapters, projectId, planItem);
    const prompt = renderChapterGenerationV2Prompt(context, planItem, settings.generation.model);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-chapter-v2:${planItemId}:${planItem.chapterNumber}`,
      'GENERATE_CHAPTER_V2',
      planItemId,
      prompt.inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_V2', planItemId, stepId),
    };
  }

  scheduleStoryStateAnalysis(chapterId: Id): { executionId: Id; jobId: Id } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const settings = this.story.getSettings(chapter.projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(chapter.projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-state-analysis:${chapter.id}:${chapter.revision}`,
      'ANALYZE_STORY_STATE',
      chapter.id,
      fingerprint({ operation: 'STATE_ANALYSIS_DEFERRED', chapterId, revision: chapter.revision }),
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('ANALYZE_STORY_STATE', chapter.id, stepId),
    };
  }

  scheduleContinuityCheck(chapterId: Id): { executionId: Id; jobId: Id } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const settings = this.story.getSettings(chapter.projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(chapter.projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `continuity:${chapter.id}:${chapter.revision}`,
      'CHECK_CONTINUITY',
      chapter.id,
      fingerprint({
        operation: 'CONTINUITY_CHECK_DEFERRED',
        chapterId,
        revision: chapter.revision,
      }),
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('CHECK_CONTINUITY', chapter.id, stepId),
    };
  }

  scheduleStorySummaryCompaction(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const state = this.story.getStoryState(projectId);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-summary-compaction:${projectId}:${state.revision}`,
      'SUMMARY_COMPACTION',
      projectId,
      renderSummaryCompactionPrompt(state, settings.generation.model).inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('SUMMARY_COMPACTION', projectId, stepId),
    };
  }

  scheduleStoryBatch(
    projectId: Id,
    input: StoryGenerationBatchRequest,
  ): { batch: StoryGenerationBatch; executionId: Id; jobIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const request = storyGenerationBatchRequestSchema.parse(input);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    const state = this.story.getStoryState(projectId);
    const startChapter =
      request.mode === 'RANGE' ? request.startChapter! : state.currentChapter + 1;
    if (startChapter > state.currentChapter + 1)
      throw new AppError(
        'CONTINUITY_ERROR',
        `Batch must start at chapter ${state.currentChapter + 1}`,
        409,
      );
    const endChapter =
      request.mode === 'RANGE'
        ? request.endChapter!
        : request.mode === 'NEXT'
          ? startChapter + request.count! - 1
          : settings.targetChapterCount;
    if (startChapter > endChapter || startChapter > settings.targetChapterCount)
      throw new AppError('INVALID_BATCH', 'No chapters remain in the configured target', 400);
    if (endChapter > settings.targetChapterCount)
      throw new AppError('INVALID_BATCH', 'Batch exceeds the configured target chapter count', 400);
    const total = endChapter - startChapter + 1;
    const maxChapters = settings.generation.maxChaptersPerBatch ?? 25;
    if (total > maxChapters)
      throw new AppError(
        'INVALID_BATCH',
        `Batch exceeds maxChaptersPerBatch (${maxChapters})`,
        400,
      );
    const planItems: Array<{ chapterNumber: number; planItemId: string }> = [];
    for (let chapterNumber = startChapter; chapterNumber <= endChapter; chapterNumber += 1) {
      const planItem = this.story.getPlanItemForChapter(projectId, chapterNumber)?.item;
      if (!planItem)
        throw new AppError(
          'PREREQUISITE_MISSING',
          `A chapter plan item is required for chapter ${chapterNumber}`,
          409,
        );
      const manual = this.context.database.sqlite
        .prepare(
          "SELECT id FROM chapters WHERE project_id=? AND number=? AND story_origin='MANUAL' LIMIT 1",
        )
        .get(projectId, chapterNumber) as { id: Id } | undefined;
      if (manual)
        throw new AppError(
          'MANUAL_EDIT_CONFLICT',
          `Manual chapter ${chapterNumber} requires continuity review`,
          409,
        );
      const active = this.batches.activeChapter(projectId, chapterNumber);
      if (active)
        throw new AppError(
          'BATCH_CONFLICT',
          `Chapter ${chapterNumber} already has active work`,
          409,
        );
      planItems.push({ chapterNumber, planItemId: planItem.id });
    }
    const schedule = this.context.database.sqlite.transaction(() => {
      const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
      const jobIds: Id[] = [];
      const seeds: Array<{ chapterNumber: number; planItemId: string; workflowStepId: Id }> = [];
      let previousStepId: Id | null = null;
      for (const item of planItems) {
        const stepId = this.workflow.createStep(
          executionId,
          `story-batch:${executionId}:${item.chapterNumber}:${item.planItemId}`,
          'GENERATE_CHAPTER_V2',
          item.planItemId,
          fingerprint({
            operation: 'CHAPTER_GENERATION_V2_DEFERRED',
            projectId,
            chapterNumber: item.chapterNumber,
            planItemId: item.planItemId,
          }),
          (settings.generation.maxRetries ?? 3) + 1,
        );
        if (previousStepId) this.workflow.dependency(stepId, previousStepId);
        jobIds.push(this.workflow.createJob('GENERATE_CHAPTER_V2', item.planItemId, stepId));
        seeds.push({ ...item, workflowStepId: stepId });
        previousStepId = stepId;
      }
      const batch = this.batches.create({
        projectId,
        startChapter,
        endChapter,
        mode: request.mode,
        items: seeds,
      });
      return { batch, executionId, jobIds };
    });
    return schedule();
  }

  retryStoryBatchItem(batchId: Id, chapterNumber: number): StoryGenerationBatchItem {
    return this.batches.retry(batchId, chapterNumber);
  }

  skipStoryBatchItem(batchId: Id, chapterNumber: number, reason: string): StoryGenerationBatchItem {
    const item = this.batches.skip(batchId, chapterNumber, reason);
    this.story.recordGapMarker(item.projectId, chapterNumber, reason);
    return item;
  }

  cancelStoryBatch(batchId: Id): StoryGenerationBatch {
    return this.batches.cancel(batchId);
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
      renderChapterGenerationPrompt(this.story, this.chapters, projectId, item.item)
        .inputFingerprint,
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
      renderSummaryGenerationPrompt(this.story, this.chapters, chapterId).inputFingerprint,
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
  getChapterTimeline(projectId: Id, chapterId: Id) {
    return this.timeline.getChapterTimeline(projectId, chapterId);
  }
  scheduleSceneTiming(chapterId: Id, update?: SceneTimingUpdate) {
    return this.timeline.scheduleSceneTiming(chapterId, update);
  }
  scheduleMotionPlan(chapterId: Id, replace = false) {
    return this.timeline.scheduleMotionPlan(chapterId, replace);
  }
  async buildSceneTiming(chapterId: Id, update?: SceneTimingUpdate) {
    return await this.timeline.buildSceneTiming(chapterId, update);
  }
  buildMotionPlans(chapterId: Id, replace = false) {
    return this.timeline.buildMotionPlans(chapterId, replace);
  }
  getRenderPlan(projectId: Id, request: RenderRequest): RenderPlan {
    return this.timeline.getRenderPlan(projectId, request);
  }
  async scheduleTimelineRender(projectId: Id, request: RenderRequest) {
    return this.timeline.scheduleRender(projectId, request);
  }
  updateMotionPlan(projectId: Id, sceneId: Id, input: unknown) {
    return this.timeline.updateMotionPlan(projectId, sceneId, motionPlanUpdateSchema.parse(input));
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
      timeline: this.timeline.status(projectId, chapterId),
      jobs,
      story: this.story.getLongStoryCounts(projectId),
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
    const segments = segmentNarrationText(chapter.content);
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
            "UPDATE tts_segments SET id=?,status='COMPLETED',fingerprint=?,chapter_revision=?,source_start_offset=?,source_end_offset=?,source_text=?,error=NULL WHERE chapter_id=? AND segment_index=?",
          )
          .run(
            stepId,
            segmentFingerprint,
            chapter.revision,
            segment.sourceStartOffset,
            segment.sourceEndOffset,
            segment.sourceText,
            chapter.id,
            segment.index,
          );
      } else if (existing) {
        this.context.database.sqlite
          .prepare(
            "UPDATE tts_segments SET id=?,text=?,text_hash=?,chapter_revision=?,source_start_offset=?,source_end_offset=?,source_text=?,status='PENDING',audio_asset_id=NULL,duration_ms=NULL,error=NULL,fingerprint=? WHERE chapter_id=? AND segment_index=?",
          )
          .run(
            stepId,
            segment.text,
            segment.textHash,
            chapter.revision,
            segment.sourceStartOffset,
            segment.sourceEndOffset,
            segment.sourceText,
            segmentFingerprint,
            chapter.id,
            segment.index,
          );
        jobIds.push(this.workflow.createJob('TTS_SEGMENT', chapter.id, stepId));
      } else {
        this.context.database.sqlite
          .prepare(
            'INSERT INTO tts_segments(id,chapter_id,segment_index,text,text_hash,chapter_revision,source_start_offset,source_end_offset,source_text,status,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            stepId,
            chapter.id,
            segment.index,
            segment.text,
            segment.textHash,
            chapter.revision,
            segment.sourceStartOffset,
            segment.sourceEndOffset,
            segment.sourceText,
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
  private readonly timeline: TimelineWorkflowService;
  constructor(
    private readonly context: StudioContext,
    private readonly workerId: string,
    private readonly tts: TtsProvider = new EdgeTtsProvider(context.runner),
    private readonly storyEngine?: StoryEngine,
    private readonly sceneEngine?: SceneEngine,
    private readonly visualService?: VisualConsistencyService,
    private readonly imageService?: ImageGenerationService,
  ) {
    this.workflow = new WorkflowRepository(context.database);
    this.timeline = new TimelineWorkflowService(context);
  }
  async execute(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    if (step.type === 'GENERATE_SCENE_IMAGE') {
      if (!this.imageService)
        throw new AppError('CONFIGURATION_ERROR', 'Image generation worker is not configured', 500);
      await this.imageService.executeStep(step, this.workerId, signal, (progress, message) => {
        this.workflow.progress(step, progress, message);
      });
      return;
    }
    if (
      step.type === 'GENERATE_CHARACTER_VISUAL_PROFILE' ||
      step.type === 'GENERATE_LOCATION_VISUAL_PROFILE' ||
      step.type === 'GENERATE_OBJECT_VISUAL_PROFILE'
    ) {
      if (!this.visualService)
        throw new AppError(
          'CONFIGURATION_ERROR',
          'Visual Consistency worker is not configured',
          500,
        );
      const payload = this.parseStepPayload(step);
      const projectId = this.stepString(payload, 'projectId');
      const subjectId = this.stepString(payload, 'subjectId');
      const options = {
        projectId,
        subjectId,
        instructions: typeof payload.instructions === 'string' ? payload.instructions : '',
        workflowStepId: step.id,
        signal,
        isCurrent: () => this.stepIsCurrent(step),
        onProgress: (event: Parameters<AiAgentProgress>[0]) => {
          const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
            event.stage
          ];
          this.workflow.progress(step, progress, event.message);
        },
      };
      if (step.type === 'GENERATE_CHARACTER_VISUAL_PROFILE')
        await this.visualService.generateCharacterProfile({ ...options, characterId: subjectId });
      else if (step.type === 'GENERATE_LOCATION_VISUAL_PROFILE')
        await this.visualService.generateLocationProfile({ ...options, locationId: subjectId });
      else
        await this.visualService.generateObjectProfile({
          ...options,
          objectKey: subjectId,
          objectName: subjectId,
        });
      return;
    }
    if (step.type === 'BUILD_VISUAL_PROMPT') {
      if (!this.visualService)
        throw new AppError(
          'CONFIGURATION_ERROR',
          'Visual Consistency worker is not configured',
          500,
        );
      if (!this.stepIsCurrent(step))
        throw new AppError('STALE_INPUT', 'Visual prompt build input is stale', 409);
      const payload = this.parseStepPayload(step);
      const projectId = this.stepString(payload, 'projectId');
      const sceneId = this.stepString(payload, 'sceneId');
      const expectedSceneRevision =
        payload.sceneRevision === undefined ? undefined : this.stepNumber(payload, 'sceneRevision');
      this.visualService.buildPromptPackage({
        projectId,
        sceneId,
        expectedSceneRevision,
        generationId: step.id,
      });
      this.workflow.progress(step, 1, 'Visual prompt package is current');
      return;
    }
    if (step.type === 'REFINE_VISUAL_PROMPT') {
      if (!this.visualService)
        throw new AppError(
          'CONFIGURATION_ERROR',
          'Visual Consistency worker is not configured',
          500,
        );
      const payload = this.parseStepPayload(step);
      const projectId = this.stepString(payload, 'projectId');
      const packageId = this.stepString(payload, 'packageId');
      const requestValue: Record<string, unknown> =
        payload.request && typeof payload.request === 'object' && !Array.isArray(payload.request)
          ? (payload.request as Record<string, unknown>)
          : {};
      const request = {
        instructions:
          typeof requestValue.instructions === 'string' ? requestValue.instructions : '',
        ...(typeof requestValue.expectedPackageRevision === 'number'
          ? { expectedPackageRevision: requestValue.expectedPackageRevision }
          : {}),
      };
      await this.visualService.refinePromptPackage(
        projectId,
        packageId,
        request,
        step.id,
        signal,
        (event) => {
          const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
            event.stage
          ];
          this.workflow.progress(step, progress, event.message);
        },
        () => this.stepIsCurrent(step),
      );
      return;
    }
    if (
      step.type === 'GENERATE_SCENES' ||
      step.type === 'REGENERATE_SCENE' ||
      step.type === 'GENERATE_SCENE_PROMPT'
    ) {
      if (!this.sceneEngine)
        throw new AppError('CONFIGURATION_ERROR', 'Scene Engine worker is not configured', 500);
      await this.sceneEngine.executeStep(step, signal, (event) => {
        const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
          event.stage
        ];
        this.workflow.progress(step, progress, event.message);
      });
      return;
    }
    if (
      step.type === 'GENERATE_STORY_BLUEPRINT' ||
      step.type === 'GENERATE_CHAPTER_PLANS' ||
      step.type === 'GENERATE_CHAPTER' ||
      step.type === 'GENERATE_CHAPTER_SUMMARY' ||
      step.type === 'GENERATE_STORY_ARCS' ||
      step.type === 'GENERATE_CHAPTER_PLAN_WINDOW' ||
      step.type === 'GENERATE_CHAPTER_V2' ||
      step.type === 'ANALYZE_STORY_STATE' ||
      step.type === 'CHECK_CONTINUITY' ||
      step.type === 'SUMMARY_COMPACTION'
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
    if (step.type === 'BUILD_SCENE_TIMING') {
      const payload = this.parseStepPayload(step);
      if (fingerprint(payload) !== step.input_fingerprint || !this.stepIsCurrent(step))
        throw new AppError('STALE_INPUT', 'Scene timing input is stale', 409);
      const update =
        payload.update === undefined ? undefined : sceneTimingUpdateSchema.parse(payload.update);
      this.workflow.progress(step, 0.1, 'Measuring chapter audio and mapping TTS source spans');
      await this.timeline.buildSceneTiming(this.stepString(payload, 'chapterId'), update);
      this.workflow.progress(step, 1, 'Scene timing is current');
      return;
    }
    if (step.type === 'BUILD_MOTION_PLAN') {
      const payload = this.parseStepPayload(step);
      if (fingerprint(payload) !== step.input_fingerprint || !this.stepIsCurrent(step))
        throw new AppError('STALE_INPUT', 'Motion Plan input is stale', 409);
      const replace = payload.replace === true;
      this.workflow.progress(step, 0.1, 'Building deterministic Motion Plans');
      const plans = this.timeline.buildMotionPlans(this.stepString(payload, 'chapterId'), replace);
      this.workflow.progress(step, 1, `${plans.length} Motion Plans are current`);
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
    if (step.type === 'RENDER_SCENE_CLIP') {
      await this.executeSceneClipRender(step, signal);
      return;
    }
    if (step.type === 'RENDER_CHAPTER_VIDEO') {
      await this.executeChapterVideoRender(step, signal);
      return;
    }
    if (step.type === 'RENDER_PROJECT_VIDEO') {
      await this.executeProjectVideoRender(step, signal);
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
  private parseStepPayload(step: ClaimedStep): Record<string, unknown> {
    try {
      const payload = JSON.parse(step.payload || '{}') as unknown;
      if (payload && typeof payload === 'object' && !Array.isArray(payload))
        return payload as Record<string, unknown>;
    } catch {
      // Fall through to the typed workflow error below.
    }
    throw new AppError('INVALID_INPUT', 'Workflow step payload is invalid', 400);
  }
  private stepNumber(payload: Record<string, unknown>, key: string): number {
    const value = payload[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
      throw new AppError('INVALID_INPUT', `Workflow step ${key} must be a positive integer`, 400);
    return value;
  }

  private stepString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    if (typeof value !== 'string' || !value.trim())
      throw new AppError('INVALID_INPUT', `Workflow step ${key} is required`, 400);
    return value;
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
  private renderJob(step: ClaimedStep) {
    const job = this.timeline.renderJobs.getByStep(step.id);
    if (!job) throw new AppError('RENDER_JOB_NOT_FOUND', 'Render job is missing', 500);
    return job;
  }
  private async recoverRegisteredRender(
    step: ClaimedStep,
    assetType: 'SCENE_VIDEO_CLIP' | 'CHAPTER_VIDEO' | 'PROJECT_VIDEO',
  ): Promise<boolean> {
    const row = this.context.database.sqlite
      .prepare(
        `SELECT id,path,metadata
         FROM assets
         WHERE source_step_id=? AND input_fingerprint=? AND type=? AND status='READY' AND is_current=1
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(step.id, step.input_fingerprint, assetType) as
      { id: string; path: string; metadata: string } | undefined;
    if (!row) return false;
    try {
      await stat(safeWorkspacePath(this.context.workspace.root, row.path));
    } catch {
      return false;
    }
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(row.metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    const durationMs =
      typeof metadata.durationMs === 'number' && Number.isInteger(metadata.durationMs)
        ? metadata.durationMs
        : null;
    const job = this.renderJob(step);
    this.timeline.renderJobs.linkAssets(job.id, null, row.id);
    if (durationMs !== null)
      this.timeline.renderJobs.updateProgress(job.id, durationMs, durationMs);
    return true;
  }

  private reportRenderProgress(
    step: ClaimedStep,
    jobId: Id,
    timeMs: number | null,
    durationMs: number,
  ): void {
    if (timeMs === null) return;
    const progress = Math.max(0, Math.min(1, timeMs / durationMs));
    this.workflow.progress(step, progress, `FFmpeg ${Math.round(progress * 100)}%`);
    this.timeline.renderJobs.updateProgress(jobId, Math.max(0, Math.round(timeMs)));
  }

  private async executeSceneClipRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const payload = renderSceneClipPayloadSchema.parse(this.parseStepPayload(step));
    if (
      payload.fingerprint !== step.input_fingerprint ||
      payload.sceneId !== step.entity_id ||
      !this.stepIsCurrent(step)
    )
      throw new AppError('STALE_INPUT', 'Scene Clip inputs are stale', 409);
    if (await this.recoverRegisteredRender(step, 'SCENE_VIDEO_CLIP')) return;
    const assets = new AssetRepository(this.context.database);
    const currentImage = assets.currentRenderableSceneImage(
      payload.projectId,
      payload.sceneStableId,
    );
    const sourceAsset = payload.imagePath
      ? (this.context.database.sqlite
          .prepare(
            `SELECT id,path,role,type,sha256,input_fingerprint as inputFingerprint,metadata
             FROM assets WHERE project_id=? AND path=? AND sha256=? AND status='READY' LIMIT 1`,
          )
          .get(payload.projectId, payload.imagePath, payload.imageSha256) as
          | {
              id: Id;
              path: string;
              role: string;
              type: string;
              sha256: string;
              inputFingerprint: string | null;
              metadata: string;
            }
          | undefined)
      : null;
    if (payload.imagePath && !sourceAsset)
      throw new AppError('STALE_INPUT', 'Scene fallback asset is no longer available', 409);
    if (payload.fallbackPolicy === 'BLACK' && payload.imagePath)
      throw new AppError(
        'RENDER_INPUT_INVALID',
        'BLACK fallback cannot include an image source',
        409,
      );
    if (sourceAsset) {
      const expectedCurrent =
        sourceAsset.role === `scene:${payload.sceneStableId}:image`
          ? currentImage
          : sourceAsset.role === 'project:background'
            ? assets.current(payload.projectId, 'project:background')
            : null;
      const historicalHold =
        payload.fallbackPolicy === 'HOLD_PREVIOUS' &&
        sourceAsset.role === `scene:${payload.sceneStableId}:image` &&
        !currentImage;
      if (!historicalHold && (!expectedCurrent || expectedCurrent.sha256 !== sourceAsset.sha256))
        throw new AppError('STALE_INPUT', 'Scene image fallback changed before rendering', 409);
    }
    const sourcePath = payload.imagePath
      ? safeWorkspacePath(this.context.workspace.root, payload.imagePath)
      : null;
    if (sourcePath && payload.imageSha256) {
      const sourceDigest = await sha256File(sourcePath);
      if (sourceDigest.hash !== payload.imageSha256)
        throw new AppError('STALE_INPUT', 'Scene image content changed before rendering', 409);
    }
    const stagingRelativePath = `staging/${step.attemptId}/scene-clip.mp4`;
    const stagingPath = safeWorkspacePath(this.context.workspace.root, stagingRelativePath);
    await mkdir(dirname(stagingPath), { recursive: true });
    const job = this.renderJob(step);
    await this.context.media.runWithProgress(
      buildSceneClipArguments({
        sourcePath,
        outputPath: stagingPath,
        durationMs: payload.timing.durationMs,
        sourceWidth: payload.imageWidth,
        sourceHeight: payload.imageHeight,
        profile: {
          width: payload.config.width,
          height: payload.config.height,
          fps: payload.config.fps,
          qualityPreset: payload.config.qualityPreset,
        },
        fitMode: payload.config.fitMode,
        motionPlan: payload.motionPlan,
        fallback: payload.fallbackPolicy === 'BLACK' ? 'BLACK' : undefined,
      }),
      (update) =>
        this.reportRenderProgress(step, job.id, update.outTimeMs, payload.timing.durationMs),
      { cwd: this.context.workspace.root, signal },
    );
    const probe = await validateHierarchicalVideo(this.context.media, stagingPath, {
      width: payload.config.width,
      height: payload.config.height,
      fps: payload.config.fps,
      expectedDurationMs: payload.timing.durationMs,
      durationToleranceMs: 250,
      requireAudio: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      container: 'mp4',
    });
    if (!this.stepIsCurrent(step))
      throw new AppError('STALE_INPUT', 'Scene Clip inputs changed during rendering', 409);
    const promoted = await promoteManagedFile(
      this.context.workspace,
      stagingRelativePath,
      payload.outputPath,
    );
    const outputPath = safeWorkspacePath(this.context.workspace.root, payload.outputPath);
    if (!this.stepIsCurrent(step)) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Scene Clip inputs changed before promotion', 409);
    }
    const outputAssetId = randomUUID();
    const registered = assets.registerIfCurrentStep(
      {
        id: outputAssetId,
        projectId: payload.projectId,
        type: 'SCENE_VIDEO_CLIP',
        role: `scene:${payload.sceneStableId}:video`,
        path: promoted.relativePath,
        mediaType: 'video/mp4',
        bytes: promoted.bytes,
        sha256: promoted.hash,
        sourceEntityId: payload.sceneId,
        sourceStepId: step.id,
        inputFingerprint: payload.fingerprint,
        metadata: {
          durationMs: payload.timing.durationMs,
          sceneRevision: payload.motionPlan.sceneRevision,
          timingRevision: payload.timingRevision,
          motionPlanId: payload.motionPlan.id,
          fallbackPolicy: payload.fallbackPolicy,
          probe,
        },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Scene Clip inputs changed before asset registration', 409);
    }
    if (sourceAsset) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: sourceAsset.id,
        role: payload.fallbackPolicy === 'HOLD_PREVIOUS' ? 'SCENE_IMAGE_FALLBACK' : 'SCENE_IMAGE',
        sourceHash: sourceAsset.sha256,
      });
    }
    this.timeline.renderJobs.linkAssets(job.id, null, outputAssetId);
    this.timeline.renderJobs.updateProgress(
      job.id,
      payload.timing.durationMs,
      payload.timing.durationMs,
    );
  }

  private async executeChapterVideoRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const payload = renderChapterPayloadSchema.parse(this.parseStepPayload(step));
    if (
      payload.fingerprint !== step.input_fingerprint ||
      payload.chapterId !== step.entity_id ||
      !this.stepIsCurrent(step)
    )
      throw new AppError('STALE_INPUT', 'Chapter Video inputs are stale', 409);
    if (await this.recoverRegisteredRender(step, 'CHAPTER_VIDEO')) return;
    const assets = new AssetRepository(this.context.database);
    const clips = payload.clips.map((clip) => {
      const asset = assets.current(payload.projectId, `scene:${clip.sceneStableId}:video`);
      if (!asset || asset.inputFingerprint !== clip.fingerprint)
        throw new AppError('STALE_INPUT', `Scene Clip ${clip.sceneId} is not current`, 409);
      return { asset, durationMs: clip.durationMs };
    });
    const narration = assets.current(payload.projectId, `chapter:${payload.chapterId}:audio`);
    const subtitle = assets.current(payload.projectId, `chapter:${payload.chapterId}:subtitle`);
    if (
      !narration ||
      !subtitle ||
      narration.path !== payload.narrationPath ||
      subtitle.path !== payload.subtitlePath ||
      narration.sha256 !== payload.narrationSha256 ||
      subtitle.sha256 !== payload.subtitleSha256
    )
      throw new AppError(
        'STALE_INPUT',
        'Chapter narration or subtitles changed before rendering',
        409,
      );
    const stagingRelativePath = `staging/${step.attemptId}/chapter-video.mp4`;
    const stagingPath = safeWorkspacePath(this.context.workspace.root, stagingRelativePath);
    await mkdir(dirname(stagingPath), { recursive: true });
    const job = this.renderJob(step);
    await this.context.media.runWithProgress(
      buildChapterVideoArguments({
        clips: clips.map(({ asset, durationMs }) => ({
          path: safeWorkspacePath(this.context.workspace.root, asset.path),
          durationMs,
        })),
        narrationPath: safeWorkspacePath(this.context.workspace.root, narration.path),
        subtitlePath: safeWorkspacePath(this.context.workspace.root, subtitle.path),
        outputPath: stagingPath,
        durationMs: payload.durationMs,
        profile: {
          width: payload.config.width,
          height: payload.config.height,
          fps: payload.config.fps,
          qualityPreset: payload.config.qualityPreset,
        },
        transition: payload.config.transition,
        transitionDurationMs: payload.config.transitionDurationMs,
        subtitleStyle: {
          position: payload.config.subtitlePosition,
          fontSize: payload.config.subtitleFontSize,
          outlineWidth: payload.config.subtitleOutlineWidth,
        },
        narrationVolume: payload.config.narrationVolume,
      }),
      (update) => this.reportRenderProgress(step, job.id, update.outTimeMs, payload.durationMs),
      { cwd: this.context.workspace.root, signal },
    );
    const probe = await validateHierarchicalVideo(this.context.media, stagingPath, {
      width: payload.config.width,
      height: payload.config.height,
      fps: payload.config.fps,
      expectedDurationMs: payload.durationMs,
      durationToleranceMs: 350,
      requireAudio: true,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioSampleRate: 48_000,
      container: 'mp4',
    });
    if (!this.stepIsCurrent(step))
      throw new AppError('STALE_INPUT', 'Chapter Video inputs changed during rendering', 409);
    const promoted = await promoteManagedFile(
      this.context.workspace,
      stagingRelativePath,
      payload.outputPath,
    );
    const outputPath = safeWorkspacePath(this.context.workspace.root, payload.outputPath);
    if (!this.stepIsCurrent(step)) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Chapter Video inputs changed before promotion', 409);
    }
    const outputAssetId = randomUUID();
    const registered = assets.registerIfCurrentStep(
      {
        id: outputAssetId,
        projectId: payload.projectId,
        type: 'CHAPTER_VIDEO',
        role: `chapter:${payload.chapterId}:video`,
        path: promoted.relativePath,
        mediaType: 'video/mp4',
        bytes: promoted.bytes,
        sha256: promoted.hash,
        sourceEntityId: payload.chapterId,
        sourceStepId: step.id,
        inputFingerprint: payload.fingerprint,
        metadata: { durationMs: payload.durationMs, timingRevision: payload.timingRevision, probe },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(outputPath, { force: true });
      throw new AppError(
        'STALE_INPUT',
        'Chapter Video inputs changed before asset registration',
        409,
      );
    }
    for (const clip of clips) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: clip.asset.id,
        role: 'SCENE_VIDEO_CLIP',
        sourceHash: clip.asset.sha256,
      });
    }
    assets.addDependency({
      assetId: outputAssetId,
      dependsOnAssetId: narration.id,
      role: 'NARRATION',
      sourceHash: narration.sha256,
    });
    assets.addDependency({
      assetId: outputAssetId,
      dependsOnAssetId: subtitle.id,
      role: 'SUBTITLE',
      sourceHash: subtitle.sha256,
    });
    this.timeline.renderJobs.linkAssets(job.id, null, outputAssetId);
    this.timeline.renderJobs.updateProgress(job.id, payload.durationMs, payload.durationMs);
  }

  private async executeProjectVideoRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const payload = renderProjectPayloadSchema.parse(this.parseStepPayload(step));
    if (
      payload.fingerprint !== step.input_fingerprint ||
      payload.projectId !== step.entity_id ||
      !this.stepIsCurrent(step)
    )
      throw new AppError('STALE_INPUT', 'Project Video inputs are stale', 409);
    if (await this.recoverRegisteredRender(step, 'PROJECT_VIDEO')) return;
    const assets = new AssetRepository(this.context.database);
    const chapters = payload.chapters.map((chapter) => {
      const asset = assets.current(payload.projectId, `chapter:${chapter.chapterId}:video`);
      if (!asset || asset.inputFingerprint !== chapter.fingerprint)
        throw new AppError('STALE_INPUT', `Chapter Video ${chapter.chapterId} is not current`, 409);
      return { asset, chapterId: chapter.chapterId, durationMs: chapter.durationMs };
    });
    const music = payload.config.musicEnabled
      ? assets.current(payload.projectId, 'project:music')
      : null;
    if (
      payload.config.musicEnabled &&
      (!music ||
        !payload.musicPath ||
        !payload.musicSha256 ||
        music.path !== payload.musicPath ||
        music.sha256 !== payload.musicSha256)
    )
      throw new AppError('STALE_INPUT', 'Project music changed before rendering', 409);
    const stagingRoot = `staging/${step.attemptId}`;
    const stagingRelativePath = `${stagingRoot}/project-video.mp4`;
    const stagingPath = safeWorkspacePath(this.context.workspace.root, stagingRelativePath);
    const chapterListRelativePath = `${stagingRoot}/chapters.txt`;
    const chapterListPath = safeWorkspacePath(this.context.workspace.root, chapterListRelativePath);
    await mkdir(dirname(stagingPath), { recursive: true });
    await writeFile(
      chapterListPath,
      `${chapters
        .map(
          ({ asset }) =>
            `file '${safeWorkspacePath(this.context.workspace.root, asset.path).replaceAll('\\', '/').replaceAll("'", "'\\''")}'`,
        )
        .join(String.fromCharCode(10))}${String.fromCharCode(10)}`,
      'utf8',
    );
    const job = this.renderJob(step);
    await this.context.media.runWithProgress(
      buildProjectVideoArguments({
        chapters: chapters.map(({ asset, chapterId, durationMs }) => ({
          chapterId,
          path: safeWorkspacePath(this.context.workspace.root, asset.path),
          durationMs,
        })),
        chapterListPath,
        outputPath: stagingPath,
        durationMs: payload.expectedDurationMs,
        profile: {
          width: payload.config.width,
          height: payload.config.height,
          fps: payload.config.fps,
          qualityPreset: payload.config.qualityPreset,
        },
        musicPath: music
          ? safeWorkspacePath(this.context.workspace.root, payload.musicPath!)
          : undefined,
        musicEnabled: payload.config.musicEnabled,
        loopMusic: payload.config.loopMusic,
        narrationVolume: payload.config.narrationVolume,
        musicVolume: payload.config.musicVolume,
      }),
      (update) =>
        this.reportRenderProgress(step, job.id, update.outTimeMs, payload.expectedDurationMs),
      { cwd: this.context.workspace.root, signal },
    );
    const probe = await validateHierarchicalVideo(this.context.media, stagingPath, {
      width: payload.config.width,
      height: payload.config.height,
      fps: payload.config.fps,
      expectedDurationMs: payload.expectedDurationMs,
      durationToleranceMs: 500,
      requireAudio: true,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioSampleRate: 48_000,
      container: 'mp4',
    });
    if (!this.stepIsCurrent(step))
      throw new AppError('STALE_INPUT', 'Project Video inputs changed during rendering', 409);
    const promoted = await promoteManagedFile(
      this.context.workspace,
      stagingRelativePath,
      payload.outputPath,
    );
    const outputPath = safeWorkspacePath(this.context.workspace.root, payload.outputPath);
    if (!this.stepIsCurrent(step)) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Project Video inputs changed before promotion', 409);
    }
    const outputAssetId = randomUUID();
    const registered = assets.registerIfCurrentStep(
      {
        id: outputAssetId,
        projectId: payload.projectId,
        type: 'PROJECT_VIDEO',
        role: projectVideoRole(payload.projectId, payload.scope),
        path: promoted.relativePath,
        mediaType: 'video/mp4',
        bytes: promoted.bytes,
        sha256: promoted.hash,
        sourceEntityId: payload.projectId,
        sourceStepId: step.id,
        inputFingerprint: payload.fingerprint,
        metadata: {
          durationMs: payload.expectedDurationMs,
          scope: payload.scope,
          chapters: payload.chapters,
          probe,
        },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(outputPath, { force: true });
      throw new AppError(
        'STALE_INPUT',
        'Project Video inputs changed before asset registration',
        409,
      );
    }
    for (const chapter of chapters) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: chapter.asset.id,
        role: 'CHAPTER_VIDEO',
        sourceHash: chapter.asset.sha256,
      });
    }
    if (music) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: music.id,
        role: 'MUSIC',
        sourceHash: music.sha256,
      });
    }
    this.timeline.renderJobs.linkAssets(job.id, null, outputAssetId);
    this.timeline.renderJobs.updateProgress(
      job.id,
      payload.expectedDurationMs,
      payload.expectedDurationMs,
    );
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
export {
  parseSrt,
  segmentNarrationText,
  serializeSrt,
  subtitlesFromSegments,
  validateSubtitleCues,
} from './text.js';
export * from './omp-agent.js';
export * from './story-context.js';
export * from './story-prompts.js';
export * from './story-engine.js';
export * from './story-state.js';
export * from './scene-timing.js';
export * from './motion-plan.js';
export * from './timeline-workflow.js';
