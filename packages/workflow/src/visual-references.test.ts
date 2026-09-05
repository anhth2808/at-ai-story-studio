import { describe, expect, it } from 'vitest';
import type { CharacterVisualProfileDto, VisualStyleSettingsDto } from '@studio/shared';
import {
  compileAppearanceStagePrompt,
  compileCharacterPrototypePrompt,
  compileLocationReferencePrompt,
  inferAppearanceStage,
} from './visual-references.js';

const profile = {
  id: 'profile-1',
  projectId: 'project-1',
  characterId: 'mai',
  revision: 2,
  status: 'APPROVED',
  payload: {
    ageAppearance: 'adult',
    genderPresentation: 'woman',
    bodyType: 'slim',
    heightDescription: 'average height',
    faceShape: 'oval face',
    skinTone: 'warm complexion',
    hairStyle: 'shoulder-length hair',
    hairColor: 'black',
    eyeDescription: 'brown eyes',
    distinctiveFeatures: ['small scar'],
    defaultClothing: 'plain shirt and trousers',
    clothingDetails: [],
    accessories: [],
    colorIdentity: ['deep blue'],
    defaultExpression: 'neutral',
    visualKeywords: ['grounded'],
    negativeTraits: [],
    styleNotes: '',
    variants: [],
    referenceAssetIds: [],
  },
  promptFragment: '',
  inputFingerprint: 'profile-hash',
  generationId: null,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies CharacterVisualProfileDto;

const style = {
  id: 'style-1',
  projectId: 'project-1',
  revision: 1,
  inputFingerprint: 'style-hash',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  styleName: 'Painted drama',
  styleDescription: '',
  medium: 'hand-painted animation',
  realism: 'stylized',
  overallStyle: 'quiet drama',
  colorPalette: 'muted blue',
  cinematicStyle: 'restrained',
  cinematicLanguage: '',
  lightingStyle: '',
  textureStyle: 'paper grain',
  environmentStyle: '',
  characterRenderingStyle: 'flat color',
  cameraStyle: '',
  compositionStyle: '',
  moodKeywords: [],
  aspectRatio: '16:9',
  promptSuffix: '',
  positivePromptSuffix: '',
  negativePrompt: '',
  referenceAssetIds: [],
} satisfies VisualStyleSettingsDto;

describe('visual reference policy', () => {
  it('infers stages only from strong clothing evidence', () => {
    expect(
      inferAppearanceStage('She puts on a winter coat before crossing the snow.'),
    ).toMatchObject({
      name: 'Cold weather',
    });
    expect(inferAppearanceStage('She feels cold and afraid in the hospital corridor.')).toBeNull();
    expect(inferAppearanceStage('The air is freezing before dawn.')).toBeNull();
    expect(inferAppearanceStage('She puts on before leaving.')).toBeNull();
    expect(inferAppearanceStage('The actor is wearing a smile.')).toBeNull();
    expect(inferAppearanceStage('The room becomes dark and rainy.')).toBeNull();
  });

  it('compiles deterministic style-aware prototype and exact stage prompts', () => {
    const prototype = compileCharacterPrototypePrompt(profile, style);
    expect(prototype.prompt).toContain('three full-body orientations');
    expect(prototype.prompt).toContain('frontal face close-up');
    expect(prototype.prompt).toContain('no props');
    expect(compileCharacterPrototypePrompt(profile, style)).toEqual(prototype);
    const stage = compileAppearanceStagePrompt(
      profile,
      { clothing: ['winter coat'], accessories: [], equipment: [] },
      { assetId: 'prototype-asset', sha256: 'a'.repeat(64) },
      style,
    );
    expect(stage.prompt).toContain('reference image 1');
    expect(stage.prompt).toContain('winter coat');
    expect(stage.prompt).not.toContain('small scar');
  });

  it('keeps canonical location prompts free of transient state and characters', () => {
    const result = compileLocationReferencePrompt(
      'location-1',
      1,
      {
        environmentType: 'courtyard',
        architecture: 'stone arcade',
        spatialLayout: 'square plan',
        walls: 'old stone walls',
        windows: 'arched windows',
        doors: 'oak doors',
        fixedFurniture: ['stone bench'],
        terrain: 'flagstones',
        permanentLandmarks: ['central well'],
      },
      style,
    );
    expect(result.prompt).toContain('no characters');
    expect(result.prompt).toContain('stone arcade');
    expect(result.prompt).not.toMatch(/\brain\b/iu);
    expect(result.prompt).not.toContain('Mai');
  });
});
