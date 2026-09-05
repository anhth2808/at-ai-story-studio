import type {
  CharacterAppearanceStagePayload,
  CharacterVisualProfileDto,
  LocationHardGeometry,
  VisualStyleSettingsDto,
} from '@studio/shared';
import { fingerprintValue, stableSerialize } from './story-prompts.js';

export type AppearanceStageProposal = {
  name: string;
  payload: CharacterAppearanceStagePayload;
  confidence: number;
  reason: string;
};

const wardrobeRules: Array<{
  cue: RegExp;
  name: string;
  clothing: string;
  reason: string;
}> = [
  {
    cue: /\b(pajamas?|sleepwear|nightgown|bedclothes)\b/iu,
    name: 'Sleepwear',
    clothing: 'story-specified sleepwear',
    reason: 'Explicit sleep clothing context',
  },
  {
    cue: /\b(winter coat|snow gear|heavy coat|blizzard)\b/iu,
    name: 'Cold weather',
    clothing: 'weather-appropriate winter clothing',
    reason: 'Strong cold-weather clothing context',
  },
  {
    cue: /\b(formal wear|evening gown|tuxedo|wedding attire|gala attire)\b/iu,
    name: 'Formal attire',
    clothing: 'story-specified formal attire',
    reason: 'Explicit formal clothing context',
  },
  {
    cue: /\b(hospital gown|patient gown|medical gown)\b/iu,
    name: 'Patient attire',
    clothing: 'hospital patient clothing',
    reason: 'Explicit patient clothing context',
  },
  {
    cue: /\b(?:changes into|dresses in|puts on|wearing)\s+(?:(?:an?|the|her|his|their|some)\s+)?(?:[A-Za-z-]+\s+){0,3}(?:coat|dress|gown|tuxedo|suit|shirt|trousers|pants|skirt|jeans|uniform|pajamas?|sleepwear|robe|jacket|boots|shoes|gloves|scarf|hat|helmet|armor|attire|clothing)\b/iu,
    name: 'Changed attire',
    clothing: 'explicitly described changed clothing',
    reason: 'Explicit clothing-change action',
  },
];

export function inferAppearanceStage(evidence: string): AppearanceStageProposal | null {
  const normalized = evidence.trim().slice(0, 4_000);
  const rule = wardrobeRules.find((entry) => entry.cue.test(normalized));
  return rule
    ? {
        name: rule.name,
        payload: { clothing: [rule.clothing], accessories: [], equipment: [] },
        confidence: 0.9,
        reason: rule.reason,
      }
    : null;
}

function styleText(style: VisualStyleSettingsDto | null): string {
  return style
    ? [
        style.medium,
        style.overallStyle,
        style.colorPalette,
        style.cinematicStyle,
        style.textureStyle,
        style.characterRenderingStyle,
      ]
        .filter(Boolean)
        .join(', ')
    : 'project visual style';
}

export function compileCharacterPrototypePrompt(
  profile: CharacterVisualProfileDto,
  style: VisualStyleSettingsDto | null,
): { prompt: string; inputFingerprint: string } {
  const identity = profile.payload;
  const prompt = [
    styleText(style),
    'canonical character model sheet on a neutral plain background',
    'ordinary simple clothing, no props, no scenery',
    'three full-body orientations: front, side, back',
    'one frontal face close-up',
    [
      identity.ageAppearance,
      identity.genderPresentation,
      identity.bodyType,
      identity.heightDescription,
      identity.faceShape,
      identity.skinTone,
      identity.hairStyle,
      identity.hairColor,
      identity.eyeDescription,
      ...identity.distinctiveFeatures,
      ...identity.colorIdentity,
      ...identity.visualKeywords,
    ]
      .filter(Boolean)
      .join(', '),
    'consistent identity and proportions across every panel',
  ]
    .filter(Boolean)
    .join('. ');
  return {
    prompt,
    inputFingerprint: fingerprintValue({
      kind: 'CHARACTER_PROTOTYPE',
      profileId: profile.id,
      profileRevision: profile.revision,
      styleRevision: style?.revision ?? null,
      prompt,
    }),
  };
}

export function compileAppearanceStagePrompt(
  profile: CharacterVisualProfileDto,
  stage: CharacterAppearanceStagePayload,
  prototype: { assetId: string; sha256: string },
  style: VisualStyleSettingsDto | null,
): { prompt: string; inputFingerprint: string } {
  const prompt = [
    styleText(style),
    'preserve the exact identity and body proportions from reference image 1',
    `change clothing only: ${stage.clothing.join(', ') || 'unchanged'}`,
    `accessories only: ${stage.accessories.join(', ') || 'none'}`,
    `equipment only: ${stage.equipment.join(', ') || 'none'}`,
    'neutral plain background, full-body front view, no action, no emotion change',
  ].join('. ');
  return {
    prompt,
    inputFingerprint: fingerprintValue({
      kind: 'CHARACTER_STAGE',
      profileId: profile.id,
      profileRevision: profile.revision,
      stage,
      prototype,
      styleRevision: style?.revision ?? null,
      prompt,
    }),
  };
}

export function compileLocationReferencePrompt(
  locationId: string,
  revision: number,
  geometry: LocationHardGeometry,
  style: VisualStyleSettingsDto | null,
): { prompt: string; inputFingerprint: string } {
  const prompt = [
    styleText(style),
    'canonical empty location reference, no people, no characters, no temporary props',
    geometry.environmentType,
    geometry.architecture,
    geometry.spatialLayout,
    geometry.walls,
    geometry.windows,
    geometry.doors,
    geometry.fixedFurniture.join(', '),
    geometry.terrain,
    geometry.permanentLandmarks.join(', '),
    'neutral daylight revealing permanent geometry clearly',
  ]
    .filter(Boolean)
    .join('. ');
  return {
    prompt,
    inputFingerprint: fingerprintValue({
      kind: 'LOCATION',
      locationId,
      revision,
      geometry: stableSerialize(geometry),
      styleRevision: style?.revision ?? null,
      prompt,
    }),
  };
}
