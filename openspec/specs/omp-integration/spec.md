# OMP integration Specification

## Purpose

Provide a controlled OMP-backed execution boundary for story generation that supports configured models, structured results, cancellation, diagnostics, and safe local operation without exposing OMP session or provider details to story and media features.

## Requirements

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

### Requirement: Allowlisted visual operations
The OMP integration SHALL carry allowlisted character-profile, location-profile, recurring-object-profile, and optional visual-prompt-refinement operations through the existing isolated execution boundary. Feature contracts SHALL remain provider-neutral and SHALL not expose OMP SDK types, credentials, tools, or arbitrary filesystem access.

#### Scenario: Run a visual profile operation
- **WHEN** a valid visual-profile request selects an authenticated configured model
- **THEN** the boundary SHALL return a versioned structured result with safe provider/model provenance and bounded usage metadata

#### Scenario: Reject an unapproved operation
- **WHEN** a request names an operation outside the visual/story allowlist
- **THEN** the isolated host SHALL reject it safely without project-state or filesystem mutation

### Requirement: Apply existing isolation and lifecycle rules
Visual operations SHALL use the same deadline, cancellation, session disposal, error redaction, protocol validation, and restart behavior as existing Story operations. OMP readiness or host success SHALL not be treated as domain validation success.

#### Scenario: Cancel profile generation
- **WHEN** durable workflow cancellation reaches a running profile operation
- **THEN** the host SHALL stop accepting output, dispose the session, and return cancellation without promoting a candidate

#### Scenario: Provider omits usage
- **WHEN** the OMP result lacks token or cost information
- **THEN** the operation SHALL persist those values as unavailable rather than estimating or labeling them as free

### Requirement: Carry structured scene operations through OMP
The OMP boundary SHALL accept scene-planning, single-scene-regeneration, and visual-prompt-refresh operation identities using the existing versioned local protocol. It SHALL carry operation, correlation, model, prompt/schema versions, input fingerprint, bounded system/user prompts, deadline, and one validated terminal result without exposing SDK types to story features.

#### Scenario: Complete scene planning through OMP
- **WHEN** an authenticated configured OMP model receives a valid scene request
- **THEN** the host SHALL return one correlated structured result with bounded provenance suitable for application validation and persistence

#### Scenario: Preserve operation identity
- **WHEN** a host response names a different operation or correlation ID
- **THEN** the Node boundary SHALL reject it safely and SHALL not commit scene data

### Requirement: Keep scene prompts and source data isolated
Scene planning SHALL execute in the existing restricted isolated OMP session with tools, MCP, LSP, extensions, shell, and arbitrary filesystem mutation disabled. Chapter text and user notes SHALL be treated as untrusted data rather than authorization.

#### Scenario: Prompt contains command-like text
- **WHEN** chapter content includes instructions resembling shell or file operations
- **THEN** the OMP host SHALL treat them as scene source data and SHALL not execute them or mutate project files

### Requirement: Safe scene errors and nullable usage
OMP host, provider, protocol, timeout, cancellation, and structured-output failures SHALL map to the existing safe categories and retry policy. Provider/model/token/cost metadata SHALL be retained only when actually exposed; unavailable usage SHALL remain null and SHALL not block a valid scene result.

#### Scenario: Provider omits usage
- **WHEN** a valid scene operation completes without token or cost telemetry
- **THEN** the result SHALL persist successfully with unknown usage values and shall not fabricate an estimate

#### Scenario: Host fails before result
- **WHEN** the isolated host exits before returning a terminal scene result
- **THEN** the workflow SHALL retain a bounded retryable or terminal error and SHALL not promote partial scenes

### Requirement: Long-story OMP operation contracts
The controlled OMP boundary SHALL support separate typed requests and terminal structured results for arc planning, bounded chapter-plan windows, long-story chapter generation, StateDelta or manual chapter analysis, and optional continuity checks. These operations SHALL use the same isolated session and protocol safety guarantees as existing Story operations, and OMP SDK-specific types SHALL not cross the application boundary.

#### Scenario: Run bounded chapter generation
- **WHEN** the worker submits a chapter-generation request with a bounded GenerationContext and current input fingerprint
- **THEN** the OMP boundary SHALL return one validated transport result containing structured chapter data and provenance without mutating SQLite or project files directly

#### Scenario: Run continuity analysis
- **WHEN** an enabled continuity or manual-analysis operation is requested
- **THEN** the boundary SHALL execute it as an explicit typed operation and SHALL return structured data or a safe classified failure without automatically scheduling regeneration

### Requirement: Usage and diagnostics propagation
When the OMP runtime or configured provider exposes token, duration, model, provider, or cost information, the boundary SHALL propagate only bounded non-secret values to the application. Missing values SHALL remain null. Protocol and host diagnostics SHALL remain bounded and SHALL not include complete prompts, chapter prose, or credentials.

#### Scenario: Propagate available usage
- **WHEN** an OMP result includes input and output token counts
- **THEN** the application SHALL receive those values with operation and attempt provenance for persistence in usage records

#### Scenario: Omit unavailable cost
- **WHEN** the OMP runtime does not expose token or cost metadata
- **THEN** the boundary SHALL still return a valid structured result with null usage fields and SHALL not fabricate values

### Requirement: Stable long-story error categories
The OMP boundary SHALL map host, provider, protocol, timeout, cancellation, context, and structured-output failures into stable safe categories usable by the durable story workflow. A continuity-check FAIL SHALL be returned as a structured evaluation result rather than an infrastructure retry signal.

#### Scenario: Host loss during a batch chapter
- **WHEN** the isolated OMP host exits before returning a terminal result
- **THEN** the boundary SHALL return a retryable host or infrastructure category, SHALL not promote partial output, and SHALL allow durable batch recovery

#### Scenario: Cancel an OMP operation
- **WHEN** durable workflow cancellation reaches an active long-story operation
- **THEN** the boundary SHALL stop the session/process, return a cancelled category, and SHALL not emit a successful terminal result
