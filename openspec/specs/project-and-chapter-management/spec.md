# Project and chapter management Specification

## Purpose

Provide a durable, manually controlled project and chapter workspace so a user can author narration input, inspect status, and prepare a project for media generation without any AI story generation.

## Requirements

### Requirement: Project lifecycle
The system SHALL allow a user to create, list, view, update, and delete local story projects with a title, description, language, workflow type, status, and UTC creation/update timestamps. New projects SHALL default to workflow type `AUDIO_STORY` and an active status.

#### Scenario: Create a project
- **WHEN** a valid project title and supported metadata are submitted
- **THEN** the system SHALL persist a new project with a stable identifier and return its current metadata

#### Scenario: Reject invalid project input
- **WHEN** a project request omits a required field or contains an unsupported enum/value
- **THEN** the system SHALL reject it with a client-safe validation error and SHALL NOT create or modify a project

#### Scenario: Delete a project
- **WHEN** a user explicitly requests deletion of an existing project
- **THEN** the system SHALL remove its project data and managed files without affecting unrelated projects

### Requirement: Manual chapter lifecycle
The system SHALL allow a user to create, list, view, update, and delete chapters belonging to a project. A chapter SHALL contain a stable identifier, unique project-local number, title, original editable content, status, revision, and UTC timestamps.

#### Scenario: Create and edit a chapter
- **WHEN** a valid chapter is created or its title/content is saved
- **THEN** the system SHALL persist the change as the current editable revision and return the updated revision and dependent-output statuses

#### Scenario: Preserve original chapter content
- **WHEN** narration preparation or TTS processing runs
- **THEN** the stored chapter content SHALL remain unchanged; any cleaned representation SHALL be a separate generated input

#### Scenario: Chapter belongs to its project
- **WHEN** a chapter request references a missing project or a chapter from another project
- **THEN** the system SHALL return not-found/validation failure and SHALL NOT modify data

### Requirement: Chapter ordering
The system SHALL support deterministic reorder operations that assign unique sequential chapter numbers within a project.

#### Scenario: Reorder chapters
- **WHEN** a valid complete ordering of the project's chapter identifiers is submitted
- **THEN** the system SHALL persist the order and return chapters in that order

#### Scenario: Reject incomplete ordering
- **WHEN** an ordering omits, duplicates, or introduces a chapter identifier
- **THEN** the system SHALL reject the request without partially changing chapter numbers

### Requirement: Project editor status
The system SHALL expose project-level and chapter-level status summaries for narration, subtitles, background, and render outputs, including pending, running, completed, failed, invalidated, and cancelled states where applicable.

#### Scenario: Refresh after restart
- **WHEN** the web application reloads after the API or worker has restarted
- **THEN** it SHALL display statuses read from persisted state rather than resetting them to optimistic defaults

### Requirement: No implicit Story AI in ordinary project and chapter operations
The system SHALL keep ordinary project and chapter create, edit, reorder, and delete operations persistence-only: those operations SHALL use submitted author text and SHALL NOT call OMP, an LLM, or a story-generation provider. Explicit Story Engine operations are a separate user-authorized workflow and MAY generate structured story state or a generated chapter that is then represented through the ordinary chapter lifecycle.

#### Scenario: Manual-only chapter authoring
- **WHEN** a user creates or edits a chapter through the ordinary chapter operation
- **THEN** the system SHALL persist the submitted title/content and SHALL not call OMP, an LLM, or a story-generation provider

#### Scenario: Explicit Story Engine generation
- **WHEN** a user invokes a dedicated Story Engine generation action
- **THEN** the system MAY call the configured AI boundary, SHALL persist the result through the Story Engine contracts, and SHALL not automatically enqueue TTS, subtitles, backgrounds, or rendering

#### Scenario: Generated content enters the editor
- **WHEN** an explicit chapter-generation operation succeeds
- **THEN** the generated chapter SHALL be represented as an ordinary editable chapter revision with source lineage and SHALL remain subject to the existing chapter ownership, ordering, validation, and dependent-output rules
### Requirement: Preserve story and media when visual inputs change
Project and chapter management SHALL treat visual profile and Style Bible revisions as separate descendants of story content. Updating a visual profile SHALL not change chapter text, StoryState, scene source ranges, TTS, subtitles, background assets, or render outputs.

#### Scenario: Change a character appearance
- **WHEN** a user changes one character's approved visual profile
- **THEN** only dependent visual prompt packages SHALL become stale while the chapter and media pipeline remain valid

#### Scenario: Change the project style
- **WHEN** a user changes the current Style Bible
- **THEN** visual packages SHALL become stale without invalidating authored story or completed audio/render outputs

### Requirement: Persist visual identity across restart
Visual profiles, current revisions, package statuses, fingerprints, and consistency results SHALL be persisted with project ownership and SHALL be recovered by normal project reads after API or worker restart.

#### Scenario: Reload a project
- **WHEN** the application restarts after profiles and packages were saved
- **THEN** the project SHALL expose the same current visual identities and stale/current statuses rather than resetting them

### Requirement: Chapter revision-scoped scene invalidation
When a chapter title or content changes, the system SHALL preserve chapter revisions and existing media behavior while marking only scenes derived from the changed chapter revision stale or invalidated. It SHALL preserve historical scene revisions and SHALL not alter unrelated chapter scene plans.

#### Scenario: Edit chapter content
- **WHEN** chapter 5 is saved as a new manual revision
- **THEN** chapter 5's current scene plan SHALL no longer claim validity for the old source revision, while chapter 4 and chapter 6 scene plans remain available

#### Scenario: Preserve existing media
- **WHEN** a chapter scene plan becomes stale because chapter content changed
- **THEN** existing TTS, subtitle, and render invalidation semantics SHALL remain unchanged and scene invalidation SHALL not enqueue image or video work

### Requirement: Manual chapters support scene planning
A chapter's manual origin SHALL not prevent scene planning. Scene records SHALL retain their source chapter revision and SHALL not create or accept canonical StoryState changes merely because the chapter was analyzed for visual planning.

#### Scenario: Plan a manually authored chapter
- **WHEN** a user opens a manual chapter and requests Generate Scenes
- **THEN** the scene operation SHALL use the saved manual text and leave chapter origin, StoryState, and continuity acceptance unchanged

### Requirement: Scene edits do not rewrite chapter text
Editing or regenerating a scene SHALL not modify chapter title/content, chapter revision, narration, subtitles, render configuration, or neighboring scenes. Manual scene changes SHALL be explicit and reviewable.

#### Scenario: Edit scene visual fields
- **WHEN** a user changes a scene camera or image prompt
- **THEN** only the scene revision and relevant prompt status SHALL change, and the source chapter text SHALL remain byte-for-byte unchanged
