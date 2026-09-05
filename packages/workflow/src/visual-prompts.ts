import {
  characterVisualProfilePayloadSchema,
  locationVisualProfilePayloadSchema,
  resolvedCharacterVisualSchema,
  resolvedLocationVisualSchema,
  resolvedObjectVisualSchema,
  sceneCharacterVisualStateSchema,
  visualConsistencyIssueSchema,
  visualPromptPackagePayloadSchema,
  visualStyleSettingsSchema,
  type CharacterVisualProfileDto,
  type LocationDto,
  type LocationVisualProfileDto,
  type SceneCharacterDto,
  type SceneDto,
  type StoryBlueprint,
  type StoryCharacter,
  type StoryState,
  type ResolvedLocationVisual,
  type VisualConsistencyIssue,
  type VisualObjectProfileDto,
  type VisualPromptDependency,
  type VisualPromptPackagePayload,
  type VisualStyleSettingsDto,
  type ReferenceBinding,
  type Shot,
} from '@studio/shared';
import type { SceneObjectResolutionRepository, VisualProfileRepository } from '@studio/database';
import { fingerprintValue, stableSerialize } from './story-prompts.js';
export { fingerprintValue, stableSerialize };

export const VISUAL_PROMPT_TEMPLATE_VERSION = 'visual-prompt-v2';

export type VisualPromptBuildInput = {
  projectId: string;
  scene: SceneDto;
  blueprint: StoryBlueprint | null;
  storyState: StoryState | null;
  style: VisualStyleSettingsDto | null;
  profiles: VisualProfileRepository;
  objectResolutions: SceneObjectResolutionRepository;
  locationMatches?: (projectId: string, name: string) => LocationDto[];
};

export type VisualPromptBuildResult = {
  package: VisualPromptPackagePayload;
  inputFingerprint: string;
};

type ProfileDependencyInput = {
  kind: VisualPromptDependency['kind'];
  key: string;
  revisionId: string;
  revision: number;
  fingerprint: string;
};

const compact = (value: string): string => value.trim().replace(/\s+/gu, ' ');
const bounded = (value: string, max: number): string => compact(value).slice(0, max);

export function normalizeVisualKey(value: string): string {
  return compact(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function mergeNegativePromptFragments(
  ...fragments: Array<string | string[] | null | undefined>
): string | null {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const fragment of fragments.flatMap((value) => (Array.isArray(value) ? value : [value]))) {
    const normalized = compact(fragment ?? '');
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values.length ? values.join(', ') : null;
}

function dependency(
  kind: VisualPromptDependency['kind'],
  key: string,
  id: string,
  revision: number,
  fingerprint: string,
): ProfileDependencyInput {
  return { kind, key, revisionId: id, revision, fingerprint };
}

function characterById(blueprint: StoryBlueprint | null, characterId: string | null) {
  return characterId
    ? (blueprint?.characters.find((character) => character.id === characterId) ?? null)
    : null;
}

function renderCharacterFragment(
  character: SceneCharacterDto,
  profile: CharacterVisualProfileDto | null,
  canonical: StoryCharacter | null,
): string {
  const profilePayload = profile?.payload;
  const variant = profilePayload?.variants.find(
    (item) => item.key === character.visualState.variantKey,
  );
  const canonicalParts = profilePayload
    ? [
        profilePayload.ageAppearance,
        profilePayload.genderPresentation,
        profilePayload.bodyType,
        profilePayload.heightDescription,
        profilePayload.faceShape,
        profilePayload.skinTone,
        profilePayload.hairStyle,
        profilePayload.hairColor,
        profilePayload.eyeDescription,
        ...profilePayload.distinctiveFeatures,
        profilePayload.defaultClothing,
        ...profilePayload.clothingDetails,
        ...profilePayload.accessories,
        ...profilePayload.colorIdentity,
        ...profilePayload.visualKeywords,
        profilePayload.styleNotes,
      ]
    : [canonical?.appearance ?? ''];
  const sceneParts = [
    character.roleInScene,
    character.visualState.variantKey
      ? `variant: ${variant?.description ?? character.visualState.variantKey}`
      : '',
    character.visualState.clothing,
    character.visualState.injuries.map((item) => `scene injury: ${item}`),
    character.visualState.expression,
    character.visualState.pose,
    character.visualState.action,
    character.visualState.position,
    character.visualState.heldObjects,
    character.visualState.appearanceOverride,
  ];
  return bounded(
    [character.displayName, ...canonicalParts, ...sceneParts.flat(2)].filter(Boolean).join(', '),
    3_000,
  );
}

function resolveCharacter(
  character: SceneCharacterDto,
  input: VisualPromptBuildInput,
  issues: VisualConsistencyIssue[],
  dependencies: ProfileDependencyInput[],
) {
  const canonical = characterById(input.blueprint, character.characterId);
  const storedProfile = character.characterId
    ? input.profiles.getCharacter(input.projectId, character.characterId)
    : null;
  const profile = storedProfile?.status === 'APPROVED' ? storedProfile : null;
  const variant =
    profile?.payload.variants.find((item) => item.key === character.visualState.variantKey) ?? null;
  if (!character.characterId || !canonical) {
    issues.push(
      visualConsistencyIssueSchema.parse({
        type: 'UNRESOLVED_REFERENCE',
        message: `Character reference '${character.displayName}' is not linked to the current Story blueprint.`,
        reference: character.displayName,
        severity: 'FAIL',
      }),
    );
  }
  if (!profile) {
    issues.push(
      visualConsistencyIssueSchema.parse({
        type: 'MISSING_PROFILE',
        message: storedProfile
          ? `Character profile for '${character.displayName}' is awaiting approval.`
          : `Character profile is missing for '${character.displayName}'.`,
        reference: character.characterId ?? character.displayName,
        severity: 'FAIL',
      }),
    );
  } else {
    dependencies.push(
      dependency(
        'CHARACTER_PROFILE',
        character.characterId ?? character.displayName,
        profile.id,
        profile.revision,
        profile.inputFingerprint,
      ),
    );
    if (profile.status === 'STALE')
      issues.push(
        visualConsistencyIssueSchema.parse({
          type: 'STALE_DEPENDENCY',
          message: `Character profile '${character.displayName}' is stale.`,
          reference: profile.id,
          severity: 'WARN',
        }),
      );
    if (character.visualState.variantKey && !variant)
      issues.push(
        visualConsistencyIssueSchema.parse({
          type: 'CHARACTER_APPEARANCE_CONFLICT',
          message: `Character variant '${character.visualState.variantKey}' is not defined.`,
          reference: character.displayName,
          severity: 'WARN',
        }),
      );
  }
  const canonicalAppearance = profile
    ? characterVisualProfilePayloadSchema.parse(profile.payload)
    : null;
  return resolvedCharacterVisualSchema.parse({
    characterId: character.characterId,
    displayName: character.displayName,
    profileId: profile?.id ?? null,
    profileRevision: profile?.revision ?? null,
    profileFingerprint: profile?.inputFingerprint ?? null,
    variantKey: character.visualState.variantKey || null,
    variantRevision: variant?.revision ?? null,
    canonicalAppearance,
    sceneVisualState: sceneCharacterVisualStateSchema.parse(character.visualState),
    resolvedPromptFragment: renderCharacterFragment(character, profile, canonical),
    resolutionStatus:
      !character.characterId || !canonical ? 'UNRESOLVED' : profile ? 'RESOLVED' : 'MISSING',
  });
}

type ResolvedLocationResult = {
  value: ResolvedLocationVisual;
  profile: LocationVisualProfileDto | null;
};

function resolveLocation(
  input: VisualPromptBuildInput,
  issues: VisualConsistencyIssue[],
  dependencies: ProfileDependencyInput[],
): ResolvedLocationResult {
  let location: LocationDto | null = input.scene.locationId
    ? (input
        .locationMatches?.(input.projectId, input.scene.location ?? '')
        ?.find((item) => item.id === input.scene.locationId) ?? null)
    : null;
  let ambiguous = false;
  if (!location && input.scene.location && input.locationMatches) {
    const matches = input.locationMatches(input.projectId, input.scene.location);
    location = matches.length === 1 ? matches[0]! : null;
    ambiguous = matches.length > 1;
    if (ambiguous)
      issues.push(
        visualConsistencyIssueSchema.parse({
          type: 'UNRESOLVED_REFERENCE',
          message: `Location '${input.scene.location}' matches multiple project locations.`,
          reference: input.scene.location,
          severity: 'FAIL',
        }),
      );
  }
  if (!location && input.scene.location && !ambiguous)
    issues.push(
      visualConsistencyIssueSchema.parse({
        type: 'UNRESOLVED_REFERENCE',
        message: `Location '${input.scene.location}' is not linked to a project location.`,
        reference: input.scene.location,
        severity: 'FAIL',
      }),
    );
  const storedProfile = location ? input.profiles.getLocation(input.projectId, location.id) : null;
  const profile = storedProfile?.status === 'APPROVED' ? storedProfile : null;
  if (location && !profile)
    issues.push(
      visualConsistencyIssueSchema.parse({
        type: 'MISSING_PROFILE',
        message: storedProfile
          ? `Location profile for '${location.name}' is awaiting approval.`
          : `Location profile is missing for '${location.name}'.`,
        reference: location.id,
        severity: 'FAIL',
      }),
    );
  if (profile) {
    dependencies.push(
      dependency(
        'LOCATION_PROFILE',
        profile.locationId,
        profile.id,
        profile.revision,
        profile.inputFingerprint,
      ),
    );
    if (profile.status === 'STALE')
      issues.push(
        visualConsistencyIssueSchema.parse({
          type: 'STALE_DEPENDENCY',
          message: `Location profile '${profile.locationName}' is stale.`,
          reference: profile.id,
          severity: 'WARN',
        }),
      );
  }
  const canonicalAppearance = profile
    ? locationVisualProfilePayloadSchema.parse(profile.payload)
    : null;
  const name = location?.name ?? input.scene.location ?? '';
  const state = {
    timeOfDay: input.scene.timeOfDay,
    weather: input.scene.weather,
    lighting: input.scene.lighting,
    visualDescription: input.scene.visualDescription,
  };
  const fragment = bounded(
    [
      name,
      canonicalAppearance?.environmentType,
      canonicalAppearance?.overallDescription,
      canonicalAppearance?.architecture,
      canonicalAppearance?.terrain,
      canonicalAppearance?.vegetation,
      canonicalAppearance?.weatherDefaults,
      state.timeOfDay,
      state.weather,
      state.lighting,
      state.visualDescription,
      canonicalAppearance?.atmosphere,
      ...(canonicalAppearance?.visualKeywords ?? []),
    ]
      .filter(Boolean)
      .join(', '),
    4_000,
  );
  return {
    value: resolvedLocationVisualSchema.parse({
      locationId: location?.id ?? null,
      name,
      profileId: profile?.id ?? null,
      profileRevision: profile?.revision ?? null,
      profileFingerprint: profile?.inputFingerprint ?? null,
      canonicalAppearance,
      sceneEnvironmentState: state,
      resolvedPromptFragment: fragment,
      resolutionStatus: location
        ? profile
          ? 'RESOLVED'
          : 'MISSING'
        : input.scene.location
          ? 'UNRESOLVED'
          : 'MISSING',
    }),
    profile,
  };
}

type ResolvedObjectResult = {
  sourceLabel: string;
  objectKey: string;
  profile: VisualObjectProfileDto | null;
  resolutionStatus: 'RESOLVED' | 'UNRESOLVED' | 'MISSING';
};

function resolveObjects(
  input: VisualPromptBuildInput,
  issues: VisualConsistencyIssue[],
  dependencies: ProfileDependencyInput[],
): ResolvedObjectResult[] {
  const explicit = new Map(
    input.objectResolutions
      .list(input.projectId, input.scene.id)
      .map((item) => [item.normalizedKey, item]),
  );
  const result: ResolvedObjectResult[] = [];
  for (const sourceLabel of input.scene.importantObjects) {
    const objectKey = normalizeVisualKey(sourceLabel);
    const mapping = explicit.get(objectKey);
    const exactProfile = mapping
      ? mapping.visualObjectProfileId
        ? input.profiles.getObjectById(input.projectId, mapping.visualObjectProfileId)
        : null
      : input.profiles.getObject(input.projectId, objectKey);
    const nameMatches =
      !mapping && !exactProfile
        ? input.profiles.listObjectsByName(input.projectId, sourceLabel)
        : [];
    const profileCandidate = exactProfile ?? (nameMatches.length === 1 ? nameMatches[0]! : null);
    const profile = profileCandidate?.status === 'APPROVED' ? profileCandidate : null;
    const resolutionStatus: ResolvedObjectResult['resolutionStatus'] = profile
      ? 'RESOLVED'
      : nameMatches.length > 1 || mapping?.resolutionStatus === 'AMBIGUOUS'
        ? 'UNRESOLVED'
        : 'MISSING';
    if (nameMatches.length > 1)
      issues.push(
        visualConsistencyIssueSchema.parse({
          type: 'OBJECT_CONFLICT',
          message: `Recurring object '${sourceLabel}' matches multiple canonical profiles.`,
          reference: sourceLabel,
          severity: 'WARN',
        }),
      );
    if (!profile) {
      issues.push(
        visualConsistencyIssueSchema.parse({
          type:
            mapping?.resolutionStatus === 'AMBIGUOUS' ? 'UNRESOLVED_REFERENCE' : 'MISSING_PROFILE',
          message: profileCandidate
            ? `Recurring object profile for '${sourceLabel}' is awaiting approval.`
            : `Recurring object profile is unresolved for '${sourceLabel}'.`,
          reference: sourceLabel,
          severity: 'WARN',
        }),
      );
    } else {
      dependencies.push(
        dependency(
          'OBJECT_PROFILE',
          profile.objectKey,
          profile.id,
          profile.revision,
          profile.inputFingerprint,
        ),
      );
      if (profile.status === 'STALE')
        issues.push(
          visualConsistencyIssueSchema.parse({
            type: 'STALE_DEPENDENCY',
            message: `Object profile '${profile.name}' is stale.`,
            reference: profile.id,
            severity: 'WARN',
          }),
        );
    }
    result.push({
      sourceLabel,
      objectKey: profile?.objectKey ?? profileCandidate?.objectKey ?? objectKey,
      profile,
      resolutionStatus,
    });
  }
  return result;
}

function objectFragment(profile: VisualObjectProfileDto): string {
  return bounded(
    [
      profile.name,
      profile.payload.description,
      profile.payload.shape,
      profile.payload.materials,
      profile.payload.colors,
      profile.payload.distinctiveFeatures,
      profile.payload.condition,
      profile.payload.visualKeywords,
      profile.payload.styleNotes,
    ]
      .flat(2)
      .filter(Boolean)
      .join(', '),
    3_000,
  );
}

function styleFragment(style: VisualStyleSettingsDto | null): string {
  if (!style) return '';
  return bounded(
    [
      style.styleName,
      style.styleDescription,
      style.medium,
      style.realism,
      style.overallStyle,
      style.colorPalette,
      style.cinematicStyle,
      style.cinematicLanguage,
      style.lightingStyle,
      style.textureStyle,
      style.environmentStyle,
      style.characterRenderingStyle,
      style.cameraStyle,
      style.compositionStyle,
      style.moodKeywords,
    ]
      .flat(2)
      .filter(Boolean)
      .join(', '),
    3_000,
  );
}

function cameraCompositionLanguage(scene: SceneDto): string {
  const framing: Record<SceneDto['camera']['framing'], string> = {
    EXTREME_WIDE: 'extreme wide establishing shot',
    WIDE: 'wide shot',
    FULL: 'full-body shot',
    MEDIUM: 'medium shot',
    CLOSE_UP: 'close-up',
    EXTREME_CLOSE_UP: 'extreme close-up',
    OVER_THE_SHOULDER: 'over-the-shoulder shot',
    POV: 'point-of-view shot',
  };
  const composition = scene.composition;
  return [
    framing[scene.camera.framing],
    scene.camera.angle ? `${scene.camera.angle} angle` : '',
    scene.camera.movementIntent ? `camera ${scene.camera.movementIntent}` : '',
    composition.subjectFocus ? `focus on ${composition.subjectFocus}` : '',
    composition.foreground.length ? `foreground: ${composition.foreground.join(', ')}` : '',
    composition.midground.length ? `midground: ${composition.midground.join(', ')}` : '',
    composition.background.length ? `background: ${composition.background.join(', ')}` : '',
    ...composition.characterPositions.map(
      (position) => `${position.displayName} positioned ${position.position}`,
    ),
  ]
    .filter(Boolean)
    .join(', ');
}

export function visualPromptPackageFingerprint(input: unknown): string {
  return fingerprintValue({ template: VISUAL_PROMPT_TEMPLATE_VERSION, input });
}

export function missingVisualPromptConstraints(
  payload: VisualPromptPackagePayload,
  fullPrompt: string,
  negativePrompt: string | null,
): string[] {
  const requiredPromptFragments = [
    ...payload.characters.map((character) => character.displayName),
    payload.location.name,
    ...payload.objects.map((object) => object.sourceLabel),
    payload.style?.styleName ?? '',
    payload.style?.overallStyle ?? '',
  ]
    .map((value) => compact(value))
    .filter(Boolean);
  const normalizedPrompt = fullPrompt.toLocaleLowerCase('en-US');
  const missing = requiredPromptFragments
    .filter((fragment) => !normalizedPrompt.includes(fragment.toLocaleLowerCase('en-US')))
    .map((fragment) => `prompt:${fragment}`);
  const requiredNegatives = (payload.negativePrompt ?? '')
    .split(',')
    .map((value) => compact(value))
    .filter(Boolean);
  const normalizedNegativePrompt = negativePrompt?.toLocaleLowerCase('en-US') ?? '';
  missing.push(
    ...requiredNegatives
      .filter((fragment) => !normalizedNegativePrompt.includes(fragment.toLocaleLowerCase('en-US')))
      .map((fragment) => `negative:${fragment}`),
  );
  return [...new Set(missing)];
}

export function buildVisualPromptPackage(input: VisualPromptBuildInput): VisualPromptBuildResult {
  const issues: VisualConsistencyIssue[] = [];
  const dependencies: ProfileDependencyInput[] = [];
  const characters = input.scene.characters.map((character) =>
    resolveCharacter(character, input, issues, dependencies),
  );
  const location = resolveLocation(input, issues, dependencies);
  const resolvedObjects = resolveObjects(input, issues, dependencies);
  if (input.style)
    dependencies.push(
      dependency(
        'STYLE_BIBLE',
        input.style.projectId,
        input.style.id,
        input.style.revision,
        input.style.inputFingerprint,
      ),
    );
  const objects = resolvedObjects.map(({ sourceLabel, objectKey, profile, resolutionStatus }) =>
    resolvedObjectVisualSchema.parse({
      sourceLabel,
      objectKey: bounded(objectKey, 120),
      profileId: profile?.id ?? null,
      profileRevision: profile?.revision ?? null,
      profileFingerprint: profile?.inputFingerprint ?? null,
      canonicalAppearance: profile?.payload ?? null,
      resolvedPromptFragment: profile ? objectFragment(profile) : bounded(sourceLabel, 3_000),
      resolutionStatus,
    }),
  );
  if (!input.style)
    issues.push(
      visualConsistencyIssueSchema.parse({
        type: 'STYLE_CONFLICT',
        message: 'Style Bible is missing for this project.',
        reference: input.projectId,
        severity: 'FAIL',
      }),
    );
  const styleText = styleFragment(input.style);
  const characterText = characters
    .map((item) => item.resolvedPromptFragment)
    .filter(Boolean)
    .join('; ');
  const objectText = objects
    .map((item) => item.resolvedPromptFragment)
    .filter(Boolean)
    .join('; ');
  const subjectAction = bounded(input.scene.visualDescription, 2_000);
  const fullPrompt = [
    `Subject/action: ${subjectAction}`,
    characterText ? `Characters: ${characterText}` : '',
    location.value.resolvedPromptFragment
      ? `Location: ${location.value.resolvedPromptFragment}`
      : '',
    objectText ? `Objects: ${objectText}` : '',
    `Camera/composition: ${cameraCompositionLanguage(input.scene)}`,
    `Lighting/mood: ${input.scene.lighting}; ${input.scene.mood}; ${input.scene.colorMood}`,
    styleText ? `Style Bible: ${styleText}` : '',
    input.style?.positivePromptSuffix || input.style?.promptSuffix
      ? `Positive suffix: ${input.style.positivePromptSuffix || input.style.promptSuffix}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const negativePrompt = mergeNegativePromptFragments(
    input.style?.negativePrompt,
    input.scene.negativePrompt,
    characters.flatMap((item) => item.canonicalAppearance?.negativeTraits ?? []),
    location.value.canonicalAppearance?.negativeTraits,
    objects.flatMap((item) => item.canonicalAppearance?.negativeTraits ?? []),
  );
  const status = issues.some((issue) => issue.severity === 'FAIL')
    ? 'FAIL'
    : issues.length
      ? 'WARN'
      : 'PASS';
  const dependencyValues = dependencies.map((item) => item as VisualPromptDependency);
  const fingerprintInput = {
    sceneRevisionId: input.scene.id,
    sceneRevision: input.scene.revision,
    scene: input.scene,
    characters,
    location: location.value,
    objects,
    style: input.style,
    dependencies: dependencyValues,
    template: VISUAL_PROMPT_TEMPLATE_VERSION,
  };
  const inputFingerprint = visualPromptPackageFingerprint(fingerprintInput);
  const stylePayload = input.style
    ? visualStyleSettingsSchema.parse({
        styleName: input.style.styleName,
        styleDescription: input.style.styleDescription,
        medium: input.style.medium,
        realism: input.style.realism,
        overallStyle: input.style.overallStyle,
        colorPalette: input.style.colorPalette,
        cinematicStyle: input.style.cinematicStyle,
        cinematicLanguage: input.style.cinematicLanguage,
        lightingStyle: input.style.lightingStyle,
        textureStyle: input.style.textureStyle,
        environmentStyle: input.style.environmentStyle,
        characterRenderingStyle: input.style.characterRenderingStyle,
        cameraStyle: input.style.cameraStyle,
        compositionStyle: input.style.compositionStyle,
        moodKeywords: input.style.moodKeywords,
        aspectRatio: input.style.aspectRatio,
        promptSuffix: input.style.promptSuffix,
        positivePromptSuffix: input.style.positivePromptSuffix,
        negativePrompt: input.style.negativePrompt,
        referenceAssetIds: input.style.referenceAssetIds,
      })
    : null;
  const payload = visualPromptPackagePayloadSchema.parse({
    sceneId: input.scene.id,
    sceneStableId: input.scene.stableId,
    sceneRevision: input.scene.revision,
    styleRevision: input.style?.revision ?? null,
    style: stylePayload,
    characters,
    location: location.value,
    objects,
    visualDescription: input.scene.visualDescription,
    subjectAction,
    camera: input.scene.camera,
    composition: input.scene.composition,

    lighting: input.scene.lighting,
    mood: `${input.scene.mood}; ${input.scene.colorMood}`.trim(),
    fullPrompt: bounded(fullPrompt, 8_000),
    negativePrompt,
    refinedPrompt: null,
    consistencyStatus: status,
    consistencyIssues: issues.slice(0, 50),
    dependencies: dependencyValues,
    inputFingerprint,
    promptTemplateVersion: VISUAL_PROMPT_TEMPLATE_VERSION,
  });
  return { package: payload, inputFingerprint };
}
export type ShotVisualPromptBuildInput = VisualPromptBuildInput & {
  shot: Shot;
  referenceBindings: ReferenceBinding[];
};

const shotFramingToScene: Record<Shot['staticIntent']['framing'], SceneDto['camera']['framing']> = {
  EXTREME_CLOSE_UP: 'EXTREME_CLOSE_UP',
  CLOSE_UP: 'CLOSE_UP',
  MEDIUM: 'MEDIUM',
  WIDE: 'WIDE',
  EXTREME_WIDE: 'EXTREME_WIDE',
};

function replaceOffscreenNames(scene: SceneDto, shot: Shot, value: string): string {
  const offscreenNames = scene.characters
    .filter(
      (character) =>
        character.characterId && shot.offscreenCharacterIds.includes(character.characterId),
    )
    .map((character) => character.displayName)
    .sort((left, right) => right.length - left.length);
  return offscreenNames.reduce(
    (text, name) => text.replaceAll(name, 'off-camera direction'),
    value,
  );
}

export function orderReferenceBindings(
  framing: Shot['staticIntent']['framing'],
  bindings: ReferenceBinding[],
): ReferenceBinding[] {
  const roleWeight: Record<ReferenceBinding['role'], number> =
    framing === 'WIDE' || framing === 'EXTREME_WIDE'
      ? { LOCATION: 0, PRIMARY_CHARACTER: 1, CHARACTER: 2, OBJECT: 3 }
      : framing === 'CLOSE_UP' || framing === 'EXTREME_CLOSE_UP'
        ? { PRIMARY_CHARACTER: 0, CHARACTER: 1, LOCATION: 2, OBJECT: 3 }
        : { PRIMARY_CHARACTER: 0, LOCATION: 1, CHARACTER: 2, OBJECT: 3 };
  return [...bindings]
    .sort(
      (left, right) =>
        roleWeight[left.role] - roleWeight[right.role] ||
        left.entityId.localeCompare(right.entityId) ||
        left.assetId.localeCompare(right.assetId),
    )
    .map((binding, index) => ({ ...binding, ordinal: index + 1 }));
}

export function buildShotVisualPromptPackage(
  input: ShotVisualPromptBuildInput,
): VisualPromptBuildResult {
  const visibleCharacters = input.scene.characters.filter(
    (character) =>
      character.characterId !== null &&
      input.shot.visibleCharacterIds.includes(character.characterId),
  );
  const staticDescription = replaceOffscreenNames(
    input.scene,
    input.shot,
    [
      input.shot.staticIntent.subject,
      input.shot.staticIntent.action,
      input.shot.staticIntent.pose,
      input.shot.staticIntent.expression,
      input.shot.staticIntent.relationship,
      input.shot.staticIntent.composition,
      input.shot.staticIntent.atmosphere,
    ]
      .filter(Boolean)
      .join(', '),
  );
  const visibleComposition = {
    ...input.scene.composition,
    foreground: input.scene.composition.foreground.map((value) =>
      replaceOffscreenNames(input.scene, input.shot, value),
    ),
    midground: input.scene.composition.midground.map((value) =>
      replaceOffscreenNames(input.scene, input.shot, value),
    ),
    background: input.scene.composition.background.map((value) =>
      replaceOffscreenNames(input.scene, input.shot, value),
    ),
    subjectFocus: replaceOffscreenNames(
      input.scene,
      input.shot,
      input.scene.composition.subjectFocus,
    ),
    characterPositions: input.scene.composition.characterPositions.filter(
      (position) =>
        position.characterId !== null &&
        input.shot.visibleCharacterIds.includes(position.characterId),
    ),
  };
  const result = buildVisualPromptPackage({
    ...input,
    scene: {
      ...input.scene,
      characters: visibleCharacters,
      visualDescription: staticDescription,
      summary: '',
      composition: visibleComposition,
      camera: {
        framing: shotFramingToScene[input.shot.staticIntent.framing],
        angle: input.shot.staticIntent.angle || null,
        movementIntent: null,
      },
      lighting: input.shot.staticIntent.lighting,
      colorMood: input.shot.staticIntent.colorMood,
    },
  });
  const visibleIds = new Set(input.shot.visibleCharacterIds);
  const referenceBindings = orderReferenceBindings(
    input.shot.staticIntent.framing,
    input.referenceBindings.filter(
      (binding) =>
        (binding.role !== 'CHARACTER' && binding.role !== 'PRIMARY_CHARACTER') ||
        visibleIds.has(binding.entityId),
    ),
  );
  const payload = visualPromptPackagePayloadSchema.parse({
    ...result.package,
    shotId: input.shot.id,
    shotRevision: 1,
    visibleCharacterIds: input.shot.visibleCharacterIds,
    offscreenCharacterIds: input.shot.offscreenCharacterIds,
    staticIntent: input.shot.staticIntent,
    dynamicIntent: input.shot.dynamicIntent,
    continuityState: input.shot.initialState,
    referenceBindings,
    fullPrompt: [
      result.package.fullPrompt,
      ...referenceBindings.map(
        (binding) =>
          `[REF_${binding.ordinal}] ${binding.role.toLocaleLowerCase('en-US').replaceAll('_', ' ')} ${binding.entityId}`,
      ),
    ].join('\n'),
  });
  const inputFingerprint = visualPromptPackageFingerprint({
    ...payload,
    inputFingerprint: undefined,
  });
  return {
    package: visualPromptPackagePayloadSchema.parse({ ...payload, inputFingerprint }),
    inputFingerprint,
  };
}

export function validateReferencePlaceholderRewrite(
  original: string,
  rewritten: string,
  bindings: ReferenceBinding[],
): boolean {
  const expected = bindings.map((binding) => `[REF_${binding.ordinal}]`).sort();
  const placeholders = (value: string) => value.match(/\[REF_\d+\]/gu)?.sort() ?? [];
  return (
    JSON.stringify(placeholders(original)) === JSON.stringify(expected) &&
    JSON.stringify(placeholders(rewritten)) === JSON.stringify(expected)
  );
}
