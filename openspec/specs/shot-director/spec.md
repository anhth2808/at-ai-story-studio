# shot-director Specification

## Purpose
Define durable Shot-level visual direction below canonical Scenes so generation receives focused, source-traceable, continuity-aware image and motion instructions without creating a second production pipeline.

## Requirements

### Requirement: Durable narrative beats and Shots
The system SHALL decompose a current Scene revision into ordered Narrative Beats and ordered Shots. Every Shot SHALL retain stable identity and lineage to project, chapter, exact Scene revision, parent beat, ordinal, bounded source range or explicit narrative source, planning template version, revision, fingerprint, and generation provenance. New planning SHALL preserve historical plans, and a stale Scene revision SHALL make dependent Shot plans stale without affecting unrelated Scenes or Chapters.

#### Scenario: Replan one changed Scene
- **WHEN** one current Scene revision changes and its Shot plan is rebuilt
- **THEN** only that Scene's previous Shot plan and descendants SHALL become stale, the prior revisions SHALL remain queryable, and other Scene Shot plans SHALL remain current

### Requirement: One visual information beat per Shot
Each Shot SHALL primarily communicate one physical action, spoken line or speaking beat, emotional reaction or change, visual reveal, relevant environment detail, meaningful object detail, or spatial relationship. Planning validation SHALL flag or reject an obvious sequence of multiple independently visible events in one Shot.

#### Scenario: Reject an overloaded Shot
- **WHEN** a proposed Shot opens a letter, reads its result, discovers the truth, and begins crying as sequential events
- **THEN** validation SHALL report an overloaded-Shot issue and SHALL not accept the plan until the events are split or a reviewer explicitly resolves the issue under policy

### Requirement: Isolate meaningful turning points without filler
A visually meaningful emotional reversal, discovery, reveal, surprise, impact, or major state change SHOULD receive its own Shot. A Shot SHALL carry dialogue, action, reaction, spatial information, reveal, environment information, or important-object information; a Shot containing none SHALL be rejected or merged. The planner SHALL NOT split meaningless micro-actions solely to increase Shot count.

#### Scenario: Split a visual reveal and reaction
- **WHEN** source text contains a readable discovery followed by a visually meaningful emotional reversal
- **THEN** the accepted plan SHALL represent the discovery and reaction as distinct Shots unless bounded validation records why one frame genuinely communicates both

#### Scenario: Remove filler
- **WHEN** a proposed Shot adds only an unrelated atmospheric cutaway with no source-grounded information
- **THEN** the validator SHALL flag it as filler and SHALL not count it as a valid Shot

### Requirement: Dialogue has a visual carrier
A visible-dialogue Shot SHALL identify the speaker and visually represent an appropriate face, posture, gesture, listener relationship, or deliberate reaction context. It SHALL preserve the original dialogue semantics. A Shot MAY omit the visible speaker only when it records a deliberate cinematic reason and an alternative visual carrier.

#### Scenario: Reject uncarried dialogue
- **WHEN** a Shot contains visible spoken dialogue but neither the speaker nor a deliberate reaction or off-screen rationale is represented
- **THEN** validation SHALL report a missing dialogue carrier

### Requirement: Internal voice remains non-speaking
Shots SHALL distinguish spoken dialogue from internal monologue, thought, narration, and voice-over. A non-spoken line SHALL compile to natural closed or non-speaking mouth behavior, MAY use subtle facial or body expression, and SHALL NOT request lip movement or visible speech.

#### Scenario: Compile internal monologue
- **WHEN** a character thinks a line without speaking aloud
- **THEN** the motion instructions SHALL mark it as internal voice or voice-over and require non-speaking mouth behavior

### Requirement: Static and dynamic prompt responsibilities
Every Shot SHALL expose separate structured static and dynamic intent and compiled `imagePrompt` and `videoPrompt` text. Image intent SHALL own visible subjects, location, identity stage, initial pose/expression, object placement, framing, angle, composition, lighting, color, mood, and static environment. Video intent SHALL own motion progression, camera movement, environment movement, emotional timing, speaking motion, and temporal stability constraints without repeating unnecessary world description.

#### Scenario: Keep motion prompt bounded
- **WHEN** a Shot image prompt already establishes identity, clothing, pose, composition, location, and objects
- **THEN** its video prompt SHALL describe only changes over time and stability requirements rather than duplicating the static prompt

### Requirement: Structured physical continuity
Each Shot plan SHALL persist structured initial and final continuity state for visible Characters, important objects, screen regions, world-position descriptions, facing direction, body orientation, pose, held-object identity, optional camera axis, and source Shot identity. Human-readable descriptions MAY represent uncertain geometry, but an unused free-text continuity note SHALL NOT be the sole dependency.

#### Scenario: Carry prior state forward
- **WHEN** a prior Shot ends with a Character screen-left, facing right, holding an identified object
- **THEN** the next dependent Shot's initial state and compiled prompt SHALL preserve those relevant facts unless the source explicitly changes them

### Requirement: Conservative Shot variation
The director SHOULD avoid identical framing and angle in consecutive Shots and repetitive non-static camera movement unless a matched composition or deliberate repetition is recorded. This heuristic SHALL warn rather than rigidly block valid cinematic repetition.

#### Scenario: Warn on accidental repetition
- **WHEN** adjacent Shots repeat the same framing, angle, and non-static motion with no recorded intent
- **THEN** validation SHALL emit a bounded variation warning while preserving the reviewer's ability to accept a deliberate match

### Requirement: Strict continuation eligibility
Continuation SHALL be true only when the next Shot plausibly continues from the previous accepted final frame: effectively inward crop or push, no new Character identity, no unsupported face angle, required subject retained, no hard emotional reset, major repositioning, location change, leave-and-return event, reverse angle, or large camera reorientation. All other transitions SHALL require a new keyframe.

#### Scenario: Reject reverse-angle continuation
- **WHEN** the next Shot requires reverse-angle geometry or a face orientation absent from the prior final frame
- **THEN** continuation SHALL be false even when both Shots belong to the same Scene

### Requirement: Continuation uses accepted prior video state
An eligible continuation SHALL use a frame extracted from the previous accepted current video clip rather than a separately generated keyframe. The lineage SHALL persist source video Asset ID and hash, source Shot ID, extracted frame Asset ID and hash, frame position, and extraction version. Missing, stale, rejected, or non-current source media SHALL fail with an explicit continuation prerequisite error.

#### Scenario: Continue from a prior final frame
- **WHEN** continuation is eligible and the previous accepted clip is current
- **THEN** the next generation SHALL consume the persisted extracted final-frame Asset and SHALL not schedule a separate image candidate set
