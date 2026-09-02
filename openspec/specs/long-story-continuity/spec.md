# long-story-continuity Specification

## Purpose
Provide compact, application-owned narrative memory that keeps long stories coherent, reviewable, and recoverable without sending the complete prior novel to every generation request.

## Requirements

### Requirement: Revisioned canonical StoryState
The system SHALL persist a compact current StoryState for each configured story project and SHALL retain enough revision/checkpoint lineage to inspect or rebuild state after a completed chapter. StoryState SHALL include the project identifier, current chapter number, revision, rolling progress summary, current arc and phase, character states, open or recently changed threads, resolved threads, important facts, recent events, bounded world state, and last-updated timestamp. The rolling summary SHALL remain advisory; canonical structured fields SHALL remain authoritative.

#### Scenario: Initialize story state
- **WHEN** a story blueprint and first chapter are accepted
- **THEN** the system SHALL create a revisioned StoryState checkpoint associated with the project and chapter, including only validated references to blueprint characters, threads, facts, and events

#### Scenario: Commit a completed chapter checkpoint
- **WHEN** a chapter content, summary, and validated state delta are finalized
- **THEN** the system SHALL advance StoryState exactly once for that chapter and SHALL expose the new revision as the current checkpoint only after all required state is persisted

#### Scenario: Keep canonical state separate from prose summary
- **WHEN** a rolling story summary disagrees with a structured character, thread, fact, or event record
- **THEN** context selection and state rebuild operations SHALL use the structured record as canonical and SHALL retain the summary only as bounded assistance

### Requirement: Dynamic character state
The system SHALL keep stable blueprint Character definitions separate from revisioned dynamic CharacterState. Dynamic state SHALL support at least location, current goal, power or capability level, injuries, possessions, relationships, knowledge, and last-updated chapter, using bounded structured fields. A state update SHALL reference an existing stable character identifier and SHALL NOT create a duplicate character implicitly.

#### Scenario: Update an existing character
- **WHEN** a chapter result proposes a valid state update for a blueprint character
- **THEN** the system SHALL persist the update in CharacterState while leaving the stable Character definition unchanged

#### Scenario: Reject an unknown character reference
- **WHEN** a chapter result proposes state for a character identifier absent from the current blueprint
- **THEN** the system SHALL reject the state delta, preserve the prior StoryState checkpoint, and expose a structured validation failure

### Requirement: Typed story thread lifecycle
The system SHALL persist project-local story threads with stable identifiers, title, description, type, status, importance, related character identifiers, introduction chapter, last-touched chapter, expected resolution range, and resolved chapter when applicable. Supported thread types SHALL include mystery, goal, promise, revenge, romance, conflict, quest, secret, and foreshadowing. Supported statuses SHALL be `OPEN`, `PROGRESSING`, `RESOLVED`, and `ABANDONED`.

#### Scenario: Progress an active thread
- **WHEN** a validated chapter delta references an existing thread with a progress update
- **THEN** the system SHALL create an auditable current thread revision with `PROGRESSING` status and the current chapter as the last-touched chapter

#### Scenario: Resolve or abandon a thread
- **WHEN** a validated chapter delta resolves or abandons an existing thread
- **THEN** the system SHALL persist the terminal status and chapter without deleting prior revisions or changing unrelated threads

#### Scenario: Reject a malformed thread transition
- **WHEN** a delta references an unknown thread or an unsupported status
- **THEN** the system SHALL fail validation and SHALL not mutate current thread or StoryState records

### Requirement: Lightweight story arcs and hierarchical planning
For a story whose target exceeds 20 chapters, the system SHALL support lightweight ordered StoryArcs with chapter ranges, title, goal, conflict, important characters or threads, planned outcome, and status. Detailed chapter planning SHALL be available in configurable windows with a default bounded window in the 10-25 chapter range, and SHALL not require one response containing every detailed chapter plan. Stories of 20 chapters or fewer MAY retain all-at-once planning.

#### Scenario: Plan a long story hierarchically
- **WHEN** a user requests planning for a target of 100 chapters
- **THEN** the system SHALL create or expose arc-level planning and SHALL allow detailed plans to be generated for a bounded window such as chapters 1-20 without requiring plans 21-100 in the same operation

#### Scenario: Review arc coverage
- **WHEN** all configured arcs are planned
- **THEN** the system SHALL expose deterministic start and end chapter ranges whose union covers the configured target without overlap or gaps

#### Scenario: Edit an arc plan
- **WHEN** a user edits an arc goal, conflict, range, or planned outcome
- **THEN** the system SHALL create a new arc revision and SHALL mark affected downstream plan or continuity work stale or invalidated according to its dependency while preserving prior revisions

### Requirement: Deterministic bounded continuity context
The system SHALL build chapter context from a global blueprint, current arc and plan, relevant stable characters and CharacterState, prior and recent summaries, relevant active threads, important facts, recent events, and useful future arc direction. Selection SHALL be deterministic and explainable: explicit plan references, recent chapter participation, active thread references, importance, expected resolution proximity, and recency SHALL determine relevance. The context SHALL enforce a configurable token-equivalent budget and SHALL never concatenate all prior chapter prose or automatically include all characters or threads.

#### Scenario: Generate chapter 200
- **WHEN** chapter 200 is generated in a 200-chapter simulation
- **THEN** the request SHALL contain bounded structured context and diagnostics rather than the complete prose or an unbounded list of prior chapters

#### Scenario: Inspect context diagnostics
- **WHEN** context selection omits or compresses candidates to fit the configured budget
- **THEN** the result SHALL report estimated tokens, selected character/thread counts, included recent summaries, and omitted or truncated sections without logging full novel text

#### Scenario: Preserve required context under overflow
- **WHEN** the selected context exceeds its budget
- **THEN** the system SHALL retain the current chapter plan, blueprint essentials, previous summary, critical active threads, and current character state before dropping low-importance events, inactive characters, resolved old threads, or older summaries

### Requirement: Application-owned StateDelta reduction
The AI boundary SHALL return proposed structured state changes rather than mutating persistent StoryState. The application SHALL validate StateDelta references and field bounds, apply changes through deterministic reducer rules, and persist the resulting checkpoint. Invalid or conflicting proposals SHALL fail safely without partially promoting state.

#### Scenario: Apply a valid chapter delta
- **WHEN** a generated chapter returns valid character updates, thread updates, events, facts, and arc progress
- **THEN** the reducer SHALL apply those changes in a deterministic order and SHALL persist the resulting StoryState revision linked to the chapter

#### Scenario: Reducer fails during finalization
- **WHEN** chapter content has been staged but state reduction or checkpoint persistence fails
- **THEN** the chapter SHALL not be marked complete, the prior StoryState SHALL remain current, and the workflow SHALL expose a retryable or terminal safe error

### Requirement: Continuity-stale downstream chapters
The system SHALL distinguish narrative continuity staleness from technical failure, workflow invalidation, and media invalidation. When a generated or manually edited earlier chapter changes the accepted state lineage, later AI-generated chapters whose context depended on that lineage SHALL be marked `CONTINUITY_STALE` without being deleted and without automatically destroying their audio, subtitle, or render assets.

#### Scenario: Regenerate an old chapter
- **WHEN** chapter 25 receives a new accepted creative revision while chapters 26-50 already exist
- **THEN** chapter 25 SHALL have a new revision and chapters 26-50 SHALL be visibly marked `CONTINUITY_STALE` according to the dependency policy while their content and media history remain available

#### Scenario: Keep later content deliberately
- **WHEN** a user chooses to keep later stale chapters
- **THEN** the system SHALL preserve their content and show the stale continuity status rather than silently treating them as newly validated

#### Scenario: Rebuild affected future continuity
- **WHEN** a user explicitly requests rebuild or regeneration from an earlier chapter
- **THEN** the system SHALL process the requested range in order and SHALL not silently overwrite or delete chapters outside that action

### Requirement: Continuity rebuild and manual chapter analysis
The system SHALL provide an explicit continuity rebuild operation that can start from a known valid checkpoint and reuse stored summaries and state deltas only when their source revisions remain valid. A manual chapter without a valid structured delta SHALL be eligible for an explicit analysis operation that returns validated summary, StateDelta, and continuity metadata before it rejoins current StoryState.

#### Scenario: Rebuild from a valid checkpoint
- **WHEN** a user requests a rebuild from chapter 37 and chapters 38-50 retain valid source deltas
- **THEN** the system SHALL apply reusable deltas in chapter order and SHALL mark the first unsafe or missing source and its dependent future chapters for review

#### Scenario: Analyze a manual chapter
- **WHEN** a user submits manual chapter text, its plan, and the prior StoryState for analysis
- **THEN** the system SHALL run a bounded analysis operation and SHALL persist the returned summary and state delta only after validation and reference checks

### Requirement: Optional continuity evaluation
The system SHALL support an optional post-generation continuity check that compares generated chapter output with its plan and relevant StoryState. It SHALL return `PASS`, `WARN`, or `FAIL` plus bounded structured issues with type, severity, message, and related character or thread references. It SHALL not automatically regenerate chapters in a loop.

#### Scenario: Continuity check warning
- **WHEN** an enabled check detects a possible contradiction or a severely missed planned beat
- **THEN** the chapter SHALL remain reviewable with a visible warning and SHALL not mutate canonical facts or silently rewrite prior chapters

#### Scenario: Continuity checks disabled
- **WHEN** the project setting disables continuity checks
- **THEN** generation SHALL skip the extra evaluation operation and SHALL not fail solely because no continuity-check result exists
