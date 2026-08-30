## ADDED Requirements

### Requirement: Story AI workflow steps

The workflow system SHALL support independently persisted steps for `GENERATE_STORY_BLUEPRINT`, `GENERATE_CHAPTER_PLANS`, `GENERATE_CHAPTER`, and `GENERATE_CHAPTER_SUMMARY`, with dependency links, input fingerprints, attempts, leases, progress, safe errors, cancellation, and restart recovery using the existing workflow status model.

#### Scenario: Generate a story in stages
- **WHEN** a user requests blueprint, plan, and chapter generation
- **THEN** the system SHALL persist the stages and their dependencies so a failed chapter step can be retried without regenerating valid blueprint, plan, or sibling chapter steps

#### Scenario: Chapter waits for prerequisites
- **WHEN** a chapter step has no current validated blueprint or matching plan item
- **THEN** the chapter step SHALL remain blocked/pending with the named prerequisite rather than calling the AI boundary

#### Scenario: Summary failure is isolated
- **WHEN** chapter content succeeds but its summary step fails
- **THEN** chapter content SHALL remain reviewable, summary SHALL be retryable independently, and TTS/subtitle/render work SHALL not be started by the summary failure or recovery

### Requirement: Story AI input fingerprints and invalidation

Story AI steps SHALL fingerprint all relevant story revisions, selected context records, prompt/template versions, generation settings, and configured model identity. A change SHALL invalidate only steps and media descendants whose fingerprints depend on that change.

#### Scenario: Change one plan item
- **WHEN** a user edits the plan input for chapter 4
- **THEN** the system SHALL invalidate chapter 4 and its summary/media descendants while retaining current steps for unrelated chapters

#### Scenario: Change provider model
- **WHEN** a user changes the configured model before retrying a failed operation
- **THEN** the retry SHALL record the new model in its fingerprint and provenance without rewriting unrelated completed story outputs

### Requirement: Story AI progress and diagnostics

Story AI steps SHALL persist safe progress messages, operation stage, attempt number, provider/model identifiers when available, bounded diagnostic details, retryability, and cancellation state. Prompts, source prose, credentials, and raw provider payloads SHALL not be written to routine progress or client-safe errors.

#### Scenario: Observe a running chapter
- **WHEN** a chapter generation step is running
- **THEN** a later status read SHALL show its durable stage, progress or indeterminate state, attempt, and safe message even after the original request ends

#### Scenario: Recover a lost OMP host
- **WHEN** an OMP host or worker disappears before committing a result
- **THEN** the active attempt SHALL be closed as lost and the step SHALL become retryable or terminal according to policy without promoting partial output
