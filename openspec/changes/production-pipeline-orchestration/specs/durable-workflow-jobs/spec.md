## ADDED Requirements

### Requirement: Production coordination uses the existing durable queue
Production orchestration and publication package work SHALL use the existing persisted workflow-step queue, job mirror, dependency, attempt, lease, retry, cancellation, and restart-recovery machinery. A lightweight `ADVANCE_PRODUCTION_RUN` step MAY coordinate stage scheduling, but it SHALL never execute provider, media, hashing, probing, or filesystem-heavy work and SHALL not create a second queue.

#### Scenario: Advance a run
- **WHEN** a ready ProductionRun is started
- **THEN** the system SHALL persist one bounded coordinator step and SHALL schedule canonical domain steps through the existing queue

#### Scenario: Duplicate advance request
- **WHEN** duplicate start or reconciliation requests target one run
- **THEN** at most one pending/running coordinator step for that run and advance sequence SHALL exist, and completed domain work SHALL not be duplicated

### Requirement: Stage projections follow durable child work
A production stage projection SHALL be linked to the existing workflow steps it coordinates. After a child step completes, fails, is cancelled, or is recovered, the owning ProductionRun SHALL be eligible for a lightweight reconciliation without requiring in-memory queue state. Missing or stale child work SHALL remain visible as incomplete rather than satisfying a stage.

#### Scenario: Worker restart during a stage
- **WHEN** the worker restarts with completed and pending child steps for a ProductionRun
- **THEN** reconciliation SHALL preserve completed valid work, update stage counts, and schedule only the remaining eligible work
