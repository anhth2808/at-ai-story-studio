## ADDED Requirements

### Requirement: Continuity status for authored chapters
The chapter workspace SHALL distinguish ordinary chapter validity and media status from narrative continuity status. A chapter whose upstream StoryState lineage changed SHALL remain editable and available while being labeled `CONTINUITY_STALE`; this label SHALL not imply that the chapter file, database row, or media assets are technically invalid.

#### Scenario: Earlier chapter changes
- **WHEN** an accepted chapter 25 revision changes the state used by later generated chapters
- **THEN** later affected chapters SHALL remain stored and playable where their media is current, while their continuity status is shown as `CONTINUITY_STALE`

#### Scenario: Preserve media on continuity staleness
- **WHEN** a chapter becomes continuity-stale without a content replacement
- **THEN** its narration, subtitles, and render assets SHALL not be deleted or invalidated solely because of that status

### Requirement: Explicit manual continuity re-entry
The ordinary chapter editor SHALL preserve manual authoring and existing dependent-media invalidation. For a manual edit to a story chapter, the system SHALL provide an explicit path to analyze the edited text or rebuild continuity and SHALL not silently apply inferred state or regenerate future chapters.

#### Scenario: Edit a generated chapter
- **WHEN** a user saves manual content over a generated chapter
- **THEN** the chapter SHALL become a manual revision, its summary and directly dependent media SHALL follow existing invalidation behavior, and any affected future continuity SHALL be visible for explicit review

#### Scenario: Analyze before rejoining state
- **WHEN** a user requests analysis for the edited chapter
- **THEN** the system SHALL return a reviewable structured summary and state proposal and SHALL require an explicit acceptance before current StoryState changes