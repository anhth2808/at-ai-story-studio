## Purpose

Prepare a platform-neutral, editable, validated handoff from a completed production run to a future publishing connector. The package references managed Assets and metadata; it never uploads or authenticates with an external platform.

## ADDED Requirements

### Requirement: Publication package references canonical outputs
The system SHALL persist a PublicationPackage associated with one Project and ProductionRun. It SHALL reference the current validated ProjectVideo Asset, optional current thumbnail Asset, available subtitle Assets, editable publication metadata, chapter markers, production scope, package status, input fingerprint, revision, timestamps, and safe validation details. Large binaries SHALL remain in managed filesystem Assets and SHALL not be embedded in package JSON or database rows.

Package statuses SHALL include `DRAFT`, `INCOMPLETE`, `READY`, and `STALE`. `READY` SHALL mean platform-neutral required fields and referenced files are present and valid; it SHALL not mean the package was uploaded anywhere.

#### Scenario: Build a package from a final ProjectVideo
- **WHEN** a current ProjectVideo passes the production quality gate
- **THEN** the package SHALL reference that Asset by ID and hash, retain subtitles and optional thumbnail references, and SHALL not copy the MP4 into SQLite

#### Scenario: Missing required video
- **WHEN** the final ProjectVideo is missing, stale, unreadable, or not current
- **THEN** package validation SHALL return `INCOMPLETE` with a named blocker and SHALL not claim production completion

### Requirement: Metadata is editable and revision-safe
The package SHALL support title, description, short description, tags/keywords, content warnings where relevant, and bounded production metadata. AI-generated title or description SHALL be a draft produced through the existing bounded OMP boundary and SHALL remain user-editable. Manual field edits SHALL persist across package rebuilds and SHALL not be overwritten by automatic metadata regeneration unless the user explicitly requests it.

Metadata and package fingerprints SHALL be revisioned or otherwise identify manual edits. Changes to final Story content, selected scope, referenced subtitles, chapter markers, thumbnail hash, or final ProjectVideo fingerprint SHALL make the package stale or create a new package revision. Changes limited to render encoding SHALL not regenerate title or description automatically.

#### Scenario: Preserve manual title
- **WHEN** a user edits the title manually and the package is rebuilt after an unrelated render-quality change
- **THEN** the manual title SHALL remain unchanged while the video reference/package fingerprint updates as needed

#### Scenario: Generate metadata safely
- **WHEN** metadata generation is requested
- **THEN** it SHALL use the existing OMP boundary and strict bounded output validation, preserve unknown usage values, and SHALL not expose credentials or full prompts

### Requirement: Chapter markers use project timeline
When reliable ProjectTimeline offsets exist, the package SHALL generate ordered chapter markers from existing ChapterVideo durations and titles. Markers SHALL use a stable timestamp format suitable for future publication connectors and SHALL not require speech recognition or reinterpretation of narration.

#### Scenario: Generate chapter timestamps
- **WHEN** Chapters have reliable ordered durations and titles
- **THEN** the package SHALL include markers such as `00:00 Chapter 1` and subsequent cumulative offsets in chapter order

#### Scenario: Timeline is incomplete
- **WHEN** a selected Chapter lacks a reliable duration or is not included in the final ProjectVideo
- **THEN** package validation SHALL mark chapter markers unavailable or incomplete and SHALL not fabricate offsets

### Requirement: Thumbnail handling stays small and explicit
The package MAY reference one existing Scene image or one manually uploaded `PUBLICATION_THUMBNAIL` Asset. Thumbnail selection SHALL be explicit, shall use managed Asset identity/hash, and SHALL not require a new thumbnail designer or autonomous quality subsystem. A missing thumbnail SHALL be a warning or optional incomplete field according to profile/package policy, not an implicit substitute.

#### Scenario: Select an existing Scene image
- **WHEN** a user selects a current Scene image as thumbnail
- **THEN** the package SHALL store the Asset reference and hash without duplicating binary content

### Requirement: Platform-neutral package validation is deterministic
Package validation SHALL check required final video existence and readability, required title and description presence, referenced Asset ownership/currentness/freshness where required, subtitle consistency, chapter marker consistency, and optional thumbnail policy. It SHALL return stable issue codes, severity, safe messages, and recommended actions. Platform-specific constraints such as YouTube OAuth, upload limits, privacy, scheduling, channel settings, and platform metadata rules SHALL remain outside this capability.

#### Scenario: Ready package
- **WHEN** video, required metadata, and all required references pass validation with no blocking issue
- **THEN** package status SHALL become `READY` and SHALL be safe to hand to a future publishing connector

#### Scenario: Stale package after subtitle replacement
- **WHEN** a referenced subtitle Asset changes
- **THEN** package fingerprint/status SHALL become stale or incomplete without rerendering the video unless the existing render dependency rules require it

### Requirement: Manifest is machine-readable and path-safe
A ready or exportable package SHALL provide a `publication.json` manifest containing project identity, production run identity, scope, package revision/fingerprint, final video Asset identity/hash/media metadata, subtitle references, thumbnail reference when selected, editable publication metadata, chapter markers, validation results, and available production metrics. It SHALL contain no absolute local paths, credentials, raw provider graphs, or binary content.

#### Scenario: Inspect a manifest
- **WHEN** a client requests the package manifest
- **THEN** the response/file SHALL contain Asset IDs, workspace-safe URLs or export-relative names, hashes where available, and package metadata without revealing internal absolute paths

### Requirement: Local export produces a portable directory
The system SHALL support exporting a package to a managed or user-selected local publication directory using generated safe filenames. The export SHALL include `publication.json`, final `video.mp4`, available subtitle files, optional `thumbnail.png` or equivalent supported extension, and bounded text metadata where configured. Export SHALL copy or link referenced Asset bytes only after ownership, readiness, path-safety, and checksum validation; it SHALL never execute user-supplied paths through a shell.

#### Scenario: Export ready package
- **WHEN** a user exports a READY package
- **THEN** the target directory SHALL contain the manifest and referenced available files with deterministic names, and checksums SHALL match the Asset records

#### Scenario: Export incomplete package
- **WHEN** a package is incomplete or stale
- **THEN** export SHALL either refuse with named blockers or produce an explicitly marked incomplete directory, never presenting it as ready to publish

### Requirement: Package API and UI are publication-neutral
The system SHALL expose bounded API operations to create/rebuild, read, validate, edit metadata, select a thumbnail, and export a PublicationPackage. The UI SHALL show package status, final video, subtitles, thumbnail, metadata, chapter markers, validation issues, manifest/export actions, and the explicit boundary that no external publishing has occurred.

#### Scenario: Future publishing handoff
- **WHEN** a future connector reads a READY package
- **THEN** it SHALL receive stable Asset references, metadata, markers, and manifest data sufficient to perform platform-specific validation separately
