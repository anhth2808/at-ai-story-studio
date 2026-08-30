# Durable workflow jobs Specification

## Purpose

Provide persisted, dependency-aware execution state that survives process restarts and allows long-running narration and rendering work to be retried at the smallest practical unit.

## Requirements

### Requirement: Persisted workflow state
The system SHALL persist workflow executions, steps, dependencies, attempts, progress, errors, cancellation requests, and timestamps in the local database. Supported statuses SHALL include `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `INVALIDATED`, and `CANCELLED`.

#### Scenario: Create work
- **WHEN** an API operation requests narration, subtitle, background preparation, or rendering
- **THEN** the system SHALL persist the corresponding execution/step state before work begins and SHALL return a durable work identifier

#### Scenario: Persist progress
- **WHEN** a worker makes progress on a running step
- **THEN** current progress, safe message, attempt, and update time SHALL be persisted and visible to later status reads

### Requirement: Dependency-aware execution
A pending step SHALL be claimable only when all required dependencies are completed and current. A blocked dependent SHALL remain persisted as pending and SHALL expose its incomplete or failed prerequisites in status responses.

#### Scenario: Do not render missing inputs
- **WHEN** narration, background, or subtitle prerequisites are not current
- **THEN** the render step SHALL not execute and SHALL report the named prerequisite state

### Requirement: Atomic job claiming
The worker SHALL claim at most one eligible pending step at a time using a conditional durable transition that prevents duplicate execution under normal operation. Claiming SHALL persist the active attempt and lease before external work starts.

#### Scenario: Two workers race
- **WHEN** two worker processes attempt to claim the same eligible step
- **THEN** exactly one claim SHALL succeed and the other SHALL execute nothing for that step

### Requirement: Retry at unit scope
A failed step SHALL be explicitly retryable when its inputs remain valid. Retrying SHALL create a new attempt and SHALL reuse completed valid child units instead of rerunning them.

#### Scenario: Retry one failed TTS segment
- **WHEN** TTS segments 1 and 2 are completed and segment 3 is failed, then the user retries TTS
- **THEN** segments 1 and 2 SHALL not execute again and only segment 3 (plus required downstream merge work) SHALL execute

### Requirement: Cancellation
Cancellation requests SHALL be persisted. A worker SHALL observe cancellation before starting work, between units, and during cancellable external processes, then transition the active work to `CANCELLED` without promoting partial outputs to current assets.

#### Scenario: Cancel a running render
- **WHEN** a user cancels an active render
- **THEN** the worker SHALL stop the process within the configured termination window, retain diagnostics as non-current staging/history, and expose `CANCELLED`

### Requirement: Restart recovery
On startup, the worker SHALL recover expired running leases by closing the lost attempt and transitioning the step to pending retry or failed according to its retry policy. Completed steps SHALL not be rerun merely because a process restarted.

#### Scenario: Worker dies during a step
- **WHEN** a worker stops while a step is running and its lease expires
- **THEN** a subsequent worker SHALL mark the prior attempt as worker-lost and deterministically make the step retryable or terminal, while leaving completed sibling steps untouched

### Requirement: Safe errors
Failed work SHALL persist a stable error category/code, safe user message, retryability, and bounded technical diagnostics. Secrets and full source prose SHALL not be emitted in routine logs or client responses.

#### Scenario: External tool fails
- **WHEN** FFmpeg, ffprobe, or TTS exits unsuccessfully or times out
- **THEN** the step SHALL become visibly failed with actionable safe details and the process result/diagnostic SHALL remain bounded

### Requirement: Story AI workflow steps
The workflow system SHALL support independently persisted steps for `GENERATE_STORY_BLUEPRINT`, `GENERATE_CHAPTER_PLANS`, `GENERATE_CHAPTER`, and `GENERATE_CHAPTER_SUMMARY`, with dependency links, input fingerprints, attempts, leases, progress, safe errors, cancellation, and restart recovery using the existing workflow status model.

#### Scenario: Generate a story in stages
- **WHEN** a user requests blueprint, plan, and chapter generation
- **THEN** the system SHALL persist the stages and their dependencies so a failed chapter step can be retried without regenerating valid blueprint, plan, or sibling chapter steps

#### Scenario: Chapter waits for prerequisites
- **WHEN** a chapter step has no current validated blueprint or matching plan item
- **THEN** the chapter step SHALL remain blocked/pending with the named prerequisite rather than calling the AI boundary

#### Scenario: Summary failure is isolated
- **WHEN** chapter content succeeds but its summary step fails
- **THEN** chapter content SHALL remain reviewable, summary SHALL be retryable independently, and TTS/subtitle/render work SHALL not be started by the summary failure or recovery

### Requirement: Story AI input fingerprints and invalidation
Story AI steps SHALL fingerprint all relevant story revisions, selected context records, prompt/template versions, generation settings, and configured model identity. A change SHALL invalidate only steps and media descendants whose fingerprints depend on that change.

#### Scenario: Change one plan item
- **WHEN** a user edits the plan input for chapter 4
- **THEN** the system SHALL invalidate chapter 4 and its summary/media descendants while retaining current steps for unrelated chapters

#### Scenario: Change provider model
- **WHEN** a user changes the configured model before retrying a failed operation
- **THEN** the retry SHALL record the new model in its fingerprint and provenance without rewriting unrelated completed story outputs

### Requirement: Story AI progress and diagnostics
Story AI steps SHALL persist safe progress messages, operation stage, attempt number, provider/model identifiers when available, bounded diagnostic details, retryability, and cancellation state. Prompts, source prose, credentials, and raw provider payloads SHALL not be written to routine progress or client-safe errors.

#### Scenario: Observe a running chapter
- **WHEN** a chapter generation step is running
- **THEN** a later status read SHALL show its durable stage, progress or indeterminate state, attempt, and safe message even after the original request ends

#### Scenario: Recover a lost OMP host
- **WHEN** an OMP host or worker disappears before committing a result
- **THEN** the active attempt SHALL be closed as lost and the step SHALL become retryable or terminal according to policy without promoting partial output
