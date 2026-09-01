## ADDED Requirements

### Requirement: Persist Scene image workflow steps
The workflow system SHALL support independently persisted `GENERATE_SCENE_IMAGE` work for one Scene and bounded selected/missing/stale batches using the existing workflow execution, step, job, attempt, lease, progress, error, cancellation, retry, dependency, and input-fingerprint model. It SHALL NOT create a second queue or one giant provider workflow containing multiple novel Scenes.

#### Scenario: Schedule one Scene image
- **WHEN** a user requests generation for one eligible Scene
- **THEN** the API SHALL persist one image step/job before the worker contacts the provider

#### Scenario: Schedule a Chapter batch
- **WHEN** a user requests missing images for one Chapter
- **THEN** the workflow SHALL materialize independently retryable eligible Scene steps and SHALL skip matching successful current work

### Requirement: Checkpoint remote image work before completion
A Scene image step SHALL retain a stable provider prompt ID and enough provider checkpoint state to correlate, poll, cancel where supported, and recover submitted work. Provider submission SHALL not mark the step completed. The step SHALL complete only after output validation and conditional generation/Asset persistence.

#### Scenario: Worker restarts after submission
- **WHEN** a worker loses its lease after ComfyUI accepted a prompt
- **THEN** recovery SHALL use the persisted provider prompt ID to inspect the existing remote job before any resubmission

### Requirement: Retry Scene image failures independently
A retryable technical image failure SHALL retry or resume the same logical generation, concrete seed, provider configuration, workflow version, and fingerprint. A creative regeneration SHALL materialize a separate generation revision and workflow step. Completed unrelated Scene image steps SHALL not rerun.

#### Scenario: Retry one failed image
- **WHEN** Scene 8 fails in a multi-Scene batch and the user retries it
- **THEN** only Scene 8's logical generation SHALL receive a new attempt and completed Scene outputs SHALL remain untouched

### Requirement: Guard image completion against stale workers and inputs
The workflow SHALL condition image publication on the active attempt lease, unchanged step fingerprint, CURRENT source package, and current output-affecting configuration. A stale worker or stale input SHALL not move an output Asset or generation revision into the current role. A validated stale output MAY remain historical for audit.

#### Scenario: Visual input changes during execution
- **WHEN** the source package becomes stale while an image step is RUNNING
- **THEN** the step SHALL not publish its result as current even if the provider later succeeds

### Requirement: Image timeout and cancellation use existing control state
Image steps SHALL enforce the configured generation timeout and observe persisted cancellation. Local waiting SHALL stop on cancellation. Remote queued/running work SHALL be cancelled only through provider-supported targeted operations; unsupported or uncertain remote cancellation SHALL be reported explicitly.

#### Scenario: Cancel a queued provider prompt
- **WHEN** cancellation is requested and ComfyUI confirms the matching prompt is pending
- **THEN** the worker SHALL request deletion of that prompt and transition the local step to CANCELLED without publishing partial output
