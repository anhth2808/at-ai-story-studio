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

### Requirement: Scenes project area
The Story workspace SHALL expose a Vietnamese Scenes area that lists chapter scene-plan status and count with actions to generate scenes for a chapter or selected chapters. It SHALL preserve the existing Story, Audio, Subtitle, Video, and Render actions and SHALL show persisted workflow status rather than browser-only progress.

#### Scenario: Open scenes for a project
- **WHEN** a user opens the Scenes area
- **THEN** the UI SHALL show paginated chapter metadata, current scene counts/statuses, density controls, and Generate Scenes actions without loading every chapter's full prose

### Requirement: Scene review and source preview
The scene editor SHALL show scene order, title, purpose, location, characters, mood, camera, visual description, image prompt, and bounded source excerpt for the associated chapter revision. All user-facing copy, errors, empty states, and actions SHALL be Vietnamese while machine enum values remain available for diagnostics.

#### Scenario: Review a generated scene
- **WHEN** a chapter has a completed scene plan
- **THEN** the user SHALL be able to inspect each scene's source excerpt and structured visual fields

### Requirement: First-class scene editing and regeneration
The UI SHALL allow a user to edit supported scene fields and independently regenerate one scene. It SHALL communicate stale/invalidated prompt or scene status and SHALL not silently replace manual edits.

#### Scenario: Regenerate one scene from the editor
- **WHEN** a user selects Regenerate Scene for scene 2
- **THEN** the UI SHALL show durable operation progress and, on success, refresh only scene 2's revision while leaving neighboring scenes visible and unchanged

### Requirement: Visual style controls
The Scenes area SHALL provide basic project visual-style editing and scene-density selection, including LOW, MEDIUM, and HIGH values and an optional bounded target range. Invalid input SHALL be shown as a safe validation error without discarding the current style.

#### Scenario: Change project style
- **WHEN** a user changes the style from anime to cinematic realistic
- **THEN** the UI SHALL show that scene structure remains available and image prompts require refresh

### Requirement: Large-project reads remain selective
Scene dashboard reads SHALL use pagination or chapter filters and SHALL request scene detail/source excerpts separately where useful. The UI SHALL not require a single response containing all chapters, prose, and scene records for a large project.

#### Scenario: Browse 100 chapters
- **WHEN** a project contains 100 chapters and many scene plans
- **THEN** the UI SHALL load bounded pages and preserve the user's selected chapter/scene across refreshes

### Requirement: Image Generation settings UI
The web application SHALL provide a Vietnamese Image Generation settings section showing provider, server URL, approved workflow, configured model components, resolution, steps, guidance, sampler, seed mode, timeouts, readiness status, and a `Test Connection` action. It SHALL not expose arbitrary workflow JSON or provider secrets.

#### Scenario: Test unavailable ComfyUI
- **WHEN** a user tests a configured server that is unreachable or missing a required model/workflow node
- **THEN** the UI SHALL display the persisted machine state and an actionable Vietnamese explanation without starting a generation

### Requirement: Scene image generation and preview UI
Scene detail SHALL show Visual Prompt Package freshness and current image state, with eligible actions for Generate Image, Preview, Accept, Reject, Retry technical failure, Regenerate Same Seed, Regenerate New Seed, Set Current, and manual upload. Controls SHALL be disabled or explain the prerequisite when the package is missing/stale or provider readiness is not ready.

#### Scenario: Generate first image
- **WHEN** a Scene has a CURRENT package and the provider is READY
- **THEN** the user SHALL be able to schedule generation, observe persisted queued/running/completed/failed status, and preview the validated current Asset after completion

#### Scenario: Reload during generation
- **WHEN** the browser reloads while image work is queued or running
- **THEN** the UI SHALL reconstruct status and history from persisted API data rather than browser-only state

### Requirement: Scene image revision review
Scene detail SHALL show a bounded image history containing revision/generation identity, provider or manual origin, seed, dimensions, generation status, freshness, review status, current marker, timestamps, safe error, and optional notes. Review and current selection SHALL remain separate.

#### Scenario: Compare two generations
- **WHEN** a Scene has two completed image revisions
- **THEN** both previews and metadata SHALL remain available and the UI SHALL clearly identify which revision is current and accepted/rejected/unreviewed

### Requirement: Manual image and regeneration feedback controls
The UI SHALL accept supported manual Scene image uploads and bounded review/regeneration notes. A note SHALL apply only to the selected image/retry-regeneration action and SHALL not imply a canonical Visual Profile edit.

#### Scenario: Request a clothing correction
- **WHEN** a user enters a bounded regeneration note and chooses new-seed regeneration
- **THEN** the UI SHALL create a new generation request while leaving the Character Visual Profile unchanged

### Requirement: Bounded batch image controls
The Scenes area SHALL allow explicit generation for selected Scenes, missing images in one Chapter, and missing-or-stale images. It SHALL show per-Scene outcomes and SHALL not offer or trigger an implicit unbounded all-project generation.

#### Scenario: Generate selected Scenes
- **WHEN** a user selects several eligible Scenes and confirms generation
- **THEN** the UI SHALL schedule independent persisted Scene jobs and preserve successful results if one Scene fails

### Requirement: Long-story progress dashboard
The Story workspace SHALL display target chapter count, blueprint status, arc coverage, planned chapter coverage, generated chapter progress, continuity warning count, active batch status, and the current blocking chapter. New labels, actions, statuses, empty states, and errors SHALL remain Vietnamese while machine status values remain available for diagnostics.

#### Scenario: Review a 100-chapter project
- **WHEN** a project has 100 configured chapters, four arcs, 40 planned chapters, and 37 completed chapters
- **THEN** the dashboard SHALL show those persisted counts and SHALL identify chapter 38 as failed or blocking when applicable

#### Scenario: Reload batch progress
- **WHEN** the browser reloads during or after a worker restart
- **THEN** the dashboard SHALL restore progress and errors from the API/database rather than resetting local counters

### Requirement: Batch generation controls
The Story workspace SHALL expose actions for generating the next five, next ten, a selected inclusive range, or all remaining chapters. Each action SHALL show persisted pending, running, completed, failed, paused, skipped, cancelled, or stale state and SHALL not require the browser to remain open.

#### Scenario: Start the next batch
- **WHEN** a user selects Generate next 5 with valid plans and prerequisites
- **THEN** the UI SHALL submit one durable batch request and show its per-chapter progress and retry/cancel actions

#### Scenario: Show a failed batch
- **WHEN** a batch pauses because chapter 38 failed
- **THEN** the UI SHALL show the failed chapter, safe error, Retry action, and an explicit Skip action without implying that later chapters succeeded

### Requirement: Filterable chapter status table
The Story workspace SHALL provide a bounded chapter table showing number, plan status, generation status, continuity status, summary status, and audio status. It SHALL support filters for failed, pending, continuity-stale, and warning results and SHALL avoid requiring all chapter prose or media data in the table response.

#### Scenario: Filter stale chapters
- **WHEN** chapter 25 changes and chapters 26-50 become continuity-stale
- **THEN** selecting the continuity-stale filter SHALL list those chapters with actions to keep, rebuild, or regenerate according to authorization

#### Scenario: Inspect a warning
- **WHEN** a generated chapter has a WARN continuity result
- **THEN** the table SHALL show the warning state and allow the user to inspect structured issues without hiding the chapter

### Requirement: Reviewable arc and continuity actions
The Story workspace SHALL display lightweight arc ranges, goals, conflicts, planned outcomes, and statuses, allow authorized arc-plan edits, and expose explicit actions to rebuild continuity or analyze a manual chapter. Arc and continuity edits SHALL communicate affected stale or invalidated work before execution.

#### Scenario: Edit an arc
- **WHEN** a user changes an arc range or planned outcome
- **THEN** the UI SHALL save a new revision and show the affected plan or chapter work as stale or invalidated rather than silently changing generated text

#### Scenario: Analyze a manual chapter
- **WHEN** a manual chapter lacks a valid state delta
- **THEN** the UI SHALL offer Analyze existing chapter, display the returned summary/state proposal for review, and require explicit acceptance before it changes current StoryState

### Requirement: Usage and context diagnostics
The Story workspace SHALL show bounded usage information, context-budget diagnostics, and unavailable token/cost values honestly. It SHALL not expose credentials, complete prompts, or full chapter contents through dashboard diagnostics.

#### Scenario: Provider usage unavailable
- **WHEN** a valid operation has null token or cost metadata
- **THEN** the UI SHALL display an unavailable value and SHALL not display a fabricated estimate as actual usage
