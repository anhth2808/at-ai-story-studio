# Scene Timing and Motion Specification

## Purpose

Provide deterministic narration-synchronized timing and subtle still-image motion so reviewed Scene images can cover a chapter without inventing visual timing or requiring AI video generation.

## Requirements

### Requirement: Source-range narration timing
The system SHALL derive each current Scene's timing from its half-open source range in the exact chapter revision and the ordered persisted TTS segments for that revision. Each TTS segment SHALL expose the source text range or an equivalent deterministic source-position mapping, its measured audio duration, and its cumulative narration position. A Scene boundary inside a TTS segment SHALL be estimated proportionally from source characters or words using a documented deterministic rule. The result SHALL include `startMs`, `endMs`, and `durationMs`.

#### Scenario: Boundary aligns with segment edges
- **WHEN** a Scene starts and ends at boundaries covered by known TTS segments
- **THEN** its timing SHALL use the cumulative measured segment timestamps without floating-point accumulation and SHALL be reproducible on repeated builds

#### Scenario: Boundary falls inside a TTS segment
- **WHEN** a Scene source boundary falls inside one TTS segment
- **THEN** the system SHALL interpolate the corresponding audio position proportionally and SHALL produce the same integer-millisecond result for the same source text, segment mapping, and duration

#### Scenario: Source mapping is stale
- **WHEN** Scene source ranges and TTS source mapping refer to different chapter revisions or a required segment duration is missing
- **THEN** timing generation SHALL fail with a named stale or incomplete prerequisite and SHALL not publish a current timeline

### Requirement: Chapter timing coverage and validity
A generated Chapter timing result SHALL validate non-negative starts, strictly positive durations, ordered non-overlapping Scenes, and end positions no later than chapter narration duration within a documented rounding tolerance. It SHALL cover the complete narration interval from zero through the measured chapter audio duration, with no unexplained gaps. Any intentional fallback or hold policy SHALL be explicit in the timing metadata.

#### Scenario: Complete narration coverage
- **WHEN** all current Scenes and chapter narration are valid
- **THEN** the first Scene SHALL begin at zero, the final Scene SHALL reach the narration duration within tolerance, and every interval between them SHALL be covered

#### Scenario: Overlap or unexplained gap
- **WHEN** calculated Scene intervals overlap or leave a gap larger than the configured rounding tolerance
- **THEN** the build SHALL fail validation and SHALL identify the offending interval instead of rendering black video implicitly

#### Scenario: Short Scene duration
- **WHEN** a calculated Scene is shorter than `minimumSceneDurationMs`
- **THEN** the timing layer MAY redistribute an adjacent boundary or hold the image longer according to the configured policy, SHALL preserve chapter coverage and order, and SHALL not alter the underlying Scene structure or source ranges

### Requirement: Explicit timing mode and manual lock
The system SHALL support `AUTO` timing and `MANUAL` timing. AUTO rebuilds SHALL derive from current source and audio inputs. A valid MANUAL timing revision SHALL not be overwritten by an automatic rebuild unless the user explicitly requests replacement. Manual edits SHALL preserve total chapter narration duration and SHALL reject or warn on overlap, negative duration, uncovered intervals, or an end beyond audio duration.

#### Scenario: Preserve locked timing
- **WHEN** a user saves valid manual Scene boundaries and later rebuilds timing inputs without requesting overwrite
- **THEN** the manual timing SHALL remain current and the rebuild SHALL report that the timing is locked

#### Scenario: Reject invalid manual edit
- **WHEN** a manual edit creates overlap or leaves narration uncovered
- **THEN** the system SHALL reject it with the affected Scene or gap and SHALL keep the previous valid timing revision

### Requirement: Provider-neutral MotionPlan
Each current Scene MAY have a revisioned provider-neutral MotionPlan containing a stable ID, Scene ID, small controlled `motionType`, start/end scale, start/end normalized position, duration, easing, optional focus point, revision, and status. The domain representation SHALL not contain raw FFmpeg expressions, shell text, or provider-specific node data.

#### Scenario: Persist a motion plan
- **WHEN** a user accepts or the system generates a valid plan for a current Scene
- **THEN** the plan SHALL retain its Scene and revision provenance and SHALL be usable by a renderer without reconstructing Story context

#### Scenario: Unsupported motion type
- **WHEN** a request names a motion type outside the supported controlled set
- **THEN** validation SHALL fail before any render job or external process starts

### Requirement: Deterministic automatic motion selection
The system SHALL generate default MotionPlans with deterministic rule-based selection from Scene camera framing, composition, purpose, and subject-position metadata. The supported initial motion vocabulary SHALL remain bounded to `STATIC`, `ZOOM_IN`, `ZOOM_OUT`, `PAN_LEFT`, `PAN_RIGHT`, `PAN_UP`, `PAN_DOWN`, `PAN_ZOOM`, and `SLOW_PUSH_IN`. Repeated generation with identical Scene revision and motion settings SHALL produce the same plan and SHALL avoid an unvaried repeated motion sequence where controlled alternatives are valid.

#### Scenario: Generate default plans
- **WHEN** the user requests automatic MotionPlans for ordered Scenes
- **THEN** the system SHALL generate all eligible plans without an LLM call, preserve the order, and use stable rules such as push-in for establishing wide shots and restrained motion for close-ups

#### Scenario: Respect subject position
- **WHEN** composition metadata identifies a subject on one side of the frame
- **THEN** automatic selection SHALL avoid a motion direction that predictably pushes the subject out of the valid crop area when another supported motion is available

### Requirement: Safe fitting and motion bounds
The system SHALL support output aspect ratios 16:9 and 9:16 and fitting modes `COVER` and `CONTAIN`. COVER SHALL fill the target frame without distortion and SHALL calculate motion within the source crop's valid bounds. CONTAIN SHALL preserve the complete source image and SHALL intentionally fill unused space. Scale and position values SHALL be finite, bounded, and deterministic; no motion frame SHALL expose an empty canvas outside the source image.

#### Scenario: Cover an incompatible image
- **WHEN** a Scene image aspect ratio differs from the configured output ratio and COVER is selected
- **THEN** the system SHALL crop excess pixels after proportional scaling and SHALL apply pan/zoom only inside the valid crop rectangle

#### Scenario: Contain an incompatible image
- **WHEN** CONTAIN is selected
- **THEN** the full image SHALL remain visible with an explicit fill treatment and SHALL not be stretched or leave transparent or undefined output regions

#### Scenario: Motion exceeds crop bounds
- **WHEN** a requested MotionPlan would move the crop beyond the source dimensions
- **THEN** the system SHALL clamp or reject the plan deterministically before FFmpeg execution and SHALL never emit an invalid crop expression

### Requirement: No AI motion generation
This capability SHALL not require image-to-video, AI video, computer-vision detection, face tracking, lip sync, 3D parallax, or an LLM call. A valid deterministic MotionPlan SHALL be sufficient for basic rendering.

#### Scenario: Render without OMP
- **WHEN** OMP or an AI provider is unavailable but accepted Scene images and valid timing exist
- **THEN** automatic motion planning and still-image rendering SHALL remain available

### Requirement: AiMotionPlan and motion source storage
The system SHALL persist per-Scene-revision AI motion intent - character action, environment motion, camera intent from a bounded vocabulary, intensity (`SUBTLE`/`MEDIUM`/`STRONG`, default `SUBTLE`), optional priority, and the compiled motion prompt fingerprint - as revisioned records separate from Ken Burns MotionPlan and from SceneTiming. The Scene motion source mode (`KEN_BURNS`/`AI_VIDEO`/`HYBRID`) SHALL be stored per Scene with revision-safe updates. AI generation duration SHALL NOT be derived from SceneTiming.

#### Scenario: Timing rebuild leaves motion intent intact
- **WHEN** SceneTiming is rebuilt after narration changes
- **THEN** the AiMotionPlan revisions and raw AI Motion Assets SHALL remain current and untouched, and only normalized SceneClips rebuild

### Requirement: Scene timing allocates ordered Shot units
The existing SceneTiming SHALL remain the canonical narration interval for a Scene and MAY contain ordered Shot timing allocations derived from the current Shot plan. Shot allocations SHALL preserve Scene total timing, exact plan revision, backend legal frame counts, actual generated durations, and bounded residual metadata. They SHALL not rewrite Chapter narration, subtitle cues, or the Scene source range.

#### Scenario: Allocate Shot durations
- **WHEN** a current SceneTiming spans three current Shots
- **THEN** the Shot allocations SHALL remain ordered, cover the timing unit within documented bounded residual, and retain exact Shot-plan lineage

### Requirement: Backend frame rounding integrates with timeline ownership
For backend-generated Shot clips, legal frame allocation SHALL be computed at the parent timing-unit level and recorded with actual durations. The final eligible Shot MAY absorb bounded residual after child minimums and lattice constraints. Timeline-only timing changes SHALL reuse raw accepted clips when raw generation inputs remain unchanged and SHALL adjust normalization/composition rather than regenerating motion.

#### Scenario: Timing-only edit
- **WHEN** a user changes SceneTiming without changing Shot prompt, keyframe, motion plan, backend, or raw-generation settings
- **THEN** accepted raw Shot videos SHALL remain reusable while only affected normalized SceneClip and render descendants become stale

### Requirement: SceneClip consumes eligible Shot media
A SceneClip plan SHALL compose current accepted Shot videos and allowed static/Ken Burns fallback media in Shot order. It SHALL reject stale, rejected, wrong-plan, failed-QC, missing-reference, or non-current Shot media. AI Video remains a Shot/SceneClip source and SHALL NOT own Chapter or Project rendering.

#### Scenario: One Shot clip fails quality
- **WHEN** one of four required Shot clips is temporally rejected and fallback is not allowed
- **THEN** the SceneClip SHALL remain blocked without invalidating accepted sibling raw clips
