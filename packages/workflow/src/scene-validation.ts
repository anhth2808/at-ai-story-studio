import { createHash } from 'node:crypto';
import {
  AppError,
  parseStoryOperationOutput,
  scenePlanningEnvelopeSchema,
  scenePromptEnvelopeSchema,
  sceneRegenerationEnvelopeSchema,
  sceneSourceRangeSchema,
  type SceneDto,
  type ScenePlanItem,
  type StoryBlueprint,
} from '@studio/shared';
import type { SceneCharacterPersistence } from '@studio/database';

function validationError(message: string): AppError {
  return new AppError('SCENE_OUTPUT_INVALID', message, 422, false);
}

function normalizeReference(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function dependencyFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateSceneItems(
  scenes: ScenePlanItem[],
  chapterLength: number,
  requireContiguous = true,
): ScenePlanItem[] {
  const ordered = [...scenes];
  for (let index = 0; index < ordered.length; index += 1) {
    const scene = ordered[index]!;
    if (requireContiguous && scene.sceneNumber !== index + 1)
      throw validationError('Scene numbers must be contiguous and start at one');
    const range = sceneSourceRangeSchema.parse(scene.sourceRange);
    if (range.end > chapterLength)
      throw validationError('Scene source range exceeds the chapter UTF-16 length');
    if (!scene.imagePrompt.trim())
      throw validationError('Every scene must include an image prompt');
    if (index > 0) {
      const prior = ordered[index - 1]!;
      if (prior.sourceRange.start > range.start)
        throw validationError('Scene source ranges must be ordered');
      if (prior.sourceRange.end > range.start)
        throw validationError('Scene source ranges must not overlap');
    }
  }
  return ordered;
}

export function validateScenePlanningOutput(text: string, chapterLength: number): ScenePlanItem[] {
  const value = parseStoryOperationOutput('SCENE_PLANNING', text);
  const envelope = scenePlanningEnvelopeSchema.parse(value);
  return validateSceneItems(envelope.scenes, chapterLength);
}

export function validateSceneRegenerationOutput(
  text: string,
  chapterLength: number,
  currentScene: SceneDto,
): ScenePlanItem {
  const value = parseStoryOperationOutput('SCENE_REGENERATION', text);
  const envelope = sceneRegenerationEnvelopeSchema.parse(value);
  const [scene] = validateSceneItems([envelope.scene], chapterLength, false);
  if (!scene) throw validationError('Scene regeneration output is empty');
  if (scene.sceneNumber !== currentScene.sceneNumber)
    throw validationError('Scene regeneration cannot change scene order');
  if (
    scene.sourceRange.start !== currentScene.sourceRange.start ||
    scene.sourceRange.end !== currentScene.sourceRange.end
  )
    throw validationError('Scene regeneration cannot change its anchored source range');
  return scene;
}

export function validateScenePromptOutput(text: string): {
  imagePrompt: string;
  negativePrompt: string | null;
} {
  const value = parseStoryOperationOutput('SCENE_PROMPT', text);
  const prompt = scenePromptEnvelopeSchema.parse(value);
  if (!prompt.imagePrompt.trim())
    throw validationError('Prompt refresh must return an image prompt');
  return prompt;
}

export function resolveSceneCharacters(
  scene: ScenePlanItem,
  blueprint: StoryBlueprint | null,
): {
  characters: SceneCharacterPersistence[];
  unresolvedReferences: string[];
} {
  const canonical = blueprint?.characters ?? [];
  const unresolvedReferences: string[] = [];
  const unresolved = new Set<string>();
  const addUnresolved = (value: string): void => {
    const normalized = value.trim();
    if (normalized && !unresolved.has(normalized)) {
      unresolved.add(normalized);
      unresolvedReferences.push(normalized);
    }
  };
  const characters = scene.characters.map((character) => {
    const candidates = character.characterId
      ? canonical.filter((candidate) => candidate.id === character.characterId)
      : canonical.filter(
          (candidate) =>
            normalizeReference(candidate.name) === normalizeReference(character.displayName),
        );
    const resolved = candidates.length === 1 ? candidates[0] : undefined;
    if (!resolved) addUnresolved(character.characterId ?? character.displayName);
    return {
      characterId: resolved?.id ?? null,
      displayName: character.displayName,
      roleInScene: character.roleInScene,
      visualState: character.visualState,
      resolutionStatus: resolved ? ('RESOLVED' as const) : ('UNRESOLVED' as const),
      dependencyFingerprint: resolved ? dependencyFingerprint(resolved) : null,
    };
  });
  for (const position of scene.composition.characterPositions) {
    const idKnown = position.characterId
      ? characters.some((character) => character.characterId === position.characterId)
      : characters.some(
          (character) =>
            normalizeReference(character.displayName) === normalizeReference(position.displayName),
        );
    if (!idKnown) addUnresolved(position.characterId ?? position.displayName);
  }
  return { characters, unresolvedReferences };
}

export function sceneContinuityWarnings(scene: ScenePlanItem, currentScene?: SceneDto): string[] {
  if (!currentScene) return [];
  const warnings: string[] = [];
  const currentNames = new Set(
    currentScene.characters.map((character) => normalizeReference(character.displayName)),
  );
  const nextNames = new Set(
    scene.characters.map((character) => normalizeReference(character.displayName)),
  );
  for (const name of currentNames) {
    if (!nextNames.has(name)) warnings.push(`Character continuity changed: ${name}`);
  }
  if (scene.location !== currentScene.location)
    warnings.push('Location continuity changed; review the regenerated scene');
  return warnings;
}
