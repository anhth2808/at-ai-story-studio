import { AppError, shotPlanCandidateSchema } from '@studio/shared';
import type { SceneDto, Shot, ShotPlanCandidate, ShotValidationIssue } from '@studio/shared';

export const MAX_SHOT_DURATION_MS = 12_000;
const nonSpeakingModes = new Set(['INTERNAL_MONOLOGUE', 'NARRATION', 'VOICE_OVER']);
const mouthMotion = /\b(lip|lips|mouth|speak|speaks|speaking|talk|talks|voice|voices|say|says)\b/i;

function issue(
  code: ShotValidationIssue['code'],
  shotId: string | null,
  message: string,
  severity: ShotValidationIssue['severity'] = 'ERROR',
): ShotValidationIssue {
  return { code, shotId, message, severity };
}

export function compileShotDynamicPrompt(shot: Shot): string {
  const speakingMotion = nonSpeakingModes.has(shot.dialogueMode)
    ? 'mouth remains naturally closed, no speaking or lip movement; subtle expression only'
    : shot.dynamicIntent.speakingMotion;
  return [
    shot.dynamicIntent.subjectMotion,
    `camera ${shot.dynamicIntent.cameraMotion.toLocaleLowerCase('en-US').replaceAll('_', ' ')}`,
    shot.dynamicIntent.environmentMotion,
    shot.dynamicIntent.emotionalTiming,
    speakingMotion,
    ...shot.dynamicIntent.stabilityConstraints,
  ]
    .filter(Boolean)
    .join(', ');
}

function validateShot(shot: Shot): ShotValidationIssue[] {
  const issues: ShotValidationIssue[] = [];
  if (shot.eventCount > 1)
    issues.push(
      issue('SHOT_OVERLOADED', shot.id, 'A Shot may contain only one sequential primary event'),
    );
  if (shot.dialogueMode !== 'NONE' && !shot.visualCarrier.trim())
    issues.push(issue('DIALOGUE_CARRIER_MISSING', shot.id, 'Dialogue requires a visible carrier'));
  if (shot.dialogueMode === 'OFFSCREEN_SPOKEN' && !shot.offscreenRationale.trim())
    issues.push(
      issue(
        'DIALOGUE_CARRIER_MISSING',
        shot.id,
        'Off-screen dialogue requires an explicit rationale',
      ),
    );
  if (
    nonSpeakingModes.has(shot.dialogueMode) &&
    (mouthMotion.test(shot.dynamicIntent.speakingMotion) ||
      mouthMotion.test(shot.dynamicIntent.subjectMotion))
  )
    issues.push(
      issue(
        'MONOLOGUE_LIP_MOVEMENT',
        shot.id,
        'Non-spoken dialogue cannot direct lip or speaking motion',
      ),
    );
  if (shot.plannedDurationMs > MAX_SHOT_DURATION_MS)
    issues.push(
      issue('SHOT_DURATION_EXCEEDED', shot.id, `Shot duration exceeds ${MAX_SHOT_DURATION_MS} ms`),
    );
  const staticDetails = [
    shot.staticIntent.composition,
    shot.staticIntent.lighting,
    shot.staticIntent.colorMood,
    shot.staticIntent.atmosphere,
  ].filter((value) => value.length >= 40);
  const dynamicText = [shot.dynamicIntent.subjectMotion, shot.dynamicIntent.environmentMotion].join(
    ' ',
  );
  if (staticDetails.some((detail) => dynamicText.includes(detail)))
    issues.push(
      issue(
        'PROMPT_RESPONSIBILITY_MIXED',
        shot.id,
        'Static world detail is duplicated in dynamic intent',
      ),
    );
  return issues;
}

export function validateShotPlan(
  input: unknown,
  scene: Pick<SceneDto, 'sourceRange'>,
): { candidate: ShotPlanCandidate; issues: ShotValidationIssue[] } {
  const candidate = shotPlanCandidateSchema.parse(input);
  const issues = candidate.shots.flatMap(validateShot);
  const shotsByBeat = new Map<string, Shot[]>();
  for (const shot of candidate.shots) {
    const values = shotsByBeat.get(shot.beatId) ?? [];
    values.push(shot);
    shotsByBeat.set(shot.beatId, values);
  }
  for (const beat of candidate.beats) {
    const shots = shotsByBeat.get(beat.id) ?? [];
    if (shots.length === 0)
      issues.push(issue('SHOT_FILLER', null, `Narrative beat ${beat.id} has no useful Shot`));
    if (beat.turningPoint && (shots.length !== 1 || shots[0]?.eventCount !== 1))
      issues.push(
        issue(
          'TURNING_POINT_NOT_ISOLATED',
          shots[0]?.id ?? null,
          `Turning point ${beat.id} must be isolated`,
        ),
      );
  }
  const ordered = [...candidate.shots].sort((left, right) => left.ordinal - right.ordinal);
  let coveredUntil = scene.sourceRange.start;
  for (const shot of ordered) {
    if (shot.sourceRange.startOffset > coveredUntil)
      issues.push(issue('SHOT_FILLER', shot.id, 'Shot source ranges leave uncovered Scene text'));
    coveredUntil = Math.max(coveredUntil, shot.sourceRange.endOffset);
  }
  if (coveredUntil < scene.sourceRange.end)
    issues.push(
      issue('SHOT_FILLER', ordered.at(-1)?.id ?? null, 'Shot source ranges do not cover the Scene'),
    );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (
      current.variationIntent === 'NORMAL' &&
      previous.staticIntent.framing === current.staticIntent.framing &&
      previous.staticIntent.angle === current.staticIntent.angle &&
      previous.dynamicIntent.cameraMotion === current.dynamicIntent.cameraMotion
    )
      issues.push(
        issue(
          'SHOT_REPETITIVE',
          current.id,
          'Adjacent Shot framing, angle, and motion repeat',
          'WARNING',
        ),
      );
  }
  if (issues.some((entry) => entry.severity === 'ERROR'))
    throw new AppError(
      'SHOT_PLAN_INVALID',
      issues.map((entry) => entry.message).join('; '),
      422,
      true,
    );
  return { candidate, issues };
}
