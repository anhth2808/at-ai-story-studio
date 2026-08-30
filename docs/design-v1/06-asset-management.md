# Asset Management

## Asset record

Every durable file or structured generation artifact has:

- `Id`, `ProjectId`, `Type`, `Role`, `Status`;
- workspace-relative `Path`, media type, extension, byte length;
- content `Sha256`, logical version/revision, `CreatedAt`;
- `SourceStepId`, `SourceAttemptId`, provider/config/model snapshot;
- `InputFingerprint`, producer/version;
- media metadata: duration, sample rate/channels, dimensions, FPS, codec, language as applicable;
- `IsCurrent`, retention class, validation status/error.

Types include source story, source analysis, blueprint/context snapshot, chapter text/clean text/segment manifest, audio segment/chapter audio, subtitle, background video/image, generated image, thumbnail, music, timeline manifest, render log, and rendered video.

`Status`: `Staging`, `Ready`, `Invalid`, `Missing`, `Deleted`. Workflow status and asset status are separate: a completed step produces a `Ready` asset; invalidation makes it non-current but does not corrupt it.

## Immutable and current

Generated/imported files are immutable after registration. A new chapter edit or regenerated audio creates a new asset. `AssetRoleCurrent` (or equivalent unique current flag) points from a logical role such as `chapter/{id}/audio` to one asset. Historical assets retain provenance and may be pruned by policy.

## Lineage and staleness

`AssetDependency` stores `AssetId`, `DependsOnAssetId`, dependency role, and source hash/revision. Configuration and database entities that affect output are represented in the producing step's fingerprint; output assets copy that fingerprint.

An asset is **current** when:

1. it is `Ready` and present at its path;
2. content hash/probe metadata validate;
3. its producing step is completed/current;
4. its input fingerprint equals the fingerprint of current direct inputs; and
5. it is the current asset for its logical role.

“Stale” is a derived UI state for valid historical output with an obsolete fingerprint/current pointer. Do not rewrite it to `Invalid`; it may still be downloaded or compared.

## Commit protocol

1. Create per-attempt staging directory under the same volume as final workspace.
2. Write with a temporary name; flush/close it.
3. Compute SHA-256 and required parser/ffprobe validation.
4. Choose a collision-safe versioned destination under the project.
5. Atomically rename within the volume.
6. In one short DB transaction, insert asset/lineage, update current role, complete step.
7. If DB commit fails, leave an orphan candidate for reconciliation; never reference a partial file.

SQLite and filesystem cannot share a transaction. Reconciliation scans only managed directories: remove expired staging; mark referenced missing/corrupt assets; quarantine unreferenced completed files rather than guessing ownership.

## Path and security rules

- Store normalized workspace-relative paths only.
- Resolve then verify path remains under project/workspace root.
- Sanitize display filenames independently from physical paths.
- Copy imported content into the workspace; do not depend on removable/user paths.
- Reject unsupported file types after content probing, not extension alone.
- Serve assets through authorized project endpoints with safe range requests; never expose arbitrary local paths.

## Hashing and performance

Hash once while streaming import/output when possible. SHA-256 is the content identity/check tool, not a uniqueness guarantee replacing asset IDs. Large-file verification can trust stored size/mtime for routine UI and run full hash on import/commit/reconciliation suspicion; workflow fingerprints use stored committed hashes.

## Retention

Keep current assets, source, manifests, final renders, and failed diagnostics by default. User-triggered cleanup may delete superseded intermediate audio/text after showing recoverability impact. Never automatically delete source or the only current asset. A retention record and deletion event remain after physical removal.

## Decision: metadata in SQLite, media on filesystem

- **Alternatives:** database BLOBs; unmanaged user folders; object storage.
- **Why:** local large media is efficient and inspectable as files, while SQLite supplies lineage and transactions.
- **Trade-offs:** backup must include DB and workspace; reconciliation handles split-brain cases.
- **Future impact:** an `IAssetStore` can later target object storage if path identity remains logical and lineage stays in the database.
