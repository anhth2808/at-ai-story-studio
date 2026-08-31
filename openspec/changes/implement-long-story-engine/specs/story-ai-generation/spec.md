## ADDED Requirements

### Requirement: Long-story structured chapter result
For long-story generation, the AI boundary SHALL return a validated structured result containing title, content, compact summary, appearing character identifiers, dynamic character state updates, thread updates, new or resolved threads, important events, important facts, location changes, and any continuity warnings. The result SHALL be treated as an untrusted proposal until schema and reference validation succeeds.

#### Scenario: Accept a valid chapter result
- **WHEN** the boundary returns a result whose fields and references satisfy the configured schema
- **THEN** the application SHALL make the chapter and its proposed continuity metadata available for deterministic reduction and review

#### Scenario: Reject an unknown reference
- **WHEN** the result names a character or thread that is not present in the current story state or blueprint
- **THEN** the operation SHALL fail with a structured-output or validation category and SHALL not promote chapter state as complete

### Requirement: Hierarchical planning and analysis operations
The system SHALL support separate provider-independent operations for arc planning, bounded chapter-plan windows, continuity checking, and analyzing an existing manual chapter. Each operation SHALL return a typed validated result or a safe classified failure and SHALL use only the bounded inputs relevant to that operation.

#### Scenario: Generate an arc window
- **WHEN** a long-story project requests planning for chapters 41-60
- **THEN** the operation SHALL return only the requested arc/window artifact with stable chapter references and SHALL not require all prior detailed chapter plans in its response

#### Scenario: Analyze existing manual content
- **WHEN** a user requests analysis of a manually edited chapter with its plan and prior StoryState
- **THEN** the operation SHALL return summary, StateDelta, and continuity metadata suitable for explicit review before persistence

#### Scenario: Check continuity
- **WHEN** continuity checking is enabled after chapter generation
- **THEN** the operation SHALL compare the generated result with the relevant plan and StoryState and SHALL return a structured PASS, WARN, or FAIL result without initiating automatic regeneration

### Requirement: GenerationContext V2 diagnostics
The system SHALL expose bounded context diagnostics for each long-story chapter operation, including estimated token size, configured budget, selected and omitted context sections, selected character and thread counts, recent summaries included, source revision identifiers, and compression or truncation reasons. The compiler SHALL use deterministic priority ordering and SHALL not include complete prior chapter prose by default.

#### Scenario: Context remains bounded at scale
- **WHEN** the same context budget is used to generate chapters 10, 50, 100, and 200
- **THEN** estimated context size SHALL remain within the configured bound and SHALL not grow in proportion to the number of prior chapters

#### Scenario: Diagnose omitted context
- **WHEN** lower-priority events, inactive characters, resolved threads, or old summaries are omitted
- **THEN** the operation metadata SHALL identify the omission category and retain the required plan, blueprint essentials, previous summary, critical threads, and current character state where available

### Requirement: Classified generation failures
The system SHALL distinguish infrastructure errors, provider errors, structured-output errors, context errors, continuity errors, and user-cancelled operations in safe workflow and operation results. Automatic retries SHALL be limited to transient infrastructure/provider failures and bounded structured-output repair attempts; a continuity failure SHALL remain a user-visible review or regeneration decision.

#### Scenario: Retry a transient provider failure
- **WHEN** a provider or isolated host fails transiently before a result is committed
- **THEN** the workflow SHALL expose a retryable provider or infrastructure category and SHALL preserve the prior current story state

#### Scenario: Do not retry a creative continuity failure blindly
- **WHEN** a continuity check returns FAIL for an otherwise valid chapter
- **THEN** the system SHALL retain the chapter for review, expose the issues, and SHALL not automatically repeat generation indefinitely

#### Scenario: Cancel an operation
- **WHEN** a user cancels a running story operation
- **THEN** the operation SHALL return a user-cancelled category and SHALL not commit partial structured output or state changes