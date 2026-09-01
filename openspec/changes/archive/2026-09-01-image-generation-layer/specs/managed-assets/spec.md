## ADDED Requirements

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
