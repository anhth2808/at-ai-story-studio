## MODIFIED Requirements

### Requirement: Project editor status
Project and Chapter status summaries SHALL expose SceneTiming, MotionPlan, Scene Clip, Chapter Video, and Project Video state in addition to narration, subtitles, background, and render. Project-level status SHALL report hierarchical counts and named blocked/failed prerequisites for the selected Chapter/range/full-Story scope.

#### Scenario: Observe a partial Story render
- **WHEN** 442 of 450 Scene Clips and 48 of 50 Chapter Videos are valid
- **THEN** project status SHALL expose those level-specific counts and identify final assembly as pending rather than reporting only one undifferentiated percentage

### Requirement: Multi-chapter render scopes
Project management SHALL allow explicit rendering of one Chapter, an inclusive Chapter range, selected Chapters, or the full Story. The selected scope SHALL be persisted in the render request/manifest and output metadata, and Chapter order SHALL follow current project numbering. A full-story request SHALL not silently limit itself to the first Chapter.

#### Scenario: Render Chapters 5-10
- **WHEN** a user selects the inclusive range 5-10
- **THEN** only those Chapters SHALL be eligible for dependency scheduling and Project assembly, in number order

#### Scenario: Render the complete Story
- **WHEN** a user requests the full Story
- **THEN** every current selected Chapter with valid dependencies SHALL be included and any missing/stale prerequisite SHALL be named before final assembly

### Requirement: Chapter-local media invalidation
Changing one Chapter's narration, subtitle, SceneTiming, or current Scene structure SHALL invalidate only that Chapter's direct video descendants and Project Videos whose selected scope includes it. It SHALL preserve valid Scene Clips from unrelated Chapters and SHALL not rerender unaffected Chapters.

#### Scenario: Change Chapter 47
- **WHEN** Chapter 47 narration or subtitle is changed
- **THEN** Chapter 47 timing/Chapter Video and downstream full/range Project Videos containing Chapter 47 SHALL become stale while Chapters 1-46 and other unaffected Chapter Videos remain reusable

### Requirement: Preserve media on visual edits
Updating Scene images, MotionPlans, or transitions SHALL not modify chapter text, StoryState, TTS, subtitles, or unrelated chapter media. The project SHALL keep old render revisions available and SHALL require explicit render commands after visual edits.

#### Scenario: Change one Scene in Chapter 2
- **WHEN** one accepted Scene image or MotionPlan changes
- **THEN** only that Scene Clip, Chapter 2 Video, and dependent Project Video SHALL be marked stale; Chapters 1 and 3 SHALL remain current and reusable

### Requirement: Existing project and chapter operations stay explicit
Ordinary project/chapter create, edit, reorder, and delete operations SHALL remain persistence-only and SHALL not implicitly generate Scenes, images, timing, motion, audio, subtitles, or video. Rendering and auto-building dependencies SHALL require an explicit user command.

#### Scenario: Save a chapter
- **WHEN** a user edits chapter text
- **THEN** the system SHALL invalidate its direct descendants as appropriate but SHALL not automatically start a render or regenerate accepted Scene images
