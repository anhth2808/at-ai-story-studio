## Purpose

Provide a durable, manually controlled project and chapter workspace so a user can author narration input, inspect status, and prepare a project for media generation without any AI story generation.

## ADDED Requirements

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

### Requirement: No Story AI in this capability
The system SHALL NOT generate, adapt, summarize, or rewrite story text through an LLM or agent as part of project or chapter operations.

#### Scenario: Manual-only authoring
- **WHEN** a user creates or edits a chapter
- **THEN** the system SHALL use the submitted text as the authored content and SHALL not call OMP, an LLM, or a story-generation provider
