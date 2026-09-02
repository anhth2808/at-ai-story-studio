import { describe, expect, it } from 'vitest';
import { createDefaultMotionPlan, validateMotionPlanBounds } from './motion-plan.js';

const input = {
  sceneId: 'scene-1',
  sceneRevision: 1,
  sceneNumber: 1,
  purpose: 'ESTABLISHING' as const,
  camera: { framing: 'WIDE' as const, angle: null, movementIntent: null },
  composition: {
    subjectFocus: 'A lone traveler on the left',
    foreground: [],
    midground: [],
    background: [],
    characterPositions: [{ characterId: null, displayName: 'Traveler', position: 'left' }],
  },
  durationMs: 4_000,
  timingRevision: 1,
  intensity: 0.5,
};

describe('MotionPlan', () => {
  it('is deterministic and bounded', () => {
    const first = createDefaultMotionPlan(input);
    const second = createDefaultMotionPlan(input);
    expect(first).toEqual(second);
    validateMotionPlanBounds(first);
    expect(first.focusPoint).toEqual({ x: 0.28, y: 0.5 });
  });

  it('keeps close-ups static or subtly zoomed', () => {
    const plan = createDefaultMotionPlan({
      ...input,
      camera: { framing: 'CLOSE_UP', angle: null, movementIntent: null },
    });
    expect(['STATIC', 'ZOOM_IN']).toContain(plan.motionType);
    expect(plan.endScale - plan.startScale).toBeLessThanOrEqual(0.06);
  });

  it('honors explicit movement intent', () => {
    const plan = createDefaultMotionPlan({
      ...input,
      camera: { framing: 'MEDIUM', angle: null, movementIntent: 'pan right' },
    });
    expect(plan.motionType).toBe('PAN_RIGHT');
    expect(plan.endPosition.x).toBeGreaterThan(plan.startPosition.x);
  });

  it('rejects unsafe motion values', () => {
    expect(() =>
      validateMotionPlanBounds({
        ...createDefaultMotionPlan(input),
        startScale: 2,
      }),
    ).toThrow('outside safe bounds');
  });
});
