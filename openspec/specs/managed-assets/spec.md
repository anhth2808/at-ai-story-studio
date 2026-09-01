# Managed assets Specification

## Purpose

Keep large media and generated artifacts on a managed local filesystem while SQLite records immutable identity, validation, lineage, and current-role selection needed for safe retries and precise invalidation.

## Requirements

### Requirement: Managed workspace
The system SHALL initialize a workspace containing the SQLite database, per-project media directories, and staging directories. The workspace location SHALL be configurable and health-checkable.

#### Scenario: Initialize workspace
- **WHEN** the API or worker starts with a valid workspace configuration
- **THEN** required directories and database parent paths SHALL exist and the workspace health check SHALL report readiness

#### Scenario: Reconcile staging
- **WHEN** a process starts after an interrupted attempt
- **THEN** uncommitted partial files SHALL not be treated as current assets and stale staging data SHALL be quarantined or removed according to retention rules

### Requirement: Immutable asset records
Every imported or generated durable artifact SHALL have a stable asset identifier, project identifier, type, workspace-relative path, media type, byte size, SHA-256 hash, source entity/step where known, validation state, current flag/role, and creation timestamp.

#### Scenario: Commit generated media
- **WHEN** an output is fully written and validated
- **THEN** the file SHALL be promoted within the managed workspace before its asset record and current-role pointer are committed

#### Scenario: Preserve historical output
- **WHEN** a newer output replaces a current logical role
- **THEN** the previous asset SHALL remain addressable as historical/non-current data and SHALL not be overwritten

### Requirement: Path safety
The system SHALL store normalized workspace-relative paths and SHALL reject traversal, absolute paths, escaped project roots, unsupported upload types, and filenames used as internal identity.

#### Scenario: Reject path traversal
- **WHEN** an upload or asset operation includes `..`, an absolute path, or a resolved path outside the workspace
- **THEN** it SHALL fail before file access or database mutation

#### Scenario: Generated internal names
- **WHEN** a user uploads a file with any filename
- **THEN** the managed file SHALL use a generated internal path while the display filename, if retained, remains metadata only

### Requirement: Asset validation and serving
Imported and generated media SHALL be validated by content/probe checks appropriate to the type. Asset download/stream endpoints SHALL resolve by asset identifier and support safe range behavior without exposing arbitrary local paths.

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
- **THEN** the browser SHALL load the image from a safe Asset URL while the history API remains metadata-only
