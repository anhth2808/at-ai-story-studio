import { createHash } from 'node:crypto';
import {
  aiMotionPlanIntentSchema,
  type AiCameraMotion,
  type AiMotionIntensity,
  type AiMotionPriority,
} from '@studio/shared';
import { IMAGE_TO_VIDEO_V1_MAPPING_VERSION } from './comfyui-video.js';

export type AiMotionPlanSceneInput = {
  sceneNumber: number;
  purpose: string;
  cameraMovementIntent: string | null;
  weather: string;
  mood: string;
  subjectFocus: string;
  characterPositions: Array<{ position?: string }>;
};

export type AiMotionPlanDraft = {
  intent: {
    characterAction: string;
    environmentMotion: string;
    cameraMotion: AiCameraMotion;
    intensity: AiMotionIntensity;
    priority: AiMotionPriority;
  };
  motionPrompt: string;
  negativePrompt: string | null;
  inputFingerprint: string;
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function aiMotionPlanFingerprint(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

// Deterministic camera mapping. Movement intent text wins; purpose only fills
// in when the reviewer left no explicit intent.
function chooseCameraMotion(input: AiMotionPlanSceneInput): AiCameraMotion {
  const intent = (input.cameraMovementIntent ?? '').toLowerCase();
  if (intent) {
    if (intent.includes('push')) return 'PUSH_IN';
    if (intent.includes('pull')) return 'PULL_OUT';
    if (intent.includes('left')) return 'PAN_LEFT';
    if (intent.includes('right')) return 'PAN_RIGHT';
    if (intent.includes('orbit')) return 'ORBIT_SUBTLE';
    if (intent.includes('handheld')) return 'HANDHELD_SUBTLE';
    if (intent.includes('static') || intent.includes('lock')) return 'STATIC';
  }
  if (input.purpose === 'REVEAL' || input.purpose === 'CLIMAX') return 'PUSH_IN';
  return 'STATIC';
}

const INTENSITY_PHRASES: Record<AiMotionIntensity, string> = {
  SUBTLE: 'gentle, restrained motion',
  MEDIUM: 'clear, moderate motion',
  STRONG: 'pronounced, energetic motion',
};

const CAMERA_PHRASES: Record<AiCameraMotion, string> = {
  STATIC: 'the camera stays locked',
  PUSH_IN: 'a very slow subtle push-in toward the subject',
  PULL_OUT: 'a very slow subtle pull-away from the subject',
  PAN_LEFT: 'a slow gentle pan to the left',
  PAN_RIGHT: 'a slow gentle pan to the right',
  ORBIT_SUBTLE: 'a subtle slight orbit around the subject',
  HANDHELD_SUBTLE: 'a barely perceptible handheld sway',
};

function defaultEnvironmentMotion(input: AiMotionPlanSceneInput): string {
  const weather = input.weather.toLowerCase();
  if (weather.includes('fog') || weather.includes('mist')) return 'fog drifting slowly';
  if (weather.includes('rain')) return 'light rain falling steadily';
  if (weather.includes('snow')) return 'snow drifting down softly';
  if (weather.includes('wind') || weather.includes('storm'))
    return 'clothing and dust stirring in the wind';
  return 'the environment stirs faintly, leaves and cloth barely moving';
}

function defaultCharacterAction(input: AiMotionPlanSceneInput): string {
  const purpose = input.purpose;
  if (purpose === 'ACTION' || purpose === 'FIGHT') return 'the subject tenses and shifts weight slowly';
  if (purpose === 'REVEAL') return 'the subject slowly turns toward the reveal';
  if (purpose === 'DEPARTURE' || purpose === 'FAREWELL')
    return 'the subject breathes and holds still, shoulders settling';
  if (purpose === 'ARRIVAL') return 'the subject steps forward slowly then settles';
  return 'the subject breathes calmly with only slight natural movement';
}

export function compileMotionPrompt(
  intent: AiMotionPlanDraft['intent'],
  input: AiMotionPlanSceneInput,
): string {
  const character = intent.characterAction || defaultCharacterAction(input);
  const environment = intent.environmentMotion || defaultEnvironmentMotion(input);
  const camera = CAMERA_PHRASES[intent.cameraMotion];
  const intensity = INTENSITY_PHRASES[intent.intensity];
  return [
    `${character.charAt(0).toLowerCase()}${character.slice(1)}.`,
    `${environment.charAt(0).toUpperCase()}${environment.slice(1)}.`,
    `${camera}; ${intensity}. Keep faces, bodies, clothing, and objects consistent with the input image; avoid sudden movements, morphing, or style changes.`,
  ].join(' ');
}

// Motion prompts deliberately avoid identity text: the accepted scene image
// already fixes appearance. Only what MOVES is described. Conservative
// phrasing keeps short clips stable on consumer GPUs.
export function createDefaultAiMotionPlan(input: AiMotionPlanSceneInput): AiMotionPlanDraft {
  const intent = aiMotionPlanIntentSchema.parse({
    characterAction: defaultCharacterAction(input),
    environmentMotion: defaultEnvironmentMotion(input),
    cameraMotion: chooseCameraMotion(input),
    intensity: 'SUBTLE',
    priority:
      input.purpose === 'CLIMAX' || input.purpose === 'REVEAL'
        ? 'HIGH'
        : input.purpose === 'ACTION'
          ? 'MEDIUM'
          : 'NONE',
  });
  const motionPrompt = compileMotionPrompt(intent, input);
  return {
    intent,
    motionPrompt,
    negativePrompt: null,
    inputFingerprint: aiMotionPlanFingerprint({
      version: IMAGE_TO_VIDEO_V1_MAPPING_VERSION,
      operation: 'AI_MOTION_PLAN',
      sceneNumber: input.sceneNumber,
      purpose: input.purpose,
      intent,
      motionPrompt,
      negativePrompt: null,
    }),
  };
}
