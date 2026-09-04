## ADDED Requirements

### Requirement: AI video generation and normalization steps
The system SHALL add `GENERATE_AI_SCENE_VIDEO` and `NORMALIZE_AI_SCENE_CLIP` step types to the existing workflow graph, job mirror, lease/attempt, retry, cancellation, and restart-recovery machinery - not a second queue. Generation steps SHALL persist a full request snapshot, provider job id, input fingerprint, and long configurable timeout; normalization steps SHALL depend on their generation step and reuse the SceneClip promotion and probe validation path. Local video generation concurrency SHALL remain one (the existing single-step worker claim), and retry (same intended output) SHALL stay distinct from regenerate (new revision and seed).

#### Scenario: Failed generation retries independently
- **WHEN** an AI generation step fails technically
- **THEN** retrying it SHALL resubmit the identical request snapshot (reconciling any persisted provider job id first) without creating a new revision or affecting sibling Scene steps

#### Scenario: Worker restart mid-generation
- **WHEN** the worker dies while a generation step is RUNNING
- **THEN** lease recovery SHALL return the step to PENDING and the next attempt SHALL reconcile the persisted provider job id through ComfyUI history/queue instead of duplicate-submitting
