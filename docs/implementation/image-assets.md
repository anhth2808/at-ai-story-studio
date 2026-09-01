# Image assets

Generated and manual Scene images use the existing managed workspace and Asset model. Binary data stays on disk; SQLite stores metadata and lineage only.

## Managed paths

Generated images are promoted from attempt staging to:

```text
projects/{projectId}/images/scenes/{sceneStableId}/{generationId}.png
```

Manual uploads use generated internal names and preserve a validated `.png`, `.jpg`, or `.webp` extension. Provider filenames and upload filenames never determine the final path. Workspace-relative paths pass the existing traversal checks.

## Validation and hashing

Studio reads bounded magic bytes for PNG, JPEG, and WEBP, then uses ffprobe to confirm decodability and positive dimensions. Empty, mislabeled, unsupported, corrupt, or unreasonable outputs fail before Asset registration. SHA-256 is streamed from disk. Images are not loaded into SQLite, encoded as base64, or re-encoded unnecessarily.

## History and current role

Every successful generated or manual image has an immutable generation revision and `SCENE_IMAGE` Asset. Older files and rows remain available for preview. One generation and one Asset per Scene role are current. Explicit Set Current rotates both pointers transactionally.

Generated freshness is derived from package and settings fingerprints. Stale results may remain historical but cannot displace a current fresh image. Review status and notes are independent of current selection.

## Preview and deletion

The API exposes project-owned Assets through `/api/assets/{id}` and generation DTOs contain only safe Asset URLs and metadata. Lists never contain binary data or arbitrary local paths.

There is no destructive history deletion UI in this change. Workspace reconciliation handles known managed paths, but long-term orphan pruning and retention policy remain future work after measured disk pressure.
