# Hierarchical Video Rendering Specification

## Purpose

Turn accepted Scene images and narration into reusable Scene Clips, Chapter Videos, and multi-chapter Project Videos without flattening a long story into one fragile render operation.

## Requirements

### Requirement: Scene Clip rendering
The system SHALL render a current accepted Scene image, valid SceneTiming, valid MotionPlan, and compatible render settings into a video-only Scene Clip asset. A Scene Clip SHALL preserve the requested duration within tolerance, output dimensions/FPS/pixel format, Scene and image provenance, and validation metadata. A missing, rejected, stale, or non-current Scene image SHALL not be silently substituted.

#### Scenario: Render one Scene
- **WHEN** a Scene has a current accepted image, valid timing, and valid MotionPlan
- **THEN** the system SHALL create a playable `SCENE_VIDEO_CLIP` asset with subtle still-image motion and no narration audio requirement

#### Scenario: Missing current image
- **WHEN** a required Scene has no valid accepted/current image
- **THEN** Scene Clip render preflight SHALL fail with the Scene identifier and a named missing-image prerequisite before FFmpeg starts

### Requirement: ChapterTimeline and Chapter Video
The system SHALL provide a ChapterTimeline containing ordered SceneTimelineItems with Scene ID, start/end/duration, Scene Clip asset reference, transition, revision, fingerprint, chapter audio asset, subtitle asset, and total duration. Chapter narration audio SHALL be authoritative for duration. A Chapter Video SHALL combine the required Scene Clips, chapter narration, and chapter subtitles and SHALL be registered as a validated `CHAPTER_VIDEO` asset.

#### Scenario: Render one Chapter
- **WHEN** all current Scene Clips cover a chapter and current chapter narration and subtitle assets are valid
- **THEN** the system SHALL render a playable Chapter Video whose audio duration governs the visual timeline and whose subtitles are burned in at Chapter Video stage

#### Scenario: Scene Clip dependency is incomplete
- **WHEN** a required Scene Clip is missing, failed, stale, or outside the current ChapterTimeline fingerprint
- **THEN** Chapter Video render SHALL wait or fail with the named dependency and SHALL not continue with a missing visual interval

#### Scenario: Chapter audio is authoritative
- **WHEN** visual clip durations differ from measured narration duration by small encoding rounding
- **THEN** the Chapter Video SHALL keep narration timing authoritative and SHALL reconcile visual boundaries within the configured tolerance rather than changing audio speed or leaving a black gap

### Requirement: ProjectTimeline and multi-chapter assembly
The system SHALL provide a ProjectTimeline containing an ordered selection of current Chapter Videos for one Chapter, an inclusive range, selected Chapters, or the full Story. A Project Video SHALL be registered as a versioned `PROJECT_VIDEO` asset after successful assembly and validation. It SHALL not assume that only the first project Chapter exists.

#### Scenario: Render a Chapter range
- **WHEN** Chapters 5 through 10 have valid current Chapter Videos
- **THEN** the system SHALL assemble those six Chapters in number order and SHALL exclude Chapters outside the requested range

#### Scenario: Render the full Story
- **WHEN** every selected Chapter has a valid current Chapter Video
- **THEN** the system SHALL assemble all selected Chapters in project order into one playable Project Video without rerendering each Chapter as a single giant scene graph

#### Scenario: Chapter Video is stale
- **WHEN** any selected Chapter Video is stale or absent
- **THEN** project preflight SHALL report the exact Chapter dependency and SHALL either schedule the explicitly supported dependency build or refuse to assemble; it SHALL never silently use stale content

### Requirement: Consistent output profile
All newly rendered Scene Clips and Chapter Videos intended for assembly SHALL use a consistent configured resolution, aspect ratio, FPS, pixel format, video codec, audio codec, and audio sample rate. The default final profile SHALL be H.264/AAC in MP4 with no image distortion.

#### Scenario: Incompatible Chapter Videos
- **WHEN** selected Chapter Videos do not share the required assembly profile
- **THEN** the system SHALL reject copy-based assembly with a named incompatibility and SHALL use an explicit compatible re-encode path only if configured, never silently producing an invalid concat

### Requirement: Still-image motion and transitions
Scene Clip rendering SHALL support subtle Ken Burns-style scale and position changes from the provider-neutral MotionPlan. Chapter composition SHALL support only the initial controlled transitions `CUT`, `CROSSFADE`, and `FADE` with a short configured duration. Transitions MAY overlap adjacent visual clips but SHALL not alter narration timing.

#### Scenario: Apply a slow motion plan
- **WHEN** a Scene has a `ZOOM_IN`, pan, or combined motion plan
- **THEN** the rendered Scene Clip SHALL animate the image gradually over its duration without rapid or aggressive movement or empty-canvas exposure

#### Scenario: Apply a crossfade
- **WHEN** adjacent Chapter Scenes use `CROSSFADE`
- **THEN** the visual frames SHALL overlap for the configured short transition interval while the Chapter audio remains continuous and authoritative

### Requirement: Subtitle strategy
The system SHALL use the existing chapter subtitle pipeline and SHALL burn the current Chapter subtitle asset into the Chapter Video by default. Project assembly SHALL not require rewriting or time-shifting a multi-hour SRT when Chapter Videos are concatenated. Separate chapter SRT assets SHALL remain available through existing subtitle APIs.

#### Scenario: Edit one Chapter subtitle
- **WHEN** a current Chapter subtitle asset changes
- **THEN** the Chapter Video for that Chapter and downstream Project Video SHALL become stale while its Scene Clips remain reusable

### Requirement: Project-level music semantics
The system SHALL treat the existing project music asset as one optional project-level track. It SHALL apply it at most once during Project Video assembly, loop or trim it to the assembled duration, apply bounded volume and optional fades, and preserve narration intelligibility. Independent Chapter Video renders SHALL not mix project music, preventing double music on final assembly.

#### Scenario: Music is shorter than the Story
- **WHEN** project music is enabled and shorter than the Project Video
- **THEN** the system SHALL loop it to the project duration and mix it below narration without requiring a separate music copy per Chapter

#### Scenario: Music is disabled
- **WHEN** music is disabled or absent
- **THEN** Project Video assembly SHALL use narration and Chapter Video audio only and SHALL not fail solely because no music exists

### Requirement: Output validation and publication
Every Scene Clip, Chapter Video, and Project Video SHALL be rendered to managed staging, validated with ffprobe before publication, and checked for expected video stream, dimensions, duration tolerance, and required audio stream. Failed, cancelled, corrupt, or partial outputs SHALL never become current assets. Previous successful render revisions SHALL remain addressable.

#### Scenario: FFmpeg exits with invalid output
- **WHEN** FFmpeg exits successfully but ffprobe detects a missing stream, invalid dimensions, undecodable container, or duration mismatch beyond tolerance
- **THEN** the render SHALL fail, preserve bounded diagnostics, and publish no current output asset

### Requirement: Legacy background rendering remains explicit
The existing validated project background image/video renderer SHALL remain available as an explicit legacy visual-source mode. It SHALL continue to use managed background/music/subtitle inputs and the centralized FFmpeg/process safety rules. It SHALL not be used as an invisible fallback for a Scene that is missing an accepted image.

#### Scenario: Render an existing background project
- **WHEN** a project explicitly selects the legacy background visual source
- **THEN** the existing background render behavior SHALL remain usable without requiring Scene planning or accepted Scene images

### Requirement: No AI video path
This capability SHALL not call or require any AI video, image-to-video, lip-sync, face-animation, 3D-parallax, or provider-specific motion service. Still images plus deterministic FFmpeg motion are the complete initial implementation.

#### Scenario: AI provider unavailable
- **WHEN** no AI video provider is configured
- **THEN** Scene Clip, Chapter Video, and Project Video rendering SHALL still be supported from accepted still images and local media inputs

### Requirement: Source-agnostic SceneClip consumption
Chapter Video and Project Video rendering SHALL consume normalized SceneClip Assets by role and fingerprint exactly as in the existing hierarchy, regardless of whether a clip was produced by Ken Burns FFmpeg motion or AI clip normalization. No AI-specific Chapter or Project renderer, timeline, or assembly path SHALL exist. Narration duration, subtitle burn-in, transitions, and probe validation SHALL behave identically for mixed-source Chapters.

#### Scenario: Mixed-source chapter renders unchanged
- **WHEN** a Chapter Video renders over clips of mixed origin
- **THEN** the existing `buildChapterVideoArguments` path, narration-authoritative duration, subtitle burn-in, and validation tolerances apply with no source-specific branches
