## MODIFIED Requirements

### Requirement: Immutable asset records
Every rendered Scene Clip, Chapter Video, Project Video, and timeline/render manifest SHALL be an immutable filesystem-backed Asset with a stable identifier, project ownership, generated workspace-relative path, media type, byte size, SHA-256, source scope/step, direct input fingerprint, validation metadata, timestamps, and explicit current role where applicable. Prior valid revisions SHALL remain available when a new output becomes current.

#### Scenario: Register a Scene Clip
- **WHEN** a Scene Clip passes duration, stream, dimensions, and codec validation
- **THEN** the system SHALL register a `SCENE_VIDEO_CLIP` Asset with Scene/timing/motion provenance and shall make it eligible for the current Scene Clip role

#### Scenario: Preserve a replaced Project Video
- **WHEN** a new Project Video supersedes an older current revision
- **THEN** the old Asset SHALL remain addressable and non-current rather than being deleted or overwritten
#### Scenario: Commit generated media
- **WHEN** an output is fully written and validated
- **THEN** the file SHALL be promoted within the managed workspace before its asset record and current-role pointer are committed

#### Scenario: Preserve historical output
- **WHEN** a newer output replaces a current logical role
- **THEN** the previous asset SHALL remain addressable as historical/non-current data and SHALL not be overwritten

### Requirement: Managed workspace
The managed workspace SHALL include project video directories for Scene Clips, Chapter Videos, Project Videos, and timeline manifests in addition to existing audio, subtitle, background, music, image, render, and staging paths. Directory creation SHALL be restart-safe and SHALL not place media blobs in SQLite.

#### Scenario: Initialize video directories
- **WHEN** a project or workspace is initialized
- **THEN** the required hierarchical video directories SHALL exist or be created before a render can publish output
#### Scenario: Initialize workspace
- **WHEN** the API or worker starts with a valid workspace configuration
- **THEN** required directories and database parent paths SHALL exist and the workspace health check SHALL report readiness

#### Scenario: Reconcile staging
- **WHEN** a process starts after an interrupted attempt
- **THEN** uncommitted partial files SHALL not be treated as current assets and stale staging data SHALL be quarantined or removed according to retention rules

### Requirement: Path safety
Generated render destinations SHALL use application-generated identifiers and known scope directories. Scene IDs, Chapter IDs, job IDs, provider filenames, upload filenames, and request paths SHALL not be interpreted as arbitrary filesystem paths. Asset registration SHALL reject absolute paths, traversal, and paths outside the workspace.

#### Scenario: Reject an unsafe render destination
- **WHEN** a render manifest or provider result attempts to escape the managed workspace
- **THEN** publication SHALL fail before the file becomes referenced or current
#### Scenario: Reject path traversal
- **WHEN** an upload or asset operation includes `..`, an absolute path, or a resolved path outside the workspace
- **THEN** it SHALL fail before file access or database mutation

#### Scenario: Generated internal names
- **WHEN** a user uploads a file with any filename
- **THEN** the managed file SHALL use a generated internal path while the display filename, if retained, remains metadata only

### Requirement: Asset validation and serving
Rendered Assets SHALL be validated by content and ffprobe checks appropriate to their type before publication. Asset download/stream endpoints SHALL continue addressing media by Asset identifier and SHALL not expose arbitrary local paths. Video validation SHALL include required stream types, dimensions, codec/profile compatibility, and duration tolerance.

#### Scenario: Serve a Chapter Video
- **WHEN** a validated Chapter Video Asset is requested by ID
- **THEN** the API SHALL stream it through the existing safe Asset route without returning its local filesystem path
#### Scenario: Invalid media
- **WHEN** a file has an unsupported type or cannot be decoded/probed
- **THEN** it SHALL be rejected or recorded invalid and SHALL never become a current input to rendering

### Requirement: Asset hashing and dependency lineage
The system SHALL compute SHA-256 hashes for rendered files and SHALL persist direct Asset dependency links for Scene image to Scene Clip, Scene Clip to Chapter Video, Chapter audio/subtitle to Chapter Video, and Chapter Video/music to Project Video. Dependency records SHALL retain source hashes so stale outputs can be detected without reading all media bytes into memory.

#### Scenario: Detect a changed Scene input
- **WHEN** the accepted Scene image hash changes
- **THEN** the linked Scene Clip SHALL no longer satisfy its current fingerprint while unrelated Asset dependency records remain valid

### Requirement: Accepted Scene image as render input
Scene video rendering SHALL use only the current accepted/selected Scene image Asset that is READY and fresh according to the image-generation contract. Candidate, rejected, historical, stale, or missing image Assets SHALL not be selected implicitly.

#### Scenario: Candidate exists without acceptance
- **WHEN** a Scene has completed candidates but no accepted/current image
- **THEN** no Scene Clip Asset SHALL be published for that Scene unless the render request names an explicit fallback policy
