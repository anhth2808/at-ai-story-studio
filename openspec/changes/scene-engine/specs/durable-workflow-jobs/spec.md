## ADDED Requirements

### Requirement: Persisted scene workflow steps

The workflow system SHALL support independently persisted steps for chapter scene planning, single-scene regeneration, and visual-prompt refresh using the existing status, dependency, attempt, lease, progress, cancellation, and input-fingerprint model. Scene steps SHALL complete only after validated scene data is committed.

#### Scenario: Schedule scene planning
- **WHEN** a user requests scene planning for an existing chapter
- **THEN** the system SHALL persist a durable step and return an identifier that remains observable after the request ends

#### Scenario: Do not start pixel work
- **WHEN** a scene step completes
- **THEN** no image or video provider job SHALL be materialized as a dependency or downstream job

### Requirement: Independent scene retry and regeneration

A technical failure SHALL be retryable against the same current inputs without creating a creative revision. An explicit creative regeneration SHALL create the next current scene revision and SHALL not rerun or invalidate neighboring scene steps.

#### Scenario: Retry failed planning
- **WHEN** a scene-planning attempt fails with a retryable OMP or infrastructure error
- **THEN** the prior current scene plan SHALL remain intact and only the failed step SHALL be eligible for retry

#### Scenario: Regenerate one scene
- **WHEN** a user explicitly regenerates scene 4
- **THEN** only scene 4's workflow step and revision SHALL change, while scenes 1-3 and 5 onward remain unchanged

### Requirement: Scene restart and batch behavior

Scene work SHALL survive API/worker restarts through the existing lease recovery and completed-step reuse rules. Batch requests SHALL support selected chapters or chapters without current scene plans, materialize work chapter-by-chapter, and SHALL not analyze all project chapters unless explicitly selected.

#### Scenario: Recover after restart
- **WHEN** the worker stops during scene planning and a later worker starts
- **THEN** the step SHALL be recovered according to persisted retry policy and committed scene records SHALL not be lost or duplicated

#### Scenario: Generate selected chapters
- **WHEN** a user selects chapters 3 and 8 for scene generation
- **THEN** the system SHALL schedule only those chapter operations and SHALL report per-chapter outcomes
