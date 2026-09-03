# Background and rendering Specification

## Purpose

Assemble validated user-owned visual/audio inputs and subtitles into a cancellable, probe-validated MP4 while preserving narration priority and invalidating only outputs affected by input changes.

## Requirements

### Requirement: Background inputs
The system SHALL accept validated user uploads as either a background image or background video, store them as generated internal assets, and expose preview/status through project APIs.

#### Scenario: Upload background image
- **WHEN** a supported image is uploaded
- **THEN** it SHALL be copied into managed storage, probed/validated, and become the current background input without trusting its filename as a path

#### Scenario: Upload background video
- **WHEN** a supported video is uploaded
- **THEN** it SHALL be probed/validated and become the current background input; rendering SHALL loop or trim it to the narration duration

### Requirement: Optional music
Project music SHALL be mixed once at Project Video stage, looped or trimmed to the assembled Project duration when enabled, bounded to the configured volume, and kept below narration. Chapter Video rendering SHALL not mix project music. The existing upload, enable/disable, and deletion behavior SHALL remain explicit.

#### Scenario: Render a Chapter independently
- **WHEN** a user renders one Chapter with project music configured
- **THEN** the Chapter Video SHALL contain narration and burned subtitles but SHALL not contain the project music track
#### Scenario: Remove music
- **WHEN** music is removed or disabled
- **THEN** future renders SHALL omit it and the render dependency SHALL be invalidated without changing narration or subtitles

### Requirement: Render configuration
The system SHALL support validated render configuration for 16:9 and 9:16 output, FPS, quality preset (`FAST_PREVIEW`, `STANDARD`, or `HIGH`), fitting mode (`COVER` or `CONTAIN`), motion intensity, transition type/duration, subtitle style fields, narration/music volume, and an explicit visual source (`SCENES` or legacy `BACKGROUND`). Unsupported dimensions, ratios, FPS, volumes, transition durations, unsafe subtitle values, or unrecognized source modes SHALL fail before scheduling external work. Existing background projects SHALL retain an explicit legacy configuration path.

#### Scenario: Configure a vertical preview
- **WHEN** a user selects 1080x1920, a supported FPS, `FAST_PREVIEW`, and `SCENES`
- **THEN** the configuration SHALL persist and the next Scene timeline render SHALL use that profile without changing Story or image-generation settings

#### Scenario: Reject unsafe render settings
- **WHEN** a request includes unsupported dimensions, a negative volume, an excessive transition, or an invalid fitting mode
- **THEN** validation SHALL fail before a workflow step or FFmpeg process is created
#### Scenario: Reject unsupported configuration
- **WHEN** a render request contains invalid dimensions, FPS, volume, or unsafe subtitle settings
- **THEN** the request SHALL fail validation before scheduling external work

### Requirement: Manifest-driven render
The system SHALL build an immutable render input manifest containing the selected current narration, background, subtitles, optional music, configuration, asset hashes, and expected duration before invoking FFmpeg.

#### Scenario: Render a chapter/project
- **WHEN** all required current inputs are valid
- **THEN** the system SHALL render an MP4 through controlled media processing, validate it with ffprobe, and register it as the current rendered-video asset only after successful validation

#### Scenario: Missing prerequisite
- **WHEN** narration, background, or required subtitle input is absent/invalid/stale
- **THEN** rendering SHALL not start and the user SHALL see the named prerequisite(s)

### Requirement: Render progress and cancellation
The system SHALL persist render progress, safe diagnostics, and status. A cancelled or failed render SHALL never publish a partial file as current.

#### Scenario: Cancel render
- **WHEN** a user cancels a running render
- **THEN** the external process SHALL be terminated within the configured window, partial output SHALL remain non-current, and the persisted state SHALL be `CANCELLED`

#### Scenario: Corrupt output
- **WHEN** FFmpeg exits successfully but ffprobe cannot validate the output container, streams, dimensions, duration, or decodability
- **THEN** the render SHALL be `FAILED` and no current rendered-video asset SHALL be published

### Requirement: Precise dependency invalidation
The system SHALL invalidate only direct outputs and their descendants when an input revision or current asset changes.

#### Scenario: Edit one chapter
- **WHEN** chapter 3 content is saved as a new revision
- **THEN** chapter 3 cleaning/TTS/chapter audio/subtitle and final render descendants SHALL become invalidated, while chapter 1 and chapter 2 TTS outputs SHALL remain current

#### Scenario: Change visual or music input
- **WHEN** the current background, music, subtitle, or chapter-audio input changes

### Requirement: Precise media invalidation
The system SHALL invalidate only the direct hierarchical descendants of changed Scene image, MotionPlan, SceneTiming, Chapter narration, Chapter subtitle, project music, or render settings. Unaffected Scene Clips and Chapter Videos SHALL remain reusable. Legacy background changes SHALL invalidate only renders that use that background source.

#### Scenario: Replace one Scene image
- **WHEN** the accepted/current image for Scene 37 changes
- **THEN** Scene Clip 37, its containing Chapter Video, and affected Project Video outputs SHALL become stale while other Scene Clips and Chapters remain reusable

#### Scenario: Replace one subtitle
- **WHEN** Chapter 4's subtitle asset changes
- **THEN** its Chapter Video and dependent Project Video SHALL become stale while all Scene Clips remain valid
### Requirement: Render validation and cancellation
Every hierarchical render SHALL persist progress, safe diagnostics, cancellation state, and bounded current-time/expected-duration values where FFmpeg exposes them. It SHALL render under managed staging, terminate the process through the existing safe runner on cancellation/timeout, validate with ffprobe, and publish only a complete valid Asset.

#### Scenario: Cancel a Scene Clip
- **WHEN** a user cancels a running Scene Clip render
- **THEN** the process SHALL be terminated within the configured window, partial output SHALL remain non-current, and dependent Chapter/Project work SHALL remain blocked or cancelled
### Requirement: FFmpeg motion and assembly
The centralized media renderer SHALL compile argument arrays and managed filter scripts for proportional image fitting, safe Ken Burns motion, controlled transitions, subtitle burn-in, narration, optional project music, and compatible Chapter Video concatenation. It SHALL not accept raw shell commands or raw filter expressions from API clients. It SHALL avoid loading complete long-form media into application memory.

#### Scenario: Render still-image motion
- **WHEN** a Scene Clip uses a valid MotionPlan
- **THEN** FFmpeg SHALL apply a gradual scale/position transformation within the source crop bounds and produce the configured frame rate and pixel format

#### Scenario: Concatenate compatible Chapter Videos
- **WHEN** selected Chapter Videos share codec, resolution, FPS, pixel format, audio codec, and sample rate
- **THEN** the renderer SHALL prefer a compatible concat strategy that does not re-encode every Chapter unnecessarily
### Requirement: Hierarchical manifest-driven render
The system SHALL build immutable manifests for Scene Clip, Chapter Video, and Project Video renders. Each manifest SHALL record scope, ordered direct inputs, accepted/current image or legacy background source, timing/motion/transition data where applicable, narration/subtitle/music assets, configuration, hashes, expected duration, compiler/tool versions, and output profile before invoking FFmpeg. Project manifests SHALL identify the selected Chapter range or full-Story scope and SHALL not assume the first Chapter only.

#### Scenario: Build a Chapter timeline manifest
- **WHEN** a Chapter has current timing, MotionPlans, Scene Clips, narration, and subtitles
- **THEN** the manifest SHALL list ordered SceneTimelineItems and exact input hashes before Chapter Video rendering starts

#### Scenario: Assemble multiple Chapters
- **WHEN** Chapters 1-3 are selected for a Project Video
- **THEN** the manifest SHALL list all three current Chapter Video inputs in order and SHALL not read only Chapter 1's audio or subtitle

#### Scenario: Render legacy background explicitly
- **WHEN** a user selects the `BACKGROUND` source
- **THEN** the existing background image/video behavior SHALL remain available, while a Scene missing an accepted image SHALL not silently fall back to that background source
