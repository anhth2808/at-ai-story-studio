## MODIFIED Requirements

### Requirement: Render configuration
The system SHALL support validated render configuration for 16:9 and 9:16 output, FPS, quality preset (`FAST_PREVIEW`, `STANDARD`, or `HIGH`), fitting mode (`COVER` or `CONTAIN`), motion intensity, transition type/duration, subtitle style fields, narration/music volume, and an explicit visual source (`SCENES` or legacy `BACKGROUND`). Unsupported dimensions, ratios, FPS, volumes, transition durations, unsafe subtitle values, or unrecognized source modes SHALL fail before scheduling external work. Existing background projects SHALL retain an explicit legacy configuration path.

#### Scenario: Configure a vertical preview
- **WHEN** a user selects 1080x1920, a supported FPS, `FAST_PREVIEW`, and `SCENES`
- **THEN** the configuration SHALL persist and the next Scene timeline render SHALL use that profile without changing Story or image-generation settings

#### Scenario: Reject unsafe render settings
- **WHEN** a request includes unsupported dimensions, a negative volume, an excessive transition, or an invalid fitting mode
- **THEN** validation SHALL fail before a workflow step or FFmpeg process is created

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

### Requirement: FFmpeg motion and assembly
The centralized media renderer SHALL compile argument arrays and managed filter scripts for proportional image fitting, safe Ken Burns motion, controlled transitions, subtitle burn-in, narration, optional project music, and compatible Chapter Video concatenation. It SHALL not accept raw shell commands or raw filter expressions from API clients. It SHALL avoid loading complete long-form media into application memory.

#### Scenario: Render still-image motion
- **WHEN** a Scene Clip uses a valid MotionPlan
- **THEN** FFmpeg SHALL apply a gradual scale/position transformation within the source crop bounds and produce the configured frame rate and pixel format

#### Scenario: Concatenate compatible Chapter Videos
- **WHEN** selected Chapter Videos share codec, resolution, FPS, pixel format, audio codec, and sample rate
- **THEN** the renderer SHALL prefer a compatible concat strategy that does not re-encode every Chapter unnecessarily

### Requirement: Optional music
Project music SHALL be mixed once at Project Video stage, looped or trimmed to the assembled Project duration when enabled, bounded to the configured volume, and kept below narration. Chapter Video rendering SHALL not mix project music. The existing upload, enable/disable, and deletion behavior SHALL remain explicit.

#### Scenario: Render a Chapter independently
- **WHEN** a user renders one Chapter with project music configured
- **THEN** the Chapter Video SHALL contain narration and burned subtitles but SHALL not contain the project music track

### Requirement: Render validation and cancellation
Every hierarchical render SHALL persist progress, safe diagnostics, cancellation state, and bounded current-time/expected-duration values where FFmpeg exposes them. It SHALL render under managed staging, terminate the process through the existing safe runner on cancellation/timeout, validate with ffprobe, and publish only a complete valid Asset.

#### Scenario: Cancel a Scene Clip
- **WHEN** a user cancels a running Scene Clip render
- **THEN** the process SHALL be terminated within the configured window, partial output SHALL remain non-current, and dependent Chapter/Project work SHALL remain blocked or cancelled

### Requirement: Precise media invalidation
The system SHALL invalidate only the direct hierarchical descendants of changed Scene image, MotionPlan, SceneTiming, Chapter narration, Chapter subtitle, project music, or render settings. Unaffected Scene Clips and Chapter Videos SHALL remain reusable. Legacy background changes SHALL invalidate only renders that use that background source.

#### Scenario: Replace one Scene image
- **WHEN** the accepted/current image for Scene 37 changes
- **THEN** Scene Clip 37, its containing Chapter Video, and affected Project Video outputs SHALL become stale while other Scene Clips and Chapters remain reusable

#### Scenario: Replace one subtitle
- **WHEN** Chapter 4's subtitle asset changes
- **THEN** its Chapter Video and dependent Project Video SHALL become stale while all Scene Clips remain valid
