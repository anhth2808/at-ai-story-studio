## ADDED Requirements

### Requirement: Visual planning descendants preserve story authority

The system SHALL treat scene plans as visual-planning descendants of exact chapter revisions. Scene generation SHALL consume, but SHALL NOT mutate, canonical StoryState, CharacterState, blueprint characters, chapter text, or continuity checkpoints.

#### Scenario: Generate from current continuity state
- **WHEN** a chapter has a current StoryState checkpoint and known blueprint characters
- **THEN** scene planning SHALL use relevant state snapshots for visual context while leaving the canonical state revision unchanged

#### Scenario: Generate a manual chapter
- **WHEN** a manually edited chapter has no accepted generated state delta
- **THEN** scene planning SHALL remain available from the chapter and available bounded context, without inventing or accepting a StoryState delta

### Requirement: Stable scene lineage

Each scene plan and scene record SHALL identify the exact chapter revision, relevant story/style revisions, and generation provenance used to create it. New scene revisions SHALL preserve prior revisions and SHALL expose one explicit current revision.

#### Scenario: Inspect scene lineage
- **WHEN** a user opens a scene generated from chapter revision 3
- **THEN** the response SHALL identify chapter revision 3 and retain earlier scene revisions for diagnosis

### Requirement: Visual descendants invalidate precisely

The system SHALL distinguish narrative scene invalidation from visual-prompt staleness. Chapter content changes SHALL affect only scene descendants of that chapter; visual-style or visual-reference changes SHALL mark dependent prompts stale without invalidating valid narrative structure.

#### Scenario: Change an unrelated chapter
- **WHEN** chapter 5 is edited while chapter 4 has a current scene plan
- **THEN** chapter 4 scene structure and prompts SHALL remain current

#### Scenario: Change style only
- **WHEN** a project visual style revision changes
- **THEN** scene source ranges, summaries, purposes, and narrative structure SHALL remain available while dependent prompts become stale
