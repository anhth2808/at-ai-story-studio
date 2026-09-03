## MODIFIED Requirements

### Requirement: Reviewable scene data
Each current Scene SHALL continue exposing exact chapter source range, camera, composition, purpose, character positions, visual prompt, revision, and provenance. It SHALL additionally expose current SceneTiming, MotionPlan, transition, accepted/current image readiness, Scene Clip status, and the timeline/render fingerprint when these outputs exist. These derived media records SHALL remain separate from Scene narrative structure.

#### Scenario: Inspect a renderable Scene
- **WHEN** a current Scene has an accepted image, timing, and MotionPlan
- **THEN** the Scene/timeline read SHALL show the renderable status and exact dependent revisions without copying or mutating the Scene plan fields

#### Scenario: Inspect an unready Scene
- **WHEN** a current Scene has no accepted image or has stale source ranges
- **THEN** the read SHALL show the named missing/stale prerequisite and SHALL not report a renderable current Scene Clip
#### Scenario: Inspect a scene plan
- **WHEN** a scene plan has completed
- **THEN** a scene detail read SHALL expose enough structured information to review narrative purpose and future visual generation without requiring the complete novel

#### Scenario: Enforce controlled values
- **WHEN** an OMP result supplies an unsupported purpose or camera framing value
- **THEN** the system SHALL reject the result as structured validation failure and SHALL preserve the prior current scene plan

### Requirement: Scene source traceability feeds timing
The exact UTF-16 source range already persisted for a current Scene SHALL be usable with the matching chapter revision's persisted TTS source mappings to build deterministic SceneTiming. A timing build SHALL reject stale or out-of-bounds Scene source data and SHALL preserve the original Scene range when timing is manually adjusted.

#### Scenario: Build timing from Scene ranges
- **WHEN** current Scene source ranges and current chapter narration mappings match
- **THEN** the timing result SHALL map every Scene to an ordered narration interval without changing Scene boundaries or chapter content

### Requirement: Accepted image linkage is explicit
Scene timeline reads and render requests SHALL use the accepted/current Scene image selection from the image-generation layer. The Scene Engine SHALL not auto-select a rejected candidate, call an image provider, or mutate image review/current state while building timing or motion.

#### Scenario: Image changes after timing
- **WHEN** a user accepts a different image for an unchanged Scene
- **THEN** SceneTiming and MotionPlan SHALL remain reusable while the dependent Scene Clip becomes stale through its image fingerprint

### Requirement: Motion and timing do not rewrite narrative Scenes
Automatic MotionPlan generation, timing rebuild, manual timing edits, and transition edits SHALL not change Scene title, summary, source range, purpose, camera/composition narrative fields, chapter text, StoryState, TTS, or subtitle content. They SHALL create or update only their own revisioned timeline records and downstream render dependencies.

#### Scenario: Change motion only
- **WHEN** a user changes Scene 37's MotionPlan
- **THEN** the Scene narrative revision and accepted image SHALL remain unchanged, while Scene Clip 37 and video descendants become stale

### Requirement: Scene timeline APIs remain selective
The Scene/timeline API SHALL return chapter-scoped or paginated current Scene timing/motion/image/render metadata, preserve bounded source excerpts, and omit binary media from JSON. It SHALL expose missing-image, stale-plan, timing-lock, and render status details needed by the Timeline UI.

#### Scenario: Browse a large chapter
- **WHEN** a user opens a Chapter with many Scenes
- **THEN** the API SHALL return bounded timeline metadata and asset URLs rather than the full project media payload or historical binary data
