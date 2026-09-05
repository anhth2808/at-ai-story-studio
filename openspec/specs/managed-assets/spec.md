# Managed assets Specification

## Purpose

Keep large media and generated artifacts on a managed local filesystem while SQLite records immutable identity, validation, lineage, and current-role selection needed for safe retries and precise invalidation.

## Requirements

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

### Requirement: Asset hashing
The system SHALL compute SHA-256 content hashes for imported and committed generated files and SHALL use them in identity/fingerprint and stale-output decisions.

#### Scenario: Same bytes
- **WHEN** identical file bytes are imported twice
- **THEN** each import MAY have its own asset identifier, but both records SHALL report the same content hash

### Requirement: Managed Scene image assets
Generated and manually uploaded Scene images SHALL be immutable `SCENE_IMAGE` Assets with project and Scene ownership, generated workspace-relative paths, supported image media type, byte size, SHA-256 hash, readable width/height metadata, provenance, freshness, and an explicit Scene-current role. Prior valid image Assets SHALL remain available after a new current selection.

#### Scenario: Commit a generated Scene image
- **WHEN** a provider output passes image validation and the generation input is still current
- **THEN** the system SHALL register the file and generation metadata and move the Scene-current role in a guarded transaction

#### Scenario: Keep an older revision
- **WHEN** a new Scene image becomes current
- **THEN** the previous image SHALL remain a valid non-current historical Asset until explicitly deleted

### Requirement: Provider and upload paths are untrusted
The system SHALL generate its own destination path for every Scene image. Provider filename/subfolder values and user upload filenames SHALL be treated only as external retrieval/display data, encoded safely when contacting the provider, and SHALL never determine application filesystem identity.

#### Scenario: Import a provider output
- **WHEN** ComfyUI returns an output filename and subfolder
- **THEN** the application SHALL stream the response into its own Scene image staging/destination path and SHALL reject any workspace escape

### Requirement: Scene image content validation
A Scene image SHALL not become `READY` or current until its bytes identify a supported PNG, JPEG, or WEBP image, its size is non-zero, its dimensions are readable, and its resolution is reasonably compatible with the generation request. Extension or response `Content-Type` alone SHALL be insufficient.

#### Scenario: Reject a mislabeled image
- **WHEN** downloaded bytes are corrupt or do not match a supported image signature despite an image filename
- **THEN** no current Asset SHALL be published and any existing current Scene image SHALL remain unchanged

### Requirement: Metadata-only image lists and streamed preview
Scene image history/list responses SHALL return bounded metadata and asset URLs without loading binaries into SQLite, base64, or ordinary JSON. Preview/download SHALL resolve the Asset identifier through a safe streaming path that does not expose arbitrary local paths.

#### Scenario: Preview a Scene image
- **WHEN** a user opens one generated revision

### Requirement: Accepted Scene image as render input
Scene video rendering SHALL use only the current accepted/selected Scene image Asset that is READY and fresh according to the image-generation contract. Candidate, rejected, historical, stale, or missing image Assets SHALL not be selected implicitly.

#### Scenario: Candidate exists without acceptance
- **WHEN** a Scene has completed candidates but no accepted/current image
- **THEN** no Scene Clip Asset SHALL be published for that Scene unless the render request names an explicit fallback policy

### Requirement: Asset hashing and dependency lineage
The system SHALL compute SHA-256 hashes for rendered files and SHALL persist direct Asset dependency links for Scene image to Scene Clip, Scene Clip to Chapter Video, Chapter audio/subtitle to Chapter Video, and Chapter Video/music to Project Video. Dependency records SHALL retain source hashes so stale outputs can be detected without reading all media bytes into memory.

#### Scenario: Detect a changed Scene input
- **WHEN** the accepted Scene image hash changes
- **THEN** the linked Scene Clip SHALL no longer satisfy its current fingerprint while unrelated Asset dependency records remain valid

### Requirement: Raw AI motion asset type and storage
The system SHALL add an immutable raw AI Motion Asset type (`AI_SCENE_VIDEO`) stored under managed project video directories (for example `projects/{projectId}/video/motion/{sceneStableId}/{generationId}.mp4`) with workspace-relative paths, sha256, size tracking, and the same path-safety and promotion guarantees as other media assets. Raw assets SHALL remain distinct from normalized `SCENE_VIDEO_CLIP` assets, SHALL never be deleted by normalization or rebuilds, and their storage footprint SHALL be observable.

#### Scenario: Raw and normalized stay separate
- **WHEN** a raw clip is normalized into a SceneClip
- **THEN** two distinct Asset rows SHALL exist (raw AI_SCENE_VIDEO plus normalized SCENE_VIDEO_CLIP), each independently reusable and never overwriting the other

### Requirement: Quality reference media are managed Assets
Character prototype references, Character appearance-stage references, canonical Location references, extracted continuation frames, critic sample frames, and generated Shot media SHALL use generated internal filenames, validated media types, managed workspace paths, SHA-256 hashes, project ownership, and immutable Asset records. Binary content SHALL remain outside SQLite.

#### Scenario: Store an extracted continuation frame
- **WHEN** the final frame of an accepted prior clip is extracted for continuation
- **THEN** it SHALL be validated and registered as a managed Asset with source clip ID/hash and Shot lineage before downstream generation uses it

### Requirement: Reference approval and currentness are explicit
Reference candidate Assets SHALL remain distinct from approved current reference identity. Approval, rejection, replacement, and staleness SHALL preserve historical Assets and update current pointers atomically under the owning profile/stage/Location revision. Rejected, stale, cross-project, or hash-mismatched Assets SHALL not be usable for conditioning.

#### Scenario: Reject a prototype candidate
- **WHEN** a reviewer rejects a generated Character prototype
- **THEN** the Asset SHALL remain historical, SHALL not become the profile's canonical reference, and SHALL not feed appearance-stage or Shot generation

### Requirement: Quality evidence remains bounded
Normal status and dashboard DTOs SHALL reference critic evidence by IDs, hashes, bounded scores, issue tags, and thumbnails or stream URLs. They SHALL not embed raw image/video bytes, complete model conversations, huge ComfyUI graphs, absolute paths, or unbounded sample lists.

#### Scenario: Read production status
- **WHEN** a run contains many Shot critic evaluations
- **THEN** status SHALL return bounded counts and samples while selective endpoints provide authorized evaluation details
