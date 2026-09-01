import {
  AppError,
  characterVisualProfileEnvelopeSchema,
  characterVisualProfilePayloadSchema,
  generationMetadataSchema,
  locationVisualProfileEnvelopeSchema,
  locationVisualProfilePayloadSchema,
  visualObjectKeySchema,
  visualObjectProfileEnvelopeSchema,
  visualObjectProfilePayloadSchema,
  visualProfileReferenceUpdateSchema,
  visualProfileUpdateSchema,
  sceneObjectResolutionUpdateSchema,
  visualPromptRefinementEnvelopeSchema,
  visualPromptRefinementRequestSchema,
  visualStyleUpdateSchema,
  type CharacterVisualProfileDto,
  type GenerationMetadata,
  type Id,
  type LocationVisualProfileDto,
  type VisualObjectProfileDto,
  type VisualProfileGenerationKind,
  type VisualPromptPackageDto,
  type VisualPromptRefinementRequest,
  type VisualStyleSettingsDto,
} from '@studio/shared';
import {
  AssetRepository,
  ChapterRepository,
  SceneObjectResolutionRepository,
  SceneRepository,
  StoryRepository,
  VisualProfileRepository,
  VisualPromptPackageRepository,
  type DatabaseHandle,
} from '@studio/database';
import type { AiAgent, AiAgentProgress, AiAgentResult } from './omp-agent.js';
import {
  buildVisualPromptPackage,
  fingerprintValue,
  missingVisualPromptConstraints,
  normalizeVisualKey,
  stableSerialize,
} from './visual-prompts.js';
import {
  renderVisualProfilePrompt,
  renderVisualPromptRefinementPrompt,
  type VisualProfilePromptContext,
} from './visual-profile-prompts.js';
const now = (): string => new Date().toISOString();
const bounded = (value: string, max: number): string => value.trim().slice(0, max);
const normalizedObjectKey = (value: string): string => {
  const normalized = normalizeVisualKey(visualObjectKeySchema.parse(value));
  if (!normalized) throw new AppError('INVALID_INPUT', 'Object key is required', 400);
  return normalized;
};

type VisualProfileCandidate =
  | ReturnType<typeof characterVisualProfilePayloadSchema.parse>
  | ReturnType<typeof locationVisualProfilePayloadSchema.parse>
  | ReturnType<typeof visualObjectProfilePayloadSchema.parse>;

export type VisualProfileGenerationOptions = {
  projectId: Id;
  subjectId: string;
  instructions?: string;
  workflowStepId?: Id | null;
  signal?: AbortSignal;
  onProgress?: AiAgentProgress;
  isCurrent?: () => boolean;
};
type VisualProfileResult = {
  kind: VisualProfileGenerationKind;
  generationId: Id | null;
  profile: CharacterVisualProfileDto | LocationVisualProfileDto | VisualObjectProfileDto;
};

export type VisualPromptBuildOptions = {
  projectId: Id;
  sceneId: Id;
  generationId?: Id | null;
  expectedSceneRevision?: number;
};

export class VisualConsistencyService {
  constructor(
    private readonly scenes: SceneRepository,
    private readonly chapters: ChapterRepository,
    private readonly story: StoryRepository,
    private readonly profiles: VisualProfileRepository,
    private readonly objectResolutions: SceneObjectResolutionRepository,
    private readonly packages: VisualPromptPackageRepository,
    private readonly assets: AssetRepository,
    private readonly agent: AiAgent | null = null,
  ) {}

  getCharacterProfile(
    projectId: Id,
    characterId: string,
    revision?: number,
  ): CharacterVisualProfileDto | null {
    return this.profiles.getCharacter(projectId, characterId, revision);
  }

  getLocationProfile(
    projectId: Id,
    locationId: Id,
    revision?: number,
  ): LocationVisualProfileDto | null {
    return this.profiles.getLocation(projectId, locationId, revision);
  }

  getObjectProfile(
    projectId: Id,
    objectKey: string,
    revision?: number,
  ): VisualObjectProfileDto | null {
    return this.profiles.getObject(projectId, normalizedObjectKey(objectKey), revision);
  }

  listCharacterProfiles(projectId: Id, limit = 50, offset = 0) {
    return this.profiles.listCharacters(projectId, limit, offset);
  }

  listLocationProfiles(projectId: Id, limit = 50, offset = 0) {
    return this.profiles.listLocations(projectId, limit, offset);
  }

  listObjectProfiles(projectId: Id, limit = 50, offset = 0) {
    return this.profiles.listObjects(projectId, limit, offset);
  }

  getStyleBible(projectId: Id): VisualStyleSettingsDto | null {
    return this.scenes.getVisualStyle(projectId);
  }

  listStyleBibleRevisions(projectId: Id, limit = 100, offset = 0): VisualStyleSettingsDto[] {
    return this.scenes.listVisualStyles(projectId, limit, offset);
  }

  saveStyleBible(projectId: Id, input: unknown): VisualStyleSettingsDto {
    const value = visualStyleUpdateSchema.parse(input);
    const { expectedRevision, ...style } = value;
    this.assertReferences(projectId, style.referenceAssetIds, 'STYLE_REFERENCE_IMAGE');
    try {
      const saved = this.scenes.saveVisualStyle(projectId, style, expectedRevision);
      this.packages.invalidateDependency(projectId, 'STYLE_BIBLE', projectId, saved.id);
      return saved;
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      throw error;
    }
  }

  async generateCharacterProfile(
    options: Omit<VisualProfileGenerationOptions, 'subjectId'> & { characterId: string },
  ): Promise<VisualProfileResult> {
    return this.generateProfile({ ...options, subjectId: options.characterId, kind: 'CHARACTER' });
  }

  async generateLocationProfile(
    options: Omit<VisualProfileGenerationOptions, 'subjectId'> & { locationId: Id },
  ): Promise<VisualProfileResult> {
    return this.generateProfile({ ...options, subjectId: options.locationId, kind: 'LOCATION' });
  }
  async generateObjectProfile(
    options: Omit<VisualProfileGenerationOptions, 'subjectId'> & {
      objectKey: string;
      objectName: string;
    },
  ): Promise<VisualProfileResult> {
    const objectKey = normalizedObjectKey(options.objectKey);
    return this.generateProfile({
      ...options,
      subjectId: objectKey,
      kind: 'OBJECT',
      subjectName: options.objectName,
    });
  }

  private async generateProfile(
    options: VisualProfileGenerationOptions & {
      kind: VisualProfileGenerationKind;
      subjectName?: string;
    },
  ): Promise<VisualProfileResult> {
    const context = this.buildProfileContext(
      options.projectId,
      options.kind,
      options.subjectId,
      options.subjectName,
    );
    const prompt = renderVisualProfilePrompt(context, options.instructions ?? '');
    if (options.isCurrent && !options.isCurrent())
      throw new AppError('STALE_INPUT', 'Visual profile generation input is stale', 409);
    const existing = this.findCommittedProfile(
      options.kind,
      options.projectId,
      options.subjectId,
      prompt.inputFingerprint,
    );
    if (existing)
      return { kind: options.kind, generationId: existing.generationId, profile: existing };
    const agent = this.agent;
    if (!agent)
      throw new AppError('OMP_UNAVAILABLE', 'OMP profile generation is not available', 503, true);
    const startedAt = now();
    const initialMetadata = this.metadata(
      prompt.operation,
      prompt.inputFingerprint,
      startedAt,
      context,
    );
    const generationId = this.story.createGenerationRecord(
      options.projectId,
      prompt.operation,
      options.subjectId,
      options.workflowStepId ?? null,
      prompt.inputFingerprint,
      initialMetadata,
      'RUNNING',
    );
    let result: AiAgentResult | undefined;
    try {
      result = await agent.generate(
        this.toAgentRequest(options.projectId, prompt),
        options.signal,
        options.onProgress,
      );
      const metadata = this.completedMetadata(initialMetadata, result, startedAt);
      const candidate = this.parseCandidate(options.kind, result.text);
      if (options.isCurrent && !options.isCurrent())
        throw new AppError('STALE_INPUT', 'Visual profile generation input is stale', 409);
      const profile = this.saveCandidate(options, candidate, prompt.inputFingerprint, generationId);
      this.story.updateGenerationRecord(generationId, 'COMPLETED', metadata);
      this.recordUsage(options.projectId, prompt.operation, options.subjectId, result, 'SUCCEEDED');
      return { kind: options.kind, generationId, profile };
    } catch (error) {
      const message =
        error instanceof Error ? bounded(error.message, 2_000) : 'Visual profile generation failed';
      const status =
        error instanceof AppError && error.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      this.story.updateGenerationRecord(
        generationId,
        status,
        this.failedMetadata(initialMetadata, startedAt),
        message,
      );
      this.recordUsage(options.projectId, prompt.operation, options.subjectId, result, status);
      if (error instanceof AppError) throw error;
      throw new AppError(
        'STRUCTURED_OUTPUT_ERROR',
        'OMP returned an invalid visual profile candidate',
        422,
        false,
        message,
      );
    }
  }

  private findCommittedProfile(
    kind: VisualProfileGenerationKind,
    projectId: Id,
    subjectId: string,
    inputFingerprint: string,
  ): VisualProfileResult['profile'] | null {
    const profiles =
      kind === 'CHARACTER'
        ? this.profiles.listCharacterRevisions(projectId, subjectId, 100, 0)
        : kind === 'LOCATION'
          ? this.profiles.listLocationRevisions(projectId, subjectId, 100, 0)
          : this.profiles.listObjectRevisions(projectId, subjectId, 100, 0);
    return (
      profiles.find(
        (profile) => profile.inputFingerprint === inputFingerprint && profile.status !== 'STALE',
      ) ?? null
    );
  }

  private buildProfileContext(
    projectId: Id,
    kind: VisualProfileGenerationKind,
    subjectId: string,
    subjectName?: string,
  ): VisualProfilePromptContext {
    const blueprint = this.story.getBlueprint(projectId)?.blueprint ?? null;
    const storyState = this.story.getStoryState(projectId);
    const style = this.scenes.getVisualStyle(projectId);
    const compactState = {
      currentChapter: storyState.currentChapter,
      currentArcId: storyState.currentArcId,
      currentPhase: storyState.currentPhase,
      rollingProgressSummary: storyState.rollingProgressSummary.slice(0, 2_000),
      characterStates:
        kind === 'CHARACTER'
          ? storyState.characterStates.filter((item) => item.characterId === subjectId)
          : [],
      importantFacts: storyState.importantFacts.slice(-20),
      recentEvents: storyState.recentEvents.slice(-12),
    };
    if (kind === 'CHARACTER') {
      const character = blueprint?.characters.find((item) => item.id === subjectId);
      if (!character) throw new AppError('NOT_FOUND', 'Story character not found', 404);
      return {
        projectId,
        subjectId,
        subjectName: character.name,
        kind,
        subject: character,
        storyState: compactState,
        style,
        relevantScenes: this.scenes.listVisualContextScenes(
          projectId,
          { characterId: subjectId },
          12,
        ),
      };
    }
    if (kind === 'LOCATION') {
      const location = this.scenes.getLocation(projectId, subjectId);
      if (!location) throw new AppError('NOT_FOUND', 'Location not found', 404);
      return {
        projectId,
        subjectId,
        subjectName: location.name,
        kind,
        subject: location,
        storyState: compactState,
        style,
        relevantScenes: this.scenes.listVisualContextScenes(
          projectId,
          { locationId: subjectId },
          12,
        ),
      };
    }
    const name = subjectName?.trim() || subjectId;
    return {
      projectId,
      subjectId,
      subjectName: name,
      kind,
      subject: { objectKey: subjectId, name },
      storyState: compactState,
      style,
      relevantScenes: this.scenes.listVisualContextScenes(projectId, { objectName: name }, 12),
    };
  }

  private parseCandidate(kind: VisualProfileGenerationKind, text: string): VisualProfileCandidate {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AppError('STRUCTURED_OUTPUT_ERROR', 'Visual profile output must be JSON', 422);
    }
    if (kind === 'CHARACTER') return characterVisualProfileEnvelopeSchema.parse(value).profile;
    if (kind === 'LOCATION') return locationVisualProfileEnvelopeSchema.parse(value).profile;
    return visualObjectProfileEnvelopeSchema.parse(value).profile;
  }

  private saveCandidate(
    options: VisualProfileGenerationOptions & {
      kind: VisualProfileGenerationKind;
      subjectName?: string;
    },
    candidate: VisualProfileCandidate,
    inputFingerprint: string,
    generationId: Id,
  ): CharacterVisualProfileDto | LocationVisualProfileDto | VisualObjectProfileDto {
    const promptFragment = bounded(stableSerialize(candidate), 2_000);
    if (options.kind === 'CHARACTER')
      return this.profiles.saveCharacter({
        projectId: options.projectId,
        characterId: options.subjectId,
        payload: characterVisualProfilePayloadSchema.parse(candidate),
        promptFragment,
        inputFingerprint,
        generationId,
        status: 'DRAFT',
      });
    if (options.kind === 'LOCATION') {
      const location = this.scenes.getLocation(options.projectId, options.subjectId);
      if (!location) throw new AppError('NOT_FOUND', 'Location not found', 404);
      return this.profiles.saveLocation({
        projectId: options.projectId,
        locationId: options.subjectId,
        locationName: location.name,
        payload: locationVisualProfilePayloadSchema.parse(candidate),
        promptFragment,
        inputFingerprint,
        generationId,
        status: 'DRAFT',
      });
    }
    return this.profiles.saveObject({
      projectId: options.projectId,
      objectKey: options.subjectId,
      name: options.subjectName ?? options.subjectId,
      payload: visualObjectProfilePayloadSchema.parse(candidate),
      promptFragment,
      inputFingerprint,
      generationId,
      status: 'DRAFT',
    });
  }

  updateCharacterProfile(
    projectId: Id,
    characterId: string,
    input: unknown,
  ): CharacterVisualProfileDto {
    const update = visualProfileUpdateSchema.parse(input);
    const current = this.profiles.getCharacter(projectId, characterId);
    if (!current) throw new AppError('NOT_FOUND', 'Character profile not found', 404);
    const base =
      update.expectedRevision === undefined
        ? current
        : this.profiles.getCharacter(projectId, characterId, update.expectedRevision);
    if (!base) throw new AppError('CONFLICT', 'Character profile revision conflict', 409);
    const payload = characterVisualProfilePayloadSchema.parse({
      ...base.payload,
      ...(update.payload ?? {}),
      ...(update.referenceAssetIds ? { referenceAssetIds: update.referenceAssetIds } : {}),
    });
    const saved = this.profiles.saveCharacter({
      projectId,
      characterId,
      payload,
      promptFragment: update.promptFragment ?? base.promptFragment,
      referenceAssetIds: payload.referenceAssetIds,
      inputFingerprint: fingerprintValue({
        type: 'manual-character-profile',
        projectId,
        characterId,
        payload,
      }),
      status: base.status === 'DRAFT' ? 'DRAFT' : 'APPROVED',
    });
    if (saved.status === 'APPROVED')
      this.packages.invalidateDependency(projectId, 'CHARACTER_PROFILE', characterId, saved.id);
    return saved;
  }

  updateLocationProfile(projectId: Id, locationId: Id, input: unknown): LocationVisualProfileDto {
    const update = visualProfileUpdateSchema.parse(input);
    const current = this.profiles.getLocation(projectId, locationId);
    if (!current) throw new AppError('NOT_FOUND', 'Location profile not found', 404);
    const base =
      update.expectedRevision === undefined
        ? current
        : this.profiles.getLocation(projectId, locationId, update.expectedRevision);
    if (!base) throw new AppError('CONFLICT', 'Location profile revision conflict', 409);
    const location = this.scenes.getLocation(projectId, locationId);
    if (!location) throw new AppError('NOT_FOUND', 'Location not found', 404);
    const payload = locationVisualProfilePayloadSchema.parse({
      ...base.payload,
      ...(update.payload ?? {}),
      ...(update.referenceAssetIds ? { referenceAssetIds: update.referenceAssetIds } : {}),
    });
    const saved = this.profiles.saveLocation({
      projectId,
      locationId,
      locationName: location.name,
      payload,
      promptFragment: update.promptFragment ?? base.promptFragment,
      referenceAssetIds: payload.referenceAssetIds,
      inputFingerprint: fingerprintValue({
        type: 'manual-location-profile',
        projectId,
        locationId,
        payload,
      }),
      status: base.status === 'DRAFT' ? 'DRAFT' : 'APPROVED',
    });
    if (saved.status === 'APPROVED')
      this.packages.invalidateDependency(projectId, 'LOCATION_PROFILE', locationId, saved.id);
    return saved;
  }

  updateObjectProfile(projectId: Id, objectKey: string, input: unknown): VisualObjectProfileDto {
    const key = normalizedObjectKey(objectKey);
    const update = visualProfileUpdateSchema.parse(input);
    const current = this.profiles.getObject(projectId, key);
    if (!current) throw new AppError('NOT_FOUND', 'Object profile not found', 404);
    const base =
      update.expectedRevision === undefined
        ? current
        : this.profiles.getObject(projectId, key, update.expectedRevision);
    if (!base) throw new AppError('CONFLICT', 'Object profile revision conflict', 409);
    const payload = visualObjectProfilePayloadSchema.parse({
      ...base.payload,
      ...(update.payload ?? {}),
      ...(update.referenceAssetIds ? { referenceAssetIds: update.referenceAssetIds } : {}),
    });
    const saved = this.profiles.saveObject({
      projectId,
      objectKey: key,
      name: payload.name,
      payload,
      promptFragment: update.promptFragment ?? base.promptFragment,
      referenceAssetIds: payload.referenceAssetIds,
      inputFingerprint: fingerprintValue({
        type: 'manual-object-profile',
        projectId,
        objectKey: key,
        payload,
      }),
      status: base.status === 'DRAFT' ? 'DRAFT' : 'APPROVED',
    });
    if (saved.status === 'APPROVED')
      this.packages.invalidateDependency(projectId, 'OBJECT_PROFILE', key, saved.id);
    return saved;
  }
  updateCharacterProfileReferences(
    projectId: Id,
    characterId: string,
    input: unknown,
  ): CharacterVisualProfileDto {
    const update = visualProfileReferenceUpdateSchema.parse(input);
    return this.updateCharacterProfile(projectId, characterId, update);
  }

  updateLocationProfileReferences(
    projectId: Id,
    locationId: Id,
    input: unknown,
  ): LocationVisualProfileDto {
    const update = visualProfileReferenceUpdateSchema.parse(input);
    return this.updateLocationProfile(projectId, locationId, update);
  }

  updateObjectProfileReferences(
    projectId: Id,
    objectKey: string,
    input: unknown,
  ): VisualObjectProfileDto {
    const update = visualProfileReferenceUpdateSchema.parse(input);
    return this.updateObjectProfile(projectId, objectKey, update);
  }

  approveCharacterProfile(
    projectId: Id,
    characterId: string,
    revision: number,
    expectedRowVersion?: number,
  ): CharacterVisualProfileDto {
    const saved = this.profiles.approveCharacter(
      projectId,
      characterId,
      revision,
      expectedRowVersion,
    );
    this.packages.invalidateDependency(projectId, 'CHARACTER_PROFILE', characterId, saved.id);
    return saved;
  }

  approveLocationProfile(
    projectId: Id,
    locationId: Id,
    revision: number,
    expectedRowVersion?: number,
  ): LocationVisualProfileDto {
    const saved = this.profiles.approveLocation(
      projectId,
      locationId,
      revision,
      expectedRowVersion,
    );
    this.packages.invalidateDependency(projectId, 'LOCATION_PROFILE', locationId, saved.id);
    return saved;
  }

  approveObjectProfile(
    projectId: Id,
    objectKey: string,
    revision: number,
    expectedRowVersion?: number,
  ): VisualObjectProfileDto {
    const key = normalizedObjectKey(objectKey);
    const saved = this.profiles.approveObject(projectId, key, revision, expectedRowVersion);
    this.packages.invalidateDependency(projectId, 'OBJECT_PROFILE', key, saved.id);
    return saved;
  }

  buildPromptPackage(options: VisualPromptBuildOptions): VisualPromptPackageDto {
    const scene = this.scenes.getScene(options.sceneId);
    if (!scene || scene.projectId !== options.projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    if (
      options.expectedSceneRevision !== undefined &&
      scene.revision !== options.expectedSceneRevision
    )
      throw new AppError('STALE_INPUT', 'Visual prompt build input is stale', 409);
    const result = buildVisualPromptPackage({
      projectId: options.projectId,
      scene,
      blueprint: this.story.getBlueprint(options.projectId)?.blueprint ?? null,
      storyState: this.story.getStoryState(options.projectId),
      style: this.scenes.getVisualStyle(options.projectId),
      profiles: this.profiles,
      objectResolutions: this.objectResolutions,
      locationMatches: (projectId, name) => this.scenes.listLocationMatches(projectId, name),
    });
    return this.packages.saveCurrent({
      projectId: options.projectId,
      sceneRevisionId: scene.id,
      payload: result.package,
      generationId: options.generationId,
    });
  }

  buildChapterPackages(
    projectId: Id,
    chapterId: Id,
    limit = 200,
    offset = 0,
    onProgress?: (completed: number, total: number) => void,
  ): VisualPromptPackageDto[] {
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const scenes = this.scenes.listScenes(
      chapterId,
      Math.min(200, Math.max(1, limit)),
      Math.max(0, offset),
    );
    const results: VisualPromptPackageDto[] = [];
    scenes.forEach((scene, index) => {
      results.push(this.buildPromptPackage({ projectId, sceneId: scene.id }));
      onProgress?.(index + 1, scenes.length);
    });
    return results;
  }

  getPromptPackage(projectId: Id, packageId: Id): VisualPromptPackageDto | null {
    return this.packages.get(projectId, packageId);
  }
  listCharacterProfileRevisions(projectId: Id, characterId: string, limit = 50, offset = 0) {
    return this.profiles.listCharacterRevisions(projectId, characterId, limit, offset);
  }

  listLocationProfileRevisions(projectId: Id, locationId: Id, limit = 50, offset = 0) {
    return this.profiles.listLocationRevisions(projectId, locationId, limit, offset);
  }

  listObjectProfileRevisions(projectId: Id, objectKey: string, limit = 50, offset = 0) {
    return this.profiles.listObjectRevisions(
      projectId,
      normalizedObjectKey(objectKey),
      limit,
      offset,
    );
  }

  getCurrentPromptPackage(projectId: Id, sceneRevisionId: Id): VisualPromptPackageDto | null {
    return this.packages.getCurrent(projectId, sceneRevisionId);
  }

  listSceneObjectResolutions(projectId: Id, sceneRevisionId: Id) {
    const scene = this.scenes.getScene(sceneRevisionId, true);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    return this.objectResolutions.list(projectId, sceneRevisionId);
  }

  saveSceneObjectResolution(
    projectId: Id,
    sceneRevisionId: Id,
    sourceLabel: string,
    input: unknown,
  ) {
    const scene = this.scenes.getScene(sceneRevisionId, true);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    const update = sceneObjectResolutionUpdateSchema.parse(input);
    const normalizedKey = normalizeVisualKey(sourceLabel);
    if (!normalizedKey) throw new AppError('INVALID_INPUT', 'Object label is required', 400);
    if (
      update.visualObjectProfileId &&
      !this.profiles.getObjectById(projectId, update.visualObjectProfileId)
    )
      throw new AppError('NOT_FOUND', 'Visual object profile not found', 404);
    const saved = this.objectResolutions.save({
      projectId,
      sceneRevisionId,
      sourceLabel,
      normalizedKey,
      visualObjectProfileId: update.visualObjectProfileId,
      resolutionStatus: update.visualObjectProfileId ? 'RESOLVED' : 'UNRESOLVED',
    });
    this.packages.invalidateSceneRevision(projectId, sceneRevisionId);
    return saved;
  }

  listChapterPromptPackages(projectId: Id, chapterId: Id, limit = 100, offset = 0) {
    return this.packages.listForChapter(projectId, chapterId, limit, offset);
  }

  async refinePromptPackage(
    projectId: Id,
    packageId: Id,
    request: VisualPromptRefinementRequest,
    workflowStepId?: Id | null,
    signal?: AbortSignal,
    onProgress?: AiAgentProgress,
    isCurrent?: () => boolean,
  ): Promise<VisualPromptPackageDto> {
    const parsedRequest = visualPromptRefinementRequestSchema.parse(request);
    const current = this.packages.get(projectId, packageId);
    if (!current) throw new AppError('NOT_FOUND', 'Visual prompt package not found', 404);
    if (current.status !== 'CURRENT')
      throw new AppError('STALE_INPUT', 'Visual prompt package is stale', 409);
    const prompt = renderVisualPromptRefinementPrompt(
      current.payload.inputFingerprint,
      current.payload.fullPrompt,
      current.payload.negativePrompt,
      parsedRequest,
    );
    const committed = this.packages.getCurrent(projectId, current.sceneRevisionId);
    if (committed?.payload.refinementInputFingerprint === prompt.inputFingerprint) return committed;
    const agent = this.agent;
    if (!agent)
      throw new AppError('OMP_UNAVAILABLE', 'OMP prompt refinement is not available', 503, true);
    const startedAt = now();
    const initialMetadata = this.metadata(
      prompt.operation,
      prompt.inputFingerprint,
      startedAt,
      current.payload,
    );
    const generationId = this.story.createGenerationRecord(
      projectId,
      prompt.operation,
      current.sceneRevisionId,
      workflowStepId ?? null,
      prompt.inputFingerprint,
      initialMetadata,
      'RUNNING',
    );
    let result: AiAgentResult | undefined;
    try {
      result = await agent.generate(this.toAgentRequest(projectId, prompt), signal, onProgress);
      const output = visualPromptRefinementEnvelopeSchema.parse(JSON.parse(result.text));
      if (output.packageFingerprint !== current.payload.inputFingerprint)
        throw new AppError('STALE_INPUT', 'Refined prompt package fingerprint does not match', 409);
      if (isCurrent && !isCurrent())
        throw new AppError('STALE_INPUT', 'Visual prompt refinement input is stale', 409);
      const missingConstraints = missingVisualPromptConstraints(
        current.payload,
        output.fullPrompt,
        output.negativePrompt,
      );
      if (missingConstraints.length)
        throw new AppError(
          'STRUCTURED_OUTPUT_ERROR',
          `Refined prompt omits canonical constraints: ${missingConstraints.slice(0, 8).join(', ')}`,
          422,
        );
      const refined = this.packages.saveRefinement({
        projectId,
        sceneRevisionId: current.sceneRevisionId,
        packageFingerprint: current.payload.inputFingerprint,
        refinementInputFingerprint: prompt.inputFingerprint,
        fullPrompt: output.fullPrompt,
        negativePrompt: output.negativePrompt,
        generationId,
      });
      this.story.updateGenerationRecord(
        generationId,
        'COMPLETED',
        this.completedMetadata(initialMetadata, result, startedAt),
      );
      this.recordUsage(projectId, prompt.operation, current.sceneRevisionId, result, 'SUCCEEDED');
      return refined;
    } catch (error) {
      const message =
        error instanceof Error ? bounded(error.message, 2_000) : 'Visual prompt refinement failed';
      const status =
        error instanceof AppError && error.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      this.story.updateGenerationRecord(
        generationId,
        status,
        this.failedMetadata(initialMetadata, startedAt),
        message,
      );
      this.recordUsage(projectId, prompt.operation, current.sceneRevisionId, result, status);
      if (error instanceof AppError) throw error;
      throw new AppError(
        'STRUCTURED_OUTPUT_ERROR',
        'OMP returned an invalid visual prompt refinement',
        422,
        false,
        message,
      );
    }
  }
  private recordUsage(
    projectId: Id,
    operation: GenerationMetadata['operation'],
    entityId: string,
    result: AiAgentResult | undefined,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
  ): void {
    this.story.saveUsage({
      projectId,
      operation,
      entityId,
      attempt: 1,
      provider: result?.provider ?? null,
      model: result?.model ?? null,
      inputTokens: result?.inputTokens ?? null,
      outputTokens: result?.outputTokens ?? null,
      durationMs: result?.durationMs ?? null,
      costUsd: result?.costUsd ?? null,
      currency: result?.costCurrency ?? null,
      status,
    });
  }

  private toAgentRequest(
    projectId: Id,
    prompt: {
      operation: GenerationMetadata['operation'];
      promptVersion: string;
      schemaVersion: string;
      inputFingerprint: string;
      systemPrompt: string;
      userPrompt: string;
    },
  ) {
    return {
      ...prompt,
      model: this.story.getSettings(projectId)?.generation.model ?? null,
    };
  }

  private assertReferences(projectId: Id, assetIds: string[], expectedType: string): void {
    for (const id of assetIds) {
      const asset = this.assets.get(id);
      if (
        !asset ||
        asset.projectId !== projectId ||
        asset.status !== 'READY' ||
        asset.type !== expectedType
      )
        throw new AppError(
          'INVALID_REFERENCE',
          'Reference asset is not owned by the project or has the wrong role',
          400,
        );
    }
  }

  private metadata(
    operation: GenerationMetadata['operation'],
    inputFingerprint: string,
    startedAt: string,
    context: unknown,
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
      operation,
      inputFingerprint,
      provider: null,
      model: null,
      promptVersion: `${operation.toLocaleLowerCase('en-US')}.v1`,
      schemaVersion: `${operation.toLocaleLowerCase('en-US')}.v1`,
      startedAt,
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costCurrency: null,
      finishReason: null,
      attempt: 1,
      contextHash: fingerprintValue(context),
      omittedContext: [],
    });
  }

  private completedMetadata(
    initial: GenerationMetadata,
    result: AiAgentResult,
    startedAt: string,
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
      ...initial,
      provider: result.provider,
      model: result.model,
      completedAt: now(),
      durationMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      costCurrency: result.costCurrency ?? null,
      finishReason: result.finishReason ?? null,
      contextHash: initial.contextHash,
      startedAt,
    });
  }

  private failedMetadata(initial: GenerationMetadata, startedAt: string): GenerationMetadata {
    return generationMetadataSchema.parse({
      ...initial,
      completedAt: now(),
      durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
      startedAt,
    });
  }
}
export function createVisualConsistencyService(
  database: DatabaseHandle,
  agent: AiAgent | null = null,
): VisualConsistencyService {
  const scenes = new SceneRepository(database);
  return new VisualConsistencyService(
    scenes,
    new ChapterRepository(database),
    new StoryRepository(database),
    new VisualProfileRepository(database),
    new SceneObjectResolutionRepository(database),
    new VisualPromptPackageRepository(database),
    new AssetRepository(database),
    agent,
  );
}
