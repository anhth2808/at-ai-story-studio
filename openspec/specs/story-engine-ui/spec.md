# Story Engine UI Specification

## Purpose

Give users a review-first Story workspace for configuring idea generation, inspecting structured story state, generating one bounded unit at a time, and explicitly handing approved chapters to the existing media pipeline.

## Requirements

### Requirement: Story workspace navigation
The web application SHALL provide a Story workspace for projects that contains story settings, blueprint and characters, chapter plans, chapter generation, chapter review, and generation metadata. Existing project, chapter, narration, subtitle, background, and render views SHALL remain available.

#### Scenario: Open a project with no story state
- **WHEN** a user opens Story for a project without story settings
- **THEN** the workspace SHALL show an actionable empty state and SHALL not imply that generation has started

#### Scenario: Reload after restart
- **WHEN** the web application reloads after an API or worker restart
- **THEN** the Story workspace SHALL display persisted settings, revisions, step statuses, errors, and current outputs rather than resetting to optimistic state

### Requirement: Story settings form
The Story workspace SHALL allow users to edit idea, language, genre, tone, audience, target chapter count, chapter length, pacing, content boundaries, character notes, world notes, plot requirements, and generation settings with field-level validation and safe configuration status.

#### Scenario: Save settings
- **WHEN** a user submits valid Story settings
- **THEN** the UI SHALL show the saved current revision and make the relevant generation action available

#### Scenario: Show invalid settings
- **WHEN** the API rejects an invalid value or unsupported adaptation mode
- **THEN** the UI SHALL show a Vietnamese validation message near the relevant control and SHALL retain unsaved values for correction

### Requirement: Review structured outputs
The Story workspace SHALL display blueprint premise, themes, world rules, plot direction, character cards, chapter plan rows, compact summaries, threads, continuity warnings, and generation provenance in a form that distinguishes current, stale, invalidated, failed, and manually edited state.

#### Scenario: Review generated blueprint
- **WHEN** blueprint generation succeeds
- **THEN** the UI SHALL show the structured blueprint and characters with revision and provenance information before any chapter or media work is started

#### Scenario: Review a continuity warning
- **WHEN** a generated chapter contains a continuity warning
- **THEN** the warning SHALL be visible beside the affected chapter and SHALL not block manual review unless the user chooses to resolve it

### Requirement: Explicit generation controls
The Story workspace SHALL expose separate controls for generating blueprint, chapter plans, an individual chapter, and a chapter summary. Each control SHALL show pending/running/completed/failed/cancelled/invalidated state, progress where available, safe errors, retry action, and cancellation action where applicable.

#### Scenario: Retry one chapter
- **WHEN** chapter 3 generation fails while chapters 1 and 2 are current
- **THEN** retrying chapter 3 SHALL not rerun completed chapters 1 and 2 or invalidate their media

#### Scenario: Cancel generation
- **WHEN** a user cancels a running story operation
- **THEN** the UI SHALL show cancellation after persisted state confirms it and SHALL not display partial output as current

### Requirement: Review-first chapter editor
Generated chapter content SHALL open in the existing chapter editor with explicit generated/manual revision indicators. The UI SHALL require an explicit action to replace newer manual content with a later generated result.

#### Scenario: Edit before narration
- **WHEN** a user edits generated chapter prose
- **THEN** the UI SHALL save a manual revision, show stale summary/dependent media state, and SHALL not start TTS automatically

#### Scenario: Send approved chapter to TTS
- **WHEN** a user explicitly selects the narration action for a current reviewed chapter
- **THEN** the UI SHALL request the existing narration workflow and show its durable status separately from Story generation

### Requirement: Vietnamese user-facing copy
New Story workspace labels, actions, validation messages, statuses, empty states, and error translations SHALL be Vietnamese while code, API contracts, persisted enum values, and planning artifacts remain English-compatible.

#### Scenario: Display a generation failure
- **WHEN** a Story generation step has a safe failure code
- **THEN** the UI SHALL display a Vietnamese actionable message and SHALL preserve the machine-readable status for diagnostics
### Requirement: Visual Bible workspace
The web application SHALL provide a project Visual Bible area with separate Style, Characters, Locations, and Objects sections. It SHALL use Vietnamese user-facing labels, statuses, validation messages, empty states, and errors while preserving the existing Story, Scenes, Audio, Video, and Render areas.

#### Scenario: Open an empty Visual Bible
- **WHEN** a project has no visual profiles
- **THEN** the UI SHALL show actionable missing-profile and style states without implying image generation has started

### Requirement: Edit and review visual profiles
The Visual Bible SHALL allow users to view, edit, approve, and explicitly regenerate character, location, recurring-object, and Style Bible revisions. It SHALL show profile status, revision, canonical prompt fragment, reference slots when present, and safe generation errors. Approved/manual data SHALL not be silently overwritten.

#### Scenario: Review a draft candidate
- **WHEN** a generated character candidate is available
- **THEN** the UI SHALL show it as a draft with an explicit approval/edit action and leave the prior approved revision visible

### Requirement: Review resolved scene packages
Scene detail SHALL show resolved character identities and states, location, objects, Style Bible, visual description, deterministic/refined prompt, negative prompt, dependency status, and consistency warnings. Users SHALL be able to rebuild a stale package without regenerating Scene structure.

#### Scenario: Show a consistency warning
- **WHEN** a scene is missing a visual profile or has a canonical conflict
- **THEN** the UI SHALL show an understandable Vietnamese warning beside the affected reference and package status

### Requirement: Selective Visual Bible reads
Visual Bible lists and scene package lists SHALL be paginated or otherwise bounded. The UI SHALL fetch detail only for the selected profile/scene and SHALL display persisted state after API or worker restart rather than relying on in-memory optimistic state.

#### Scenario: Browse many profiles
- **WHEN** a project contains many scenes and profile revisions
- **THEN** the UI SHALL request bounded metadata pages and SHALL not load all prompt payloads or chapter prose in one dashboard response
