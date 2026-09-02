import type {
  MotionPlan,
  MotionType,
  NormalizedPoint,
  SceneCamera,
  SceneComposition,
  ScenePurpose,
} from '@studio/shared';

export type MotionPlanDraft = Omit<
  MotionPlan,
  'id' | 'revision' | 'status' | 'inputFingerprint' | 'createdAt' | 'updatedAt'
>;

export type MotionPlanSceneInput = {
  sceneId: string;
  sceneRevision: number;
  sceneNumber: number;
  purpose: ScenePurpose;
  camera: SceneCamera;
  composition: SceneComposition;
  durationMs: number;
  timingRevision: number | null;
  intensity?: number;
};

const MOTION_SEQUENCE: MotionType[] = [
  'PAN_LEFT',
  'PAN_RIGHT',
  'PAN_UP',
  'PAN_DOWN',
  'ZOOM_IN',
  'ZOOM_OUT',
];

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const clampPoint = (point: NormalizedPoint): NormalizedPoint => ({
  x: clamp(point.x, 0.08, 0.92),
  y: clamp(point.y, 0.08, 0.92),
});

function subjectFocus(composition: SceneComposition): NormalizedPoint {
  const positions = composition.characterPositions.map((character) =>
    character.position.toLowerCase(),
  );
  const text = `${composition.subjectFocus} ${positions.join(' ')}`;
  const x = text.includes('left') ? 0.28 : text.includes('right') ? 0.72 : 0.5;
  const y =
    text.includes('top') || text.includes('above') ? 0.3 : text.includes('bottom') ? 0.7 : 0.5;
  return { x, y };
}

function chooseMotion(input: MotionPlanSceneInput, focus: NormalizedPoint): MotionType {
  const normalizedMovement = input.camera.movementIntent?.toLowerCase() ?? '';
  if (normalizedMovement.includes('static')) return 'STATIC';
  if (normalizedMovement.includes('left')) return 'PAN_LEFT';
  if (normalizedMovement.includes('right')) return 'PAN_RIGHT';
  if (normalizedMovement.includes('up')) return 'PAN_UP';
  if (normalizedMovement.includes('down')) return 'PAN_DOWN';
  if (input.camera.framing === 'CLOSE_UP' || input.camera.framing === 'EXTREME_CLOSE_UP') {
    return input.sceneNumber % 3 === 0 ? 'ZOOM_IN' : 'STATIC';
  }
  if (input.camera.framing === 'EXTREME_WIDE' || input.camera.framing === 'WIDE') {
    return input.sceneNumber % 2 === 0 ? 'PAN_ZOOM' : 'SLOW_PUSH_IN';
  }
  if (input.purpose === 'ACTION' || input.purpose === 'CLIMAX' || input.purpose === 'REVEAL') {
    if (focus.x < 0.4) return 'PAN_LEFT';
    if (focus.x > 0.6) return 'PAN_RIGHT';
    return MOTION_SEQUENCE[input.sceneNumber % MOTION_SEQUENCE.length]!;
  }
  return MOTION_SEQUENCE[input.sceneNumber % MOTION_SEQUENCE.length]!;
}

function positionForMotion(
  motionType: MotionType,
  focus: NormalizedPoint,
  intensity: number,
): { startPosition: NormalizedPoint; endPosition: NormalizedPoint } {
  const travel = 0.04 * intensity;
  const start = { ...focus };
  const end = { ...focus };
  if (motionType === 'PAN_LEFT') {
    start.x += travel;
    end.x -= travel;
  } else if (motionType === 'PAN_RIGHT') {
    start.x -= travel;
    end.x += travel;
  } else if (motionType === 'PAN_UP') {
    start.y += travel;
    end.y -= travel;
  } else if (motionType === 'PAN_DOWN') {
    start.y -= travel;
    end.y += travel;
  } else if (motionType === 'PAN_ZOOM') {
    start.x += travel;
    start.y += travel * 0.5;
    end.x -= travel;
    end.y -= travel * 0.5;
  }
  return { startPosition: clampPoint(start), endPosition: clampPoint(end) };
}

export function createDefaultMotionPlan(input: MotionPlanSceneInput): MotionPlanDraft {
  if (!Number.isInteger(input.sceneRevision) || input.sceneRevision < 1) {
    throw new Error('Scene revision must be positive');
  }
  if (!Number.isInteger(input.sceneNumber) || input.sceneNumber < 1) {
    throw new Error('Scene number must be positive');
  }
  if (!Number.isInteger(input.durationMs) || input.durationMs <= 0) {
    throw new Error('Motion duration must be positive');
  }
  const intensity = clamp(input.intensity ?? 0.5, 0, 1);
  const focusPoint = subjectFocus(input.composition);
  const motionType = chooseMotion(input, focusPoint);
  const { startPosition, endPosition } = positionForMotion(motionType, focusPoint, intensity);
  const travelScale = 0.06 * intensity;
  const zoomMotion =
    motionType === 'ZOOM_IN' || motionType === 'PAN_ZOOM' || motionType === 'SLOW_PUSH_IN';
  const reverseZoom = motionType === 'ZOOM_OUT';
  const startScale = reverseZoom ? 1 + travelScale : 1;
  const endScale = zoomMotion ? 1 + travelScale : reverseZoom ? 1 : 1;
  return {
    sceneId: input.sceneId,
    sceneRevision: input.sceneRevision,
    timingRevision: input.timingRevision,
    motionType,
    startScale,
    endScale,
    startPosition,
    endPosition,
    easing: motionType === 'STATIC' ? 'LINEAR' : 'EASE_IN_OUT',
    focusPoint,
    intensity,
    durationMs: input.durationMs,
  };
}

export function validateMotionPlanBounds(
  plan: Pick<
    MotionPlan,
    'startScale' | 'endScale' | 'startPosition' | 'endPosition' | 'durationMs'
  >,
): void {
  if (
    !Number.isFinite(plan.startScale) ||
    !Number.isFinite(plan.endScale) ||
    plan.startScale < 1 ||
    plan.endScale < 1 ||
    plan.startScale > 1.25 ||
    plan.endScale > 1.25
  ) {
    throw new Error('Motion scale is outside safe bounds');
  }
  for (const position of [plan.startPosition, plan.endPosition]) {
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      position.x < 0 ||
      position.x > 1 ||
      position.y < 0 ||
      position.y > 1
    ) {
      throw new Error('Motion position is outside safe bounds');
    }
  }
  if (!Number.isInteger(plan.durationMs) || plan.durationMs <= 0) {
    throw new Error('Motion duration must be positive');
  }
}
