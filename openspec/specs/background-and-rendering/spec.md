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
The system SHALL support an optional user-uploaded music asset with enabled/disabled state, volume, and loop behavior. Music mixing SHALL preserve narration as the primary intelligible audio track.

#### Scenario: Remove music
- **WHEN** music is removed or disabled
- **THEN** future renders SHALL omit it and the render dependency SHALL be invalidated without changing narration or subtitles

### Requirement: Render configuration
The system SHALL support render configuration for at least 1920x1080 and 1080x1920 presets, FPS, subtitle font size, narration volume, and music volume, with safe validated defaults.

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
- **THEN** only the affected render/timeline descendants SHALL become invalidated; unrelated chapter narration SHALL remain current
