import { describe, expect, it } from 'vitest';
import { buildCropPlan, validateCropPlan } from './crop.js';

describe('crop planning', () => {
  it('fills a landscape frame with a portrait source without distortion', () => {
    const plan = buildCropPlan({
      sourceWidth: 1_000,
      sourceHeight: 1_500,
      targetWidth: 1_920,
      targetHeight: 1_080,
      fitMode: 'COVER',
      startScale: 1,
      endScale: 1.05,
      startPosition: { x: 0.25, y: 0.5 },
      endPosition: { x: 0.75, y: 0.5 },
    });
    validateCropPlan(plan);
    expect(plan.startScaledWidth).toBe(1_920);
    expect(plan.startScaledHeight).toBe(2_880);
    expect(plan.startCrop.x).toBe(0);
    expect(plan.endCrop.y).toBeLessThanOrEqual(plan.endScaledHeight - 1_080);
  });

  it('keeps the full source visible in contain mode', () => {
    const plan = buildCropPlan({
      sourceWidth: 1_500,
      sourceHeight: 1_000,
      targetWidth: 1_080,
      targetHeight: 1_920,
      fitMode: 'CONTAIN',
      startScale: 1.2,
      endScale: 1,
      startPosition: { x: 0, y: 0 },
      endPosition: { x: 1, y: 1 },
      containFill: 'BLACK',
    });
    validateCropPlan(plan);
    expect(plan.fill).toBe('BLACK');
    expect(plan.startScale).toBe(plan.baseScale);
    expect(plan.startCrop).toEqual({ x: 0, y: 0 });
  });

  it('rejects dimensions and scales outside safe bounds', () => {
    expect(() =>
      buildCropPlan({
        sourceWidth: 1,
        sourceHeight: 100,
        targetWidth: 1_920,
        targetHeight: 1_080,
        fitMode: 'COVER',
        startScale: 1,
        endScale: 1,
        startPosition: { x: 0.5, y: 0.5 },
        endPosition: { x: 0.5, y: 0.5 },
      }),
    ).toThrow('valid media dimension');
  });
});
