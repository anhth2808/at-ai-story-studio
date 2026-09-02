import type { FitMode, NormalizedPoint } from '@studio/shared';

export type CropPlanInput = {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  fitMode: FitMode;
  startScale: number;
  endScale: number;
  startPosition: NormalizedPoint;
  endPosition: NormalizedPoint;
  containFill?: 'BLACK' | 'WHITE';
};

export type CropPoint = { x: number; y: number };

export type CropPlan = {
  fitMode: FitMode;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  baseScale: number;
  startScale: number;
  endScale: number;
  startScaledWidth: number;
  startScaledHeight: number;
  endScaledWidth: number;
  endScaledHeight: number;
  startCrop: CropPoint;
  endCrop: CropPoint;
  fill: 'BLACK' | 'WHITE' | null;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

function validateDimensions(input: CropPlanInput): void {
  for (const [name, value] of Object.entries({
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    targetWidth: input.targetWidth,
    targetHeight: input.targetHeight,
  })) {
    if (!Number.isInteger(value) || value < 16 || value > 16_384) {
      throw new Error(`${name} must be a valid media dimension`);
    }
  }
  for (const [name, value] of Object.entries({
    startScale: input.startScale,
    endScale: input.endScale,
  })) {
    if (!Number.isFinite(value) || value < 1 || value > 1.25) {
      throw new Error(`${name} is outside safe motion bounds`);
    }
  }
}

function cropPoint(
  position: NormalizedPoint,
  scaledWidth: number,
  scaledHeight: number,
  targetWidth: number,
  targetHeight: number,
): CropPoint {
  const maxX = Math.max(0, scaledWidth - targetWidth);
  const maxY = Math.max(0, scaledHeight - targetHeight);
  return {
    x: clamp(position.x, 0, 1) * maxX,
    y: clamp(position.y, 0, 1) * maxY,
  };
}

export function buildCropPlan(input: CropPlanInput): CropPlan {
  validateDimensions(input);
  const cover = Math.max(
    input.targetWidth / input.sourceWidth,
    input.targetHeight / input.sourceHeight,
  );
  const contain = Math.min(
    input.targetWidth / input.sourceWidth,
    input.targetHeight / input.sourceHeight,
  );
  const baseScale = input.fitMode === 'COVER' ? cover : contain;
  const startScale = input.fitMode === 'COVER' ? baseScale * input.startScale : baseScale;
  const endScale = input.fitMode === 'COVER' ? baseScale * input.endScale : baseScale;
  const startScaledWidth = input.sourceWidth * startScale;
  const startScaledHeight = input.sourceHeight * startScale;
  const endScaledWidth = input.sourceWidth * endScale;
  const endScaledHeight = input.sourceHeight * endScale;
  const fill = input.fitMode === 'CONTAIN' ? (input.containFill ?? 'BLACK') : null;
  return {
    fitMode: input.fitMode,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    targetWidth: input.targetWidth,
    targetHeight: input.targetHeight,
    baseScale,
    startScale,
    endScale,
    startScaledWidth,
    startScaledHeight,
    endScaledWidth,
    endScaledHeight,
    startCrop:
      input.fitMode === 'COVER'
        ? cropPoint(
            input.startPosition,
            startScaledWidth,
            startScaledHeight,
            input.targetWidth,
            input.targetHeight,
          )
        : { x: 0, y: 0 },
    endCrop:
      input.fitMode === 'COVER'
        ? cropPoint(
            input.endPosition,
            endScaledWidth,
            endScaledHeight,
            input.targetWidth,
            input.targetHeight,
          )
        : { x: 0, y: 0 },
    fill,
  };
}

export function validateCropPlan(plan: CropPlan): void {
  const maxStartX = Math.max(0, plan.startScaledWidth - plan.targetWidth);
  const maxStartY = Math.max(0, plan.startScaledHeight - plan.targetHeight);
  const maxEndX = Math.max(0, plan.endScaledWidth - plan.targetWidth);
  const maxEndY = Math.max(0, plan.endScaledHeight - plan.targetHeight);
  if (
    plan.startCrop.x < 0 ||
    plan.startCrop.x > maxStartX ||
    plan.startCrop.y < 0 ||
    plan.startCrop.y > maxStartY ||
    plan.endCrop.x < 0 ||
    plan.endCrop.x > maxEndX ||
    plan.endCrop.y < 0 ||
    plan.endCrop.y > maxEndY
  ) {
    throw new Error('Crop plan exceeds source bounds');
  }
  if (plan.fitMode === 'CONTAIN' && plan.fill === null) {
    throw new Error('Contain crop plan must declare a fill');
  }
}
