import { createHash } from 'node:crypto';
import { shotPhysicalStateSchema } from '@studio/shared';
import type { Shot, ShotContinuationDecision, ShotPhysicalState } from '@studio/shared';
import { stableSerialize } from './story-prompts.js';

function fingerprint(state: Omit<ShotPhysicalState, 'fingerprint'>): string {
  return createHash('sha256').update(stableSerialize(state)).digest('hex');
}

export function resolveShotContinuity(
  previous: ShotPhysicalState | null,
  planned: Omit<ShotPhysicalState, 'fingerprint'>,
): { state: ShotPhysicalState; conflicts: string[] } {
  const conflicts: string[] = [];
  const previousCharacters = new Map(
    previous?.characters.map((value) => [value.characterId, value]),
  );
  const characters = planned.characters.map((character) => {
    const prior = previousCharacters.get(character.characterId);
    if (prior && prior.heldObjectIds.some((id) => !character.heldObjectIds.includes(id)))
      conflicts.push(
        `${character.characterId} drops a held object without an explicit state change`,
      );
    return prior
      ? {
          ...prior,
          ...character,
          heldObjectIds: character.heldObjectIds,
        }
      : character;
  });
  const previousObjects = new Map(previous?.objects.map((value) => [value.objectId, value]));
  const objects = planned.objects.map((object) => ({
    ...previousObjects.get(object.objectId),
    ...object,
  }));
  const value = {
    characters,
    objects,
    cameraAxis: planned.cameraAxis || previous?.cameraAxis || '',
    locationId: planned.locationId ?? previous?.locationId ?? null,
    sourceShotId: previous?.sourceShotId ?? null,
  };
  return {
    state: shotPhysicalStateSchema.parse({ ...value, fingerprint: fingerprint(value) }),
    conflicts,
  };
}

export function continuationEligibility(previous: Shot, current: Shot): ShotContinuationDecision {
  const reject = (reason: string): ShotContinuationDecision => ({
    mode: 'NEW_KEYFRAME',
    eligible: false,
    reason,
    version: 'continuation-v1',
  });
  if (!['PUSH_IN', 'STATIC'].includes(current.dynamicIntent.cameraMotion))
    return reject('Continuation requires an inward crop, push-in, or static retained frame');
  if (previous.finalState.locationId !== current.initialState.locationId)
    return reject('Location changed');
  if (previous.finalState.cameraAxis !== current.initialState.cameraAxis)
    return reject('Camera axis or orientation changed');
  const previousIds = previous.finalState.characters
    .filter((value) => value.visible)
    .map((value) => value.characterId)
    .sort();
  const currentIds = current.initialState.characters
    .filter((value) => value.visible)
    .map((value) => value.characterId)
    .sort();
  if (stableSerialize(previousIds) !== stableSerialize(currentIds))
    return reject('Visible identity set changed');
  for (const character of current.initialState.characters) {
    const source = previous.finalState.characters.find(
      (value) => value.characterId === character.characterId,
    );
    if (!source) return reject('Character leaves or returns');
    if (source.worldPosition !== character.worldPosition || source.facing !== character.facing)
      return reject('Character repositioned or reversed');
    if (
      character.faceVisibility === 'FRONTAL' &&
      !['FRONTAL', 'PROFILE', 'PARTIAL'].includes(source.faceVisibility)
    )
      return reject('Source frame lacks a supported face basis');
  }
  if (current.dynamicIntent.emotionalTiming.toLocaleLowerCase('en-US').includes('reset'))
    return reject('Emotional state resets');
  return {
    mode: 'CONTINUE_PREVIOUS',
    eligible: true,
    reason: 'Retains identity, physical state, Location, camera axis, and supported face basis',
    version: 'continuation-v1',
  };
}
