## ADDED Requirements

### Requirement: Hierarchical long-story planning state
For stories above 20 chapters, the system SHALL persist lightweight ordered arc records and SHALL allow current chapter plans to be generated and revised in bounded planning windows. Each planned chapter SHALL retain a stable identifier and chapter number, and window revisions SHALL preserve prior plan lineage.

#### Scenario: Create a 100-chapter plan in windows
- **WHEN** a user configures a 100-chapter story and requests planning
- **THEN** the system SHALL expose arc coverage and SHALL allow a bounded window of chapter plans to be reviewed without requiring one detailed response for all 100 chapters

#### Scenario: Revise one planning window
- **WHEN** a user edits a plan item within one arc window
- **THEN** the system SHALL preserve the prior plan revision and SHALL scope downstream generation invalidation to the affected planned chapters and their dependents

### Requirement: Persistent structured continuity state
The system SHALL persist StoryState checkpoints and dynamic CharacterState independently from stable blueprint Character definitions. Accepted chapter state SHALL include compact summaries, thread lifecycle data, important facts, recent events, current arc progress, and source chapter/revision lineage, with bounded fields and validated project-local references.

#### Scenario: Carry character state forward
- **WHEN** chapter 37 commits a character location, goal, injury, or knowledge change
- **THEN** the next current StoryState SHALL expose that dynamic state while the blueprint character identity remains unchanged

#### Scenario: Preserve checkpoint lineage
- **WHEN** a later chapter is generated or a continuity rebuild is requested
- **THEN** prior StoryState revisions SHALL remain inspectable and the operation SHALL identify the checkpoint and source revisions it used

### Requirement: Continuity-aware chapter revisions
The system SHALL expose a `CONTINUITY_STALE` state for existing AI-generated chapter content whose upstream narrative state changed. This state SHALL be distinct from `FAILED`, `INVALIDATED`, and media output status, SHALL preserve chapter content and prior revisions, and SHALL require an explicit user choice before future regeneration or rebuild.

#### Scenario: Change an earlier generated chapter
- **WHEN** an accepted revision changes chapter 25 while later generated chapters exist
- **THEN** affected later chapters SHALL be marked `CONTINUITY_STALE` without being silently deleted or treated as fully current

#### Scenario: Keep stale chapters
- **WHEN** the user chooses to keep the later chapters as authored
- **THEN** their content and media SHALL remain available while the continuity-stale indicator remains visible

### Requirement: Explicit continuity actions after manual edits
When a user edits a chapter that participates in StoryState, the system SHALL preserve existing summary and media invalidation behavior and SHALL additionally expose an explicit action to rebuild continuity or analyze the manual chapter. The system SHALL not silently recompute later chapters or StoryState from the edit.

#### Scenario: Edit chapter 37 manually
- **WHEN** a generated chapter is saved as a manual revision
- **THEN** its summary and dependent media SHALL follow existing invalidation rules, later dependent AI chapters SHALL be marked continuity-stale as applicable, and the UI SHALL offer rebuild or analysis actions

#### Scenario: Leave future story unchanged
- **WHEN** the user does not request a rebuild after editing a chapter
- **THEN** later story content SHALL remain stored with its existing status and SHALL not be silently recomputed