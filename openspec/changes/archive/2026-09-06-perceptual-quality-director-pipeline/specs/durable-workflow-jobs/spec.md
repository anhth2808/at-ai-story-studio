## ADDED Requirements

### Requirement: Quality workflow units use the existing durable queue
Shot planning, reference generation, image critique, temporal critique, continuation-frame extraction, and backend video generation SHALL use the existing SQLite-backed workflow executions and steps with persisted status, fingerprints, leases, attempts, bounded technical retries, cancellation, restart recovery, and safe errors. No second queue or in-memory quality loop SHALL be introduced.

#### Scenario: Worker restarts during temporal critique
- **WHEN** a temporal critic step loses its worker lease
- **THEN** normal recovery SHALL reconcile committed evaluation evidence or retry the same step without accepting the clip or duplicating generation

### Requirement: Semantic and technical retries remain distinct
Technical retries SHALL preserve the same request fingerprint, seed, references, and intended output. Semantic quality rejection SHALL create a new bounded generation attempt with persisted guidance and lineage. Configuration, missing-model, stale-input, and required-reference failures SHALL not enter creative regeneration loops.

#### Scenario: Missing LTX checkpoint
- **WHEN** LTX readiness reports its configured checkpoint missing
- **THEN** the video step SHALL fail or block as a configuration prerequisite and SHALL not consume a semantic retry

### Requirement: New quality errors remain typed and safe
Workflow results SHALL use stable bounded error codes for invalid Shot plans, required or stale references, binding mismatch, image/temporal QC rejection or unavailability, backend unavailability, invalid LTX workflow/model/frame geometry, and missing continuation source where existing codes are not equivalent. Persisted and API-visible errors SHALL omit secrets, absolute paths, raw graphs, and internal stack traces.

#### Scenario: Reference binding changes in flight
- **WHEN** a bound reference hash changes before an image result commits
- **THEN** the step SHALL record a stale or binding error, retain historical output if valid, and SHALL not promote it current
