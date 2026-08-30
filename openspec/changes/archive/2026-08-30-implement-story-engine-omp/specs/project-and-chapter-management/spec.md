## MODIFIED Requirements

### Requirement: No implicit Story AI in ordinary project and chapter operations

The system SHALL keep ordinary project and chapter create, edit, reorder, and delete operations persistence-only: those operations SHALL use submitted author text and SHALL NOT call OMP, an LLM, or a story-generation provider. Explicit Story Engine operations are a separate user-authorized workflow and MAY generate structured story state or a generated chapter that is then represented through the ordinary chapter lifecycle.

#### Scenario: Manual-only chapter authoring
- **WHEN** a user creates or edits a chapter through the ordinary chapter operation
- **THEN** the system SHALL persist the submitted title/content and SHALL not call OMP, an LLM, or a story-generation provider

#### Scenario: Explicit Story Engine generation
- **WHEN** a user invokes a dedicated Story Engine generation action
- **THEN** the system MAY call the configured AI boundary, SHALL persist the result through the Story Engine contracts, and SHALL not automatically enqueue TTS, subtitles, backgrounds, or rendering

#### Scenario: Generated content enters the editor
- **WHEN** an explicit chapter-generation operation succeeds
- **THEN** the generated chapter SHALL be represented as an ordinary editable chapter revision with source lineage and SHALL remain subject to the existing chapter ownership, ordering, validation, and dependent-output rules
