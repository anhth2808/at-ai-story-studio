## ADDED Requirements

### Requirement: Publication references use managed Asset identity
Publication thumbnails and package media references SHALL use immutable managed Asset IDs, hashes, validation state, project ownership, and workspace-safe URLs or export-relative names. A `PUBLICATION_THUMBNAIL` role/type MAY reference an existing validated image or an explicitly uploaded managed Asset; package rows SHALL not store binary content or absolute filesystem paths.

#### Scenario: Select a thumbnail
- **WHEN** a user selects a valid current Scene image or uploads a thumbnail for a package
- **THEN** the package SHALL retain the Asset ID and hash and SHALL reject a cross-project, invalid, stale, or unsafe path reference

### Requirement: Package export preserves asset safety
A local package export SHALL copy only validated managed Assets through the existing path-safety and staging rules, verify copied hashes, and retain prior package revisions when a new export is created.

#### Scenario: Export a package
- **WHEN** a READY package is exported
- **THEN** the output directory SHALL contain generated safe names and matching checksums without exposing or following a traversal path
