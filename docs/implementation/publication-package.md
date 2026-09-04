# Publication Package

`PublicationPackageService` converts a current production result into a
platform-neutral, reviewable package. It stops before external publishing.
There is no YouTube client, account, token, upload, or channel state in this
boundary.

## Package revisions

A package is owned by one project and production run. Every build computes a
fingerprint from:

- current scoped ProjectVideo
- current chapter subtitle Assets
- selected thumbnail Asset, when present
- normalized scope
- editable metadata
- measured chapter markers
- package inputs and version

A ready package with the same fingerprint is reused. Metadata and thumbnail
changes create a new revision and mark the previous package stale. Revision
history remains in SQLite; package rows store Asset IDs and metadata, not binary
content or absolute local paths.

## Metadata ownership

Metadata is validated as title, description, short description, tags, content
warning, and language. Manual metadata is retained by a rebuild because the
current package metadata is used as the next draft. A future OMP metadata draft
must pass the same strict schema and must never overwrite a manual revision
without an explicit user action.

## Quality gate

A package is `READY` only when the current scoped ProjectVideo and all required
subtitles are available and valid. A required thumbnail or metadata omission is
blocking according to the active profile. Optional thumbnail absence is a
visible warning. Missing or stale inputs produce `INCOMPLETE` or `STALE`; they
are never presented as ready to publish.

Chapter markers use ordered chapter titles and measured audio durations. An
unknown duration is represented as zero only for the current bounded marker
calculation; a production integration should promote an explicit incomplete
issue when measured timing is required. No fabricated video duration is put in
the manifest.

## Manifest

The validated manifest contains format/version, project/run/package identity,
fingerprint, scope, Asset IDs, SHA-256 hashes, media types, byte counts,
durations, export-relative names, API URLs, metadata, chapter markers,
validation issues, scalar metrics, and an ISO timestamp. It rejects absolute
paths, traversal segments, backslashes, credentials, raw provider graphs, and
binary fields.

## Export

`EXPORT_PUBLICATION_PACKAGE` is an ordinary durable workflow step. The worker:

1. validates the package is ready and parses a safe directory name
2. creates a managed `exports/<directory>` target under the workspace
3. copies video, subtitles, and optional thumbnail through `.partial` files
4. atomically renames completed files and `manifest.json`
5. records export status and the manifest in SQLite

Cancellation is checked between file copies. A failure removes the target and
records a bounded safe error. Source paths are resolved with workspace path
safety, and generated destination names are derived from validated Asset paths.
An incomplete package cannot schedule an export.

## API and UI

The API exposes package read, rebuild scheduling, metadata revision, thumbnail
selection, export scheduling, and export status routes. Project ownership and
optimistic revision checks are enforced before mutation. The web Production
panel shows validation, metadata, manifest, final package controls, and export
state without exposing local paths or binary data.
