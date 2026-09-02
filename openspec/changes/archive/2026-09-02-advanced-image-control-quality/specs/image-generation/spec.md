## MODIFIED Requirements

### Requirement: Minimal project image settings
The system SHALL persist project-owned image settings containing provider, base URL, connection and generation timeout, approved workflow template, model-component selections, width, height, steps, guidance, sampler hint, `RANDOM` or `FIXED` seed mode, conditioning mode, and a default-off `requireImageApproval` policy. It SHALL provide safe defaults without making one URL, model, or resolution the only supported value. Only output-affecting fields SHALL participate in image settings fingerprints and generation invalidation.

#### Scenario: Configure local ComfyUI
- **WHEN** a user saves a valid local ComfyUI URL, approved workflow, available model components, bounded generation settings, and approval policy
- **THEN** the settings SHALL survive restart and SHALL not place model or node values in the Style Bible

#### Scenario: Reject excessive settings
- **WHEN** settings exceed supported bounds or name an unapproved template
- **THEN** the update SHALL fail without replacing the current valid configuration

#### Scenario: Change approval policy only
- **WHEN** a user changes only `requireImageApproval`
- **THEN** existing generation fingerprints and visual freshness SHALL remain unchanged and image-generation jobs SHALL not be invalidated

### Requirement: Immutable Scene image revisions
The system SHALL persist every generated Scene image attempt with a stable application generation ID, project ID, Scene ID, Visual Prompt Package ID, provider, generation status, requested/actual seed, requested/actual dimensions, provider prompt ID, input fingerprint, workflow/version, attempt information, error classification, timestamps, duration, result asset ID when present, optional regeneration feedback, and optional candidate-set identifier and candidate index. A candidate set SHALL persist its common Scene revision, package, effective mode, reference dependency, settings, workflow, and instruction provenance, while every candidate SHALL retain the complete request snapshot required for independent retry and restart recovery. Prior completed revisions and candidate sets SHALL NOT be overwritten.

#### Scenario: Regenerate with a new seed
- **WHEN** a Scene with one completed image is regenerated with a new seed
- **THEN** a second generation revision SHALL be created and the first generation and asset SHALL remain available

#### Scenario: Persist candidate membership
- **WHEN** four generations are scheduled as one candidate set
- **THEN** each generation SHALL reference the same immutable candidate-set identifier with a unique candidate index and its own concrete seed

### Requirement: Generation, freshness, review, and current are separate
A Scene image SHALL expose generation status independently from visual freshness (`CURRENT` or `STALE`), review status (`UNREVIEWED`, `ACCEPTED`, or `REJECTED`), structured quality review, candidate-set membership, and explicit current selection. The system SHALL NOT infer current selection solely from the newest timestamp. Accepting a completed candidate SHALL atomically set it `ACCEPTED` and current. Completing a multi-candidate set SHALL never auto-select a candidate, and completing any generation SHALL never replace an accepted current image. A single generation MAY preserve the existing first-image auto-selection only when no current image exists and project approval is not required.

#### Scenario: Reject the current image
- **WHEN** a user marks a current image `REJECTED`
- **THEN** the review status SHALL change without deleting its asset or generation history and the system SHALL NOT choose a replacement automatically

#### Scenario: Select an older revision
- **WHEN** a user explicitly selects an older valid Scene image revision
- **THEN** that revision SHALL become current and all other revisions for that Scene role SHALL become non-current atomically

#### Scenario: Accept a candidate
- **WHEN** a user accepts a completed non-current candidate
- **THEN** its review status, generation current flag, and Asset current flag SHALL change atomically while every other Scene image remains historical

#### Scenario: Preserve accepted current during generation
- **WHEN** a new image completes while the Scene has an accepted current image
- **THEN** the new image SHALL remain non-current regardless of freshness and the accepted image SHALL remain current

### Requirement: Retry and regenerate are distinct
A technical retry SHALL create another attempt for the same logical generation, candidate membership, input fingerprint, workflow settings, concrete seed, reference mapping, and provider prompt identity. Creative regeneration SHALL create a new logical generation revision in a new candidate set with an explicit same-seed or new-seed choice and optional bounded instructions. Feedback regeneration SHALL additionally persist the source candidate, structured source review, and deterministically assembled guidance. Unrelated completed Scene images SHALL remain untouched.

#### Scenario: Retry a timeout
- **WHEN** an image attempt times out and the user retries it without changing inputs
- **THEN** the same generation record SHALL gain a new attempt or resume checkpoint and SHALL retain the same intended seed and fingerprint

#### Scenario: Add regeneration feedback
- **WHEN** a user regenerates a rejected candidate with structured review feedback
- **THEN** the guidance MAY affect only that new provider prompt and fingerprint and SHALL NOT mutate canonical character, location, object, Scene, Story, Visual Prompt Package, or Style Bible data

### Requirement: Bounded batch generation and backpressure
The system SHALL support one-Scene candidate generation, selected-Scene candidate generation, Chapter missing-image generation, and missing-or-stale generation. A request SHALL contain at most four candidates per Scene and SHALL satisfy a fixed bounded total-job limit before any work is created. It SHALL materialize independently retryable Scene candidate steps, skip matching successful or pending work where applicable, avoid duplicates, and SHALL NOT schedule every project Scene or multiply Scene counts by candidate counts without explicit user action. Local image generation SHALL initially execute with effective concurrency one.

#### Scenario: Batch fails at one Scene
- **WHEN** a bounded selected-Scene batch fails technically at one candidate
- **THEN** completed candidates SHALL remain completed, the failed candidate SHALL be independently retryable, and later eligible work SHALL continue according to the existing batch policy without duplicating prior success

#### Scenario: Reject excessive candidate batch
- **WHEN** the number of selected Scenes multiplied by candidates per Scene exceeds the total-job guardrail
- **THEN** the request SHALL fail atomically before any candidate set, workflow step, or job is created
