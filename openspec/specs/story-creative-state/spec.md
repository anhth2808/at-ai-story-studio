# Story creative state Specification

## Purpose

Provide a durable, reviewable story workspace that turns an idea into a versioned blueprint, chapter plans, compact continuity state, and ordinary editable chapters without coupling story state to media generation.

## Requirements

### Requirement: Idea-generation configuration
The system SHALL allow a project to store a revisioned idea-generation configuration containing the idea, language, genre, tone, audience, target chapter count, chapter length target, pacing, content boundaries, character notes, world notes, plot requirements, and generation settings. The supported V1 mode SHALL be `IDEA_TO_STORY`; adaptation/import mode SHALL be rejected as unsupported.

#### Scenario: Save valid story settings
- **WHEN** a user submits valid idea-generation settings for an existing project
- **THEN** the system SHALL persist a new current settings revision with stable identifiers and return the normalized settings

#### Scenario: Reject unsupported mode
- **WHEN** a user selects adaptation/import mode
- **THEN** the system SHALL return a safe validation error and SHALL NOT create a generation workflow

#### Scenario: Reject unsafe bounds
- **WHEN** a user submits an empty idea, unsupported language, invalid chapter count, or out-of-range length/pacing value
- **THEN** the system SHALL reject the request without changing the current settings revision

### Requirement: Versioned story blueprint
The system SHALL persist a blueprint revision containing the premise, themes, world rules, continuity constraints, plot direction, and structured characters. Each character SHALL have a stable identifier and SHALL support name, role, age range, appearance, personality, wants, fears, traits, relationships, backstory, voice, and arc fields.

#### Scenario: Review generated blueprint
- **WHEN** blueprint generation succeeds
- **THEN** the system SHALL store the structured blueprint as a non-destructive revision, make it current only after validation, and expose its characters and generation metadata for review

#### Scenario: Edit blueprint manually
- **WHEN** a user edits a blueprint or character field
- **THEN** the system SHALL create a new current revision and SHALL preserve the prior revision for lineage and diagnostics

#### Scenario: Reject malformed blueprint
- **WHEN** a generation result omits required blueprint or character fields or violates field constraints
- **THEN** the system SHALL reject it, retain the prior current blueprint, and expose a retryable generation failure

### Requirement: Versioned chapter plan
The system SHALL persist an ordered chapter plan with a stable identifier for each planned chapter. Each plan item SHALL include chapter number, title, purpose, summary, setting, participating character identifiers, conflict, turning points, resolution direction, emotional arc, estimated word count, and related story-thread identifiers.

#### Scenario: Generate a bounded plan
- **WHEN** a valid current story configuration is submitted for planning
- **THEN** the system SHALL create no more than the configured target chapter count, preserve deterministic ordering, and make the plan reviewable before chapter generation

#### Scenario: Edit one plan item
- **WHEN** a user changes one chapter plan item
- **THEN** the system SHALL create a new plan revision and SHALL invalidate only the generated chapter and dependent media for that plan item, leaving unrelated chapter outputs current

### Requirement: Compact continuity state
The system SHALL persist chapter summaries and story threads separately from chapter prose. A summary SHALL support a compact recap, key facts, character state changes, new information, and open/resolved thread references. A thread SHALL support a stable identifier, description, status, owning or related characters, introduced chapter, and resolved chapter when applicable.

#### Scenario: Commit generated chapter continuity
- **WHEN** a generated chapter is accepted as current
- **THEN** the system SHALL persist its summary, event or thread transitions, continuity warnings, and generation metadata without requiring full prior chapter prose in future context

#### Scenario: Regenerate a summary
- **WHEN** a user retries summary generation for an existing chapter
- **THEN** the system SHALL create a new summary revision and SHALL not regenerate the chapter audio or unrelated chapter summaries

### Requirement: Generated chapters use the normal chapter lifecycle
The system SHALL represent an accepted generated chapter as the project's ordinary editable chapter with revision lineage and source plan references. Generated chapter content SHALL remain reviewable and manually editable before any media workflow is requested.

#### Scenario: Review before narration
- **WHEN** chapter generation completes
- **THEN** the system SHALL show the generated title and content in the normal chapter editor and SHALL leave TTS, subtitles, and render outputs unchanged until the user explicitly requests narration

#### Scenario: Manually edit generated content
- **WHEN** a user edits a generated chapter's title or content
- **THEN** the system SHALL create a manual current revision, mark the dependent summary stale, and invalidate the chapter's narration, subtitle, and render descendants according to existing chapter invalidation behavior

#### Scenario: Prevent silent overwrite
- **WHEN** a later generation result targets a chapter with a newer manual revision
- **THEN** the system SHALL refuse to replace the manual revision implicitly and SHALL require an explicit user action to accept replacement

### Requirement: Scoped story invalidation
The system SHALL invalidate only outputs that depend on a changed story input. Settings changes SHALL invalidate dependent blueprint, plan, generated chapter, summary, and media outputs; blueprint changes SHALL invalidate dependent plans and chapters; a plan change SHALL invalidate only its chapter and descendants; unrelated chapters SHALL remain current.

#### Scenario: Change the story idea
- **WHEN** the current idea or global generation setting changes
- **THEN** the system SHALL mark dependent story outputs and their media descendants invalidated and SHALL retain unrelated project data and prior revisions

#### Scenario: Change one chapter's plan
- **WHEN** chapter plan 3 changes while chapters 1, 2, and 4 remain unchanged
- **THEN** only chapter 3's generated content, summary, narration, subtitles, and render descendants SHALL be invalidated

### Requirement: Explicit media handoff
The system SHALL keep story generation and media generation as separate user-controlled operations. Completing any story generation operation SHALL NOT automatically enqueue TTS, subtitle, background, or render work.

#### Scenario: Send an approved chapter to narration
- **WHEN** a user explicitly requests narration for a reviewed current chapter
- **THEN** the system SHALL create the existing narration workflow using that chapter revision as input and SHALL preserve the story-generation metadata

### Requirement: Visual planning descendants preserve story authority
The system SHALL treat scene plans as visual-planning descendants of exact chapter revisions. Scene generation SHALL consume, but SHALL NOT mutate, canonical StoryState, CharacterState, blueprint characters, chapter text, or continuity checkpoints.

#### Scenario: Generate from current continuity state
- **WHEN** a chapter has a current StoryState checkpoint and known blueprint characters
- **THEN** scene planning SHALL use relevant state snapshots for visual context while leaving the canonical state revision unchanged

#### Scenario: Generate a manual chapter
- **WHEN** a manually edited chapter has no accepted generated state delta
- **THEN** scene planning SHALL remain available from the chapter and available bounded context, without inventing or accepting a StoryState delta

### Requirement: Stable scene lineage
Each scene plan and scene record SHALL identify the exact chapter revision, relevant story/style revisions, and generation provenance used to create it. New scene revisions SHALL preserve prior revisions and SHALL expose one explicit current revision.

#### Scenario: Inspect scene lineage
- **WHEN** a user opens a scene generated from chapter revision 3
- **THEN** the response SHALL identify chapter revision 3 and retain earlier scene revisions for diagnosis

### Requirement: Visual descendants invalidate precisely
The system SHALL distinguish narrative scene invalidation from visual-prompt staleness. Chapter content changes SHALL affect only scene descendants of that chapter; visual-style or visual-reference changes SHALL mark dependent prompts stale without invalidating valid narrative structure.

#### Scenario: Change an unrelated chapter
- **WHEN** chapter 5 is edited while chapter 4 has a current scene plan
- **THEN** chapter 4 scene structure and prompts SHALL remain current

#### Scenario: Change style only
- **WHEN** a project visual style revision changes
- **THEN** scene source ranges, summaries, purposes, and narrative structure SHALL remain available while dependent prompts become stale

### Requirement: Hierarchical long-story planning state
For stories above 20 chapters, the system SHALL persist lightweight ordered arc records and SHALL allow current chapter plans to be generated and revised in bounded planning windows. Each planned chapter SHALL retain a stable identifier and chapter number, and window revisions SHALL preserve prior plan lineage.

#### Scenario: Create a 100-chapter plan in windows
- **WHEN** a user configures a 100-chapter story and requests planning
- **THEN** the system SHALL expose arc coverage and SHALL allow a bounded window of chapter plans to be reviewed without requiring one detailed response for all 100 chapters

#### Scenario: Revise one planning window
- **WHEN** a user edits a plan item within one arc window
- **THEN** the system SHALL preserve the prior plan revision and SHALL scope downstream generation invalidation to the affected planned chapters and their dependents

### Requirement: Persistent structured continuity state
The system SHALL persist StoryState checkpoints and dynamic CharacterState independently from stable blueprint Character definitions. Accepted chapter state SHALL include compact summaries, thread lifecycle data, important facts, recent events, current arc progress, and source chapter/revision lineage, with bounded fields and validated project-local references.

#### Scenario: Carry character state forward
- **WHEN** chapter 37 commits a character location, goal, injury, or knowledge change
- **THEN** the next current StoryState SHALL expose that dynamic state while the blueprint character identity remains unchanged

#### Scenario: Preserve checkpoint lineage
- **WHEN** a later chapter is generated or a continuity rebuild is requested
- **THEN** prior StoryState revisions SHALL remain inspectable and the operation SHALL identify the checkpoint and source revisions it used

### Requirement: Continuity-aware chapter revisions
The system SHALL expose a `CONTINUITY_STALE` state for existing AI-generated chapter content whose upstream narrative state changed. This state SHALL be distinct from `FAILED`, `INVALIDATED`, and media output status, SHALL preserve chapter content and prior revisions, and SHALL require an explicit user choice before future regeneration or rebuild.

#### Scenario: Change an earlier generated chapter
- **WHEN** an accepted revision changes chapter 25 while later generated chapters exist
- **THEN** affected later chapters SHALL be marked `CONTINUITY_STALE` without being silently deleted or treated as fully current

#### Scenario: Keep stale chapters
- **WHEN** the user chooses to keep the later chapters as authored
- **THEN** their content and media SHALL remain available while the continuity-stale indicator remains visible

### Requirement: Explicit continuity actions after manual edits
When a user edits a chapter that participates in StoryState, the system SHALL preserve existing summary and media invalidation behavior and SHALL additionally expose an explicit action to rebuild continuity or analyze the manual chapter. The system SHALL not silently recompute later chapters or StoryState from the edit.

#### Scenario: Edit chapter 37 manually
- **WHEN** a generated chapter is saved as a manual revision
- **THEN** its summary and dependent media SHALL follow existing invalidation rules, later dependent AI chapters SHALL be marked continuity-stale as applicable, and the UI SHALL offer rebuild or analysis actions

#### Scenario: Leave future story unchanged
- **WHEN** the user does not request a rebuild after editing a chapter
- **THEN** later story content SHALL remain stored with its existing status and SHALL not be silently recomputed
