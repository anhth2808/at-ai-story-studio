# Story AI generation Specification

## Purpose

Define the observable story-generation contract: structured outputs, deterministic bounded context, validation, continuity metadata, and safe failure behavior for blueprint, plan, chapter, and summary generation.

## Requirements

### Requirement: Structured story-generation operations
The system SHALL support separate generation operations for a story blueprint, chapter plans, a single chapter, and a chapter summary. Each operation SHALL accept the current project/story revision inputs and SHALL return a typed result or a safe retryable failure; free-form text SHALL NOT be treated as a successful result for an operation requiring structured data.

#### Scenario: Generate a blueprint
- **WHEN** a valid idea-generation configuration is submitted
- **THEN** the operation SHALL return a blueprint with premise, themes, world rules, plot direction, structured characters, and generation metadata

#### Scenario: Generate chapter plans
- **WHEN** a validated current blueprint is submitted
- **THEN** the operation SHALL return ordered plan items bounded by the configured target chapter count and include the required planning fields for each item

#### Scenario: Generate one chapter
- **WHEN** a validated blueprint, selected plan item, and generation instructions are submitted
- **THEN** the operation SHALL return chapter title, narration-ready content, compact summary, event/thread transitions, used-character identifiers, introduced-character identifiers, and continuity warnings

#### Scenario: Generate a summary
- **WHEN** a current chapter is submitted for summary generation
- **THEN** the operation SHALL return a compact summary and explicit key facts, character state changes, and open/resolved thread references

### Requirement: Schema validation before commit
The system SHALL validate every external generation result against the operation's runtime schema before committing it as current domain state. Validation failure SHALL preserve the prior current result, persist bounded diagnostics, and expose a retryable failure without creating downstream media work.

#### Scenario: Model returns invalid JSON
- **WHEN** a generation response cannot be parsed or fails the operation schema
- **THEN** the operation SHALL fail with a safe validation category and SHALL leave current story and media outputs unchanged

#### Scenario: Model returns extra untrusted fields
- **WHEN** a response contains fields outside the accepted operation contract
- **THEN** the system SHALL ignore or reject them according to the schema policy and SHALL never persist executable instructions, secrets, or arbitrary provider payloads as domain state

### Requirement: Bounded deterministic generation context
The system SHALL compile chapter context from the current blueprint, selected characters, current chapter plan, prior chapter summary, recent summaries, relevant open threads, latest relevant facts, and explicit generation instructions. The compiler SHALL enforce a configured context budget with a default maximum of 5,000 tokens or equivalent bounded size.

#### Scenario: Generate a later chapter
- **WHEN** chapter 20 is generated
- **THEN** the context SHALL contain compact continuity state and relevant selected records rather than the full prose of chapters 1 through 19

#### Scenario: Missing prior summary
- **WHEN** a required prior summary is missing or stale
- **THEN** the system SHALL either use the documented fallback summary path or fail with an actionable prerequisite state, and SHALL expose the limitation in generation metadata or diagnostics

#### Scenario: Long-story scaling review
- **WHEN** the context compiler is evaluated for 50, 100, and 200 chapter projects
- **THEN** context size and selection work SHALL remain bounded by configured limits and SHALL not require embeddings, a vector database, or full-history prompt assembly

### Requirement: Continuity metadata and event proposals
A successful chapter result SHALL persist compact summary data, generated events, character-state changes, story-thread transitions, unresolved threads, and continuity warnings separately from chapter prose. Event transitions SHALL be auditable and SHALL not silently mutate unrelated chapters.

#### Scenario: Chapter introduces a fact
- **WHEN** chapter generation reports a new fact or thread
- **THEN** the system SHALL persist it with the chapter and blueprint/plan revision lineage so later context can select it deterministically

#### Scenario: Continuity warning exists
- **WHEN** generation reports a possible contradiction or unresolved continuity issue
- **THEN** the chapter SHALL remain reviewable, the warning SHALL be visible to the user, and the system SHALL not silently rewrite prior authored content

### Requirement: Generation metadata
Each successful or failed generation attempt SHALL record operation type, input fingerprint, provider and model identifiers when available, prompt/template version, timestamps, duration, token usage when available, attempt number, and safe cost or usage metadata when available. Secrets, access tokens, and full chapter prose SHALL be excluded from routine logs and client diagnostics.

#### Scenario: Inspect generation provenance
- **WHEN** a user or operator views a generated result
- **THEN** the system SHALL show enough metadata to reproduce or diagnose the request without exposing credentials or dumping the complete prompt into routine logs

#### Scenario: Provider omits usage
- **WHEN** the configured provider does not return token or cost data
- **THEN** the system SHALL preserve the result with those fields marked unavailable rather than inventing values

### Requirement: Provider-independent story domain
Story behavior SHALL depend on the application-owned AI boundary and operation schemas rather than a provider-specific API or model response shape. Changing the configured provider or model SHALL affect only generation execution and provenance, not project, chapter, continuity, or media domain contracts.

#### Scenario: Swap the configured model
- **WHEN** a user selects another configured model that satisfies the operation contract
- **THEN** the same story operation and validation path SHALL execute with new provenance and SHALL not require changes to chapter or media consumers

### Requirement: No automatic future-stage generation
Story generation SHALL stop at reviewable text and continuity state for this change. It SHALL NOT generate images, videos, character-memory embeddings, scene graphs, shot plans, WhisperX alignments, F5-TTS output, ComfyUI assets, image-to-video output, or publishing artifacts.

#### Scenario: Complete a chapter operation
- **WHEN** a chapter operation succeeds
- **THEN** the result SHALL be text and structured story state only, with media handoff available only through the explicit existing workflow action
