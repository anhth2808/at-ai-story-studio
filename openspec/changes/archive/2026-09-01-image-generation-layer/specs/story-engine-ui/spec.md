## ADDED Requirements

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
