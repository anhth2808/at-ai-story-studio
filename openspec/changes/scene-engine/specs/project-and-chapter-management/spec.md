## ADDED Requirements

### Requirement: Chapter revision-scoped scene invalidation

When a chapter title or content changes, the system SHALL preserve chapter revisions and existing media behavior while marking only scenes derived from the changed chapter revision stale or invalidated. It SHALL preserve historical scene revisions and SHALL not alter unrelated chapter scene plans.

#### Scenario: Edit chapter content
- **WHEN** chapter 5 is saved as a new manual revision
- **THEN** chapter 5's current scene plan SHALL no longer claim validity for the old source revision, while chapter 4 and chapter 6 scene plans remain available

#### Scenario: Preserve existing media
- **WHEN** a chapter scene plan becomes stale because chapter content changed
- **THEN** existing TTS, subtitle, and render invalidation semantics SHALL remain unchanged and scene invalidation SHALL not enqueue image or video work

### Requirement: Manual chapters support scene planning

A chapter's manual origin SHALL not prevent scene planning. Scene records SHALL retain their source chapter revision and SHALL not create or accept canonical StoryState changes merely because the chapter was analyzed for visual planning.

#### Scenario: Plan a manually authored chapter
- **WHEN** a user opens a manual chapter and requests Generate Scenes
- **THEN** the scene operation SHALL use the saved manual text and leave chapter origin, StoryState, and continuity acceptance unchanged

### Requirement: Scene edits do not rewrite chapter text

Editing or regenerating a scene SHALL not modify chapter title/content, chapter revision, narration, subtitles, render configuration, or neighboring scenes. Manual scene changes SHALL be explicit and reviewable.

#### Scenario: Edit scene visual fields
- **WHEN** a user changes a scene camera or image prompt
- **THEN** only the scene revision and relevant prompt status SHALL change, and the source chapter text SHALL remain byte-for-byte unchanged
