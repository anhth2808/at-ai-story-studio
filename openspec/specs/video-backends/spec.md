# video-backends Specification

## Purpose
Define explicit local video-generation backends with isolated ComfyUI workflow mappings, honest readiness, backend-specific timing geometry, and reproducible generation metadata while preserving the existing provider-neutral service boundary.

## Requirements

### Requirement: Explicit video backend resolution
Video generation SHALL resolve one typed backend configuration before scheduling. Backend-specific workflow topology, node mapping, model requirements, frame rules, and prompt compilation SHALL remain inside that backend adapter and SHALL NOT be selected through scattered business-layer conditionals. The resolved backend identity SHALL be persisted and fingerprinted.

#### Scenario: Resolve Wan
- **WHEN** a LOW_VRAM or default BALANCED request resolves to Wan 2.2 TI2V-5B
- **THEN** the existing Wan workflow behavior and readiness requirements SHALL execute through the Wan backend adapter

#### Scenario: Resolve LTX-2
- **WHEN** a QUALITY request resolves to a configured ready LTX-2 backend
- **THEN** the LTX-2 workflow adapter SHALL compile and validate its own graph without exposing node IDs to domain requests

### Requirement: Preserve Wan 2.2 TI2V-5B
The existing Wan backend SHALL retain its checkpoint, encoder, VAE, dimensions, legal frame rule, sampler, scheduler, seed, readiness, cancellation, restart reconciliation, and smoke behavior. Introducing another backend SHALL NOT silently alter existing LOW_VRAM or BALANCED Wan requests.

#### Scenario: Reuse a Wan generation
- **WHEN** an existing Wan generation's exact input fingerprint remains current after the backend abstraction is introduced
- **THEN** it SHALL remain reusable without regeneration

### Requirement: Local LTX-2 ComfyUI backend
The system SHALL support the user's configured local LTX-2 distilled ComfyUI workflow through a versioned application-owned template descriptor adapted from the inspected known-good Story-Claw workflow. Runtime settings SHALL contain portable model identifiers rather than absolute machine paths. The application SHALL not download models, modify global ComfyUI, accept arbitrary client workflow JSON, or report LTX when another backend ran.

#### Scenario: Missing LTX model
- **WHEN** the LTX workflow nodes are available but its configured checkpoint or text encoder is absent
- **THEN** readiness SHALL report an LTX model prerequisite failure and SHALL not silently execute Wan

### Requirement: Profile backend preference and audited fallback
Default backend preference SHALL map LOW_VRAM to Wan, BALANCED to Wan, and QUALITY to LTX-2 when ready. The preference SHALL be explicit and configurable within bounded typed values. A profile MAY allow a named fallback such as Wan, but every fallback SHALL be policy-controlled, visible in plan/status/audit metadata, and SHALL never be reported as LTX execution.

#### Scenario: QUALITY LTX unavailable without fallback
- **WHEN** QUALITY prefers LTX-2, LTX readiness fails, and fallback is disabled
- **THEN** video work SHALL block with the exact readiness reason

### Requirement: Backend generation metadata
Every video generation SHALL persist backend, workflow template and mapping version, model/checkpoint identity, text encoder, VAE when applicable, sampler, scheduler, seed, dimensions, legal frame count, FPS, actual duration, bounded backend-specific settings, source image Asset ID/hash, prompt fingerprint, generation attempt, output media metadata, content hash, and generation duration. Ordinary status payloads SHALL omit secrets and large raw workflow graphs.

#### Scenario: Inspect generation provenance
- **WHEN** a completed clip is reviewed after restart
- **THEN** its persisted metadata SHALL identify exactly which backend and reproducible bounded settings produced it

### Requirement: Backend-owned legal frame geometry
Wan and LTX SHALL validate frame geometry independently. Wan SHALL retain its existing legal lattice. The inspected working LTX workflow establishes length as duration multiplied by workflow FPS plus one and the LTX temporal step as 8, so legal LTX frame counts SHALL satisfy `8k + 1` with an adapter-defined minimum and maximum. A frame count legal for one backend SHALL not be assumed legal for another.

#### Scenario: Reject cross-backend geometry
- **WHEN** a requested frame count satisfies Wan's rule but not the configured LTX lattice
- **THEN** the LTX adapter SHALL reject or convert it before submission without changing Wan validation

### Requirement: One backend FPS source of truth
Each backend workflow descriptor SHALL expose one FPS value used by legal frame calculation, graph compilation, generation metadata, and timeline duration math. Backend node IDs and mappings MAY exist only inside the backend descriptor or adapter.

#### Scenario: Change configured LTX FPS
- **WHEN** the approved LTX workflow FPS changes
- **THEN** frame conversion, graph values, actual-duration metadata, and timeline planning SHALL all use the same new value and the workflow fingerprint SHALL change

### Requirement: Backend-aware duration conversion
The system SHALL convert requested duration to a legal backend frame count and actual duration before submission and SHALL persist requested duration, frame count, FPS, and actual duration. It SHALL NOT assume requested and generated durations are equal.

#### Scenario: Snap LTX duration
- **WHEN** a requested duration falls between two legal LTX frame counts
- **THEN** the adapter SHALL select the nearest permitted count within bounds and expose the resulting actual duration

### Requirement: Parent-level frame residual distribution
When multiple Shots share one timing unit, the system SHALL first resolve the parent's legal total frames, distribute legal child frame counts, enforce backend minimums, and let the final eligible Shot absorb a bounded residual so total duration remains as close as practical to target. This SHALL integrate with existing timeline ownership and SHALL not duplicate SceneTiming.

#### Scenario: Allocate three LTX Shots
- **WHEN** one timing group contains three Shots whose independently rounded durations would drift from the group target
- **THEN** allocation SHALL produce legal `8k + 1` counts for each Shot and a bounded total residual computed once at the parent level

### Requirement: Fail-early hooks remain backend-local and optional
A backend MAY expose a validated base-stage quality hook before expensive upscale or refinement when its approved workflow cleanly supports it. Missing optional fail-early topology SHALL not cause the application to install custom nodes or invent an incompatible graph; full-output temporal QC SHALL remain required by policy.

#### Scenario: LTX base-stage gate is available
- **WHEN** the configured approved LTX workflow exposes decoded base frames before latent upscale
- **THEN** the backend MAY run a bounded early semantic gate and stop rejected work before refinement while persisting that verdict
