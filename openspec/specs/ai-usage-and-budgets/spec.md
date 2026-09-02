# ai-usage-and-budgets Specification

## Purpose
Make long-story generation cost and usage observable while keeping provider-specific accounting optional, honest, and safe for local projects.

## Requirements

### Requirement: Persist AI usage metadata
The system SHALL persist one bounded usage record for each applicable AI operation with project, operation type, entity and attempt identifiers, provider and model when available, input and output token counts when available, duration, cost and currency when available, attempt number, status, and creation time. Usage records SHALL never contain credentials, access tokens, full prompts, or full chapter prose.

#### Scenario: Provider returns usage
- **WHEN** an OMP operation returns token counts, duration, model, provider, or cost metadata
- **THEN** the system SHALL persist the available values with the operation and attempt lineage and SHALL expose them through safe project or operation status

#### Scenario: Provider omits usage
- **WHEN** a provider returns a valid structured result without token or cost data
- **THEN** generation SHALL succeed and the unavailable usage fields SHALL remain null rather than being estimated as exact values

### Requirement: Optional project generation guardrails
The system SHALL support optional per-project guardrails for maximum chapters per batch, maximum estimated tokens per operation, maximum retries, and an optional budget with currency. Guardrails SHALL be evaluated before starting work when the required estimate is available and SHALL report a safe blocked status when a known limit would be exceeded.

#### Scenario: Enforce a known batch limit
- **WHEN** a requested batch exceeds the configured maximum chapters per batch
- **THEN** the request SHALL be rejected before creating executable chapter work and SHALL identify the applicable limit

#### Scenario: Enforce a known token limit
- **WHEN** an operation has a known estimate that exceeds the configured maximum estimated tokens
- **THEN** the system SHALL block the operation without invoking OMP and SHALL preserve existing completed outputs

#### Scenario: Do not block unknown costs
- **WHEN** a local or provider operation has no reliable token or cost estimate
- **THEN** the system SHALL not reject basic generation solely because cost information is unavailable and SHALL record null usage values

### Requirement: Usage-safe dashboard reporting
The system SHALL expose aggregate usage and budget state using bounded selective queries. Reports SHALL distinguish known totals from unavailable values and SHALL not require loading all chapter prose or media assets.

#### Scenario: Review a long-story project
- **WHEN** a user opens usage information for a 200-chapter project
- **THEN** the response SHALL return bounded aggregates and recent operation details without returning credentials, full prompts, or all chapter contents
