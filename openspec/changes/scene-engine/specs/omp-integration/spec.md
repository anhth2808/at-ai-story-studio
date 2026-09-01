## ADDED Requirements

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
