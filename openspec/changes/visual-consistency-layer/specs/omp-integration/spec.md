## ADDED Requirements

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
