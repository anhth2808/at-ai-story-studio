## Purpose

Provide a controlled OMP-backed execution boundary for story generation that supports configured models, structured results, cancellation, diagnostics, and safe local operation without exposing OMP session or provider details to story and media features.

## ADDED Requirements

### Requirement: Controlled OMP-backed execution

The system SHALL execute story-generation operations through a configured OMP-backed agent boundary. A story request SHALL be able to select a configured model or the documented configured default, and the boundary SHALL return only the operation result, bounded usage metadata, and typed error information.

#### Scenario: Run with a configured model
- **WHEN** a valid story operation selects an authenticated configured model
- **THEN** the boundary SHALL submit the request, collect the settled structured result, and return provider/model provenance without exposing provider credentials

#### Scenario: No model is available
- **WHEN** no authenticated configured model can satisfy the request
- **THEN** the boundary SHALL fail before committing story state with an actionable configuration error and SHALL report setup guidance without exposing secrets

### Requirement: Tool and workspace isolation

Story-generation execution SHALL not use arbitrary filesystem, shell, network, MCP, or host-owned tools. The boundary SHALL run with only the capabilities explicitly required for the structured generation request and SHALL reject tool calls or tool outputs that are outside that contract.

#### Scenario: Model attempts an unapproved tool
- **WHEN** a model attempts to invoke an unavailable or unapproved tool during story generation
- **THEN** the operation SHALL fail safely or continue without that tool according to the configured policy, SHALL not mutate project files or secrets, and SHALL record a bounded diagnostic

#### Scenario: Prompt contains tool-like instructions
- **WHEN** story text or user notes contain instructions to execute commands or access files
- **THEN** the boundary SHALL treat them as story data, not as authorization, and SHALL not execute them

### Requirement: Process and protocol boundary

The Node application SHALL communicate with an isolated OMP execution host through a versioned, typed local request/response protocol. The protocol SHALL support operation identity, correlation, input fingerprint, selected model, structured result, bounded diagnostics, deadline, and cancellation. OMP SDK-specific types SHALL not cross into feature or domain contracts.

#### Scenario: Host returns a structured response
- **WHEN** an isolated execution request completes
- **THEN** the protocol SHALL return a versioned response that the Node boundary can validate before domain commit

#### Scenario: Host exits unexpectedly
- **WHEN** the isolated OMP host exits or the protocol stream becomes invalid
- **THEN** the active story step SHALL become retryable or terminal according to its policy, SHALL retain a safe error category, and SHALL not promote partial output as current

### Requirement: Timeout and cancellation

The execution boundary SHALL enforce a per-operation deadline and SHALL propagate durable workflow cancellation to the active OMP session and host process. Cancellation SHALL be distinguishable from provider failure and SHALL not commit partial story results.

#### Scenario: Cancel a running generation
- **WHEN** a user cancels a running blueprint, plan, chapter, or summary operation
- **THEN** the boundary SHALL stop accepting output, request session cancellation, terminate the isolated host within the configured window if necessary, and return a cancelled result without current-state promotion

#### Scenario: Generation exceeds its deadline
- **WHEN** an operation exceeds its configured deadline
- **THEN** the boundary SHALL stop the operation, persist a timeout category with bounded diagnostics, and make the step retryable when the input remains valid

### Requirement: Authentication and configuration safety

The system SHALL expose only non-secret OMP configuration state to the application UI and database. Credentials SHALL be resolved through the supported OMP authentication/configuration mechanism or an approved secret store, and SHALL never be written to SQLite, API responses, routine logs, workflow errors, or generation metadata.

#### Scenario: Check provider readiness
- **WHEN** a user opens Story settings
- **THEN** the UI SHALL show configured provider/model readiness and safe setup guidance, but SHALL not return an API key, access token, or credential file contents

#### Scenario: Redact an execution failure
- **WHEN** an OMP or provider error contains a credential-like value
- **THEN** persisted diagnostics and client-safe errors SHALL redact it before storage or display

### Requirement: Session lifecycle hygiene

Each isolated story operation SHALL have a bounded session lifetime and SHALL release session and process resources on success, failure, timeout, cancellation, or worker shutdown. Completed story steps SHALL not retain a live OMP session.

#### Scenario: Dispose after success
- **WHEN** a story operation completes successfully
- **THEN** the execution host SHALL close the operation session and return only persisted result data and metadata

#### Scenario: Worker restarts
- **WHEN** the Node worker restarts after losing an OMP operation
- **THEN** persisted workflow recovery SHALL classify the attempt as worker-lost or host-lost and SHALL not assume an unpersisted OMP response succeeded
