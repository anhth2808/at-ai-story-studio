# Character references

Character reference images are managed Assets of type `CHARACTER_REFERENCE_IMAGE`. There is no second image-storage system; reference files live under `projects/{projectId}/references/` with generated internal names.

## Lifecycle

```text
upload / promote Scene image  ->  Asset (CANDIDATE)
approve                        ->  Asset (APPROVED)
attach to profile (ordered)    ->  profile revision bump -> package invalidation
conditioned generation         ->  uses APPROVED primary (first attached entry)
```

- Approval state (`CANDIDATE` / `APPROVED` / `REJECTED`) lives in asset `metadata.approval` and is changed only by explicit user action. Only `APPROVED` references can be attached to a Character Visual Profile (enforced in the same transaction that validates ownership, `READY` status, and type).
- The profile's ordered `referenceAssetIds` is the single source of truth: the FIRST entry is the PRIMARY reference used by conditioning; further entries are additional references that this milestone's conditioning does not consume.
- Setting the primary (reorder), attaching, and removing all go through the existing profile references update (`PUT /api/projects/:projectId/visual-bible/characters/:characterId/references`), which creates a new immutable profile revision and invalidates dependent packages.

## API

- `POST /api/projects/:projectId/characters/:characterId/references` - multipart `file` (PNG/JPEG/WEBP). Content is validated by signature + ffprobe dimensions (a text file named `.png` is rejected). Registers a `CANDIDATE` asset with `metadata: { characterId, approval, displayName }`.
- `GET /api/projects/:projectId/characters/:characterId/references` - list with `approval`, `isPrimary`, `attached`, `profileRevision`, and safe asset URLs.
- `PATCH .../references/:assetId/approval` - body `{ approval }`; rejects assets owned by a different character.
- `POST /api/projects/:projectId/scenes/:sceneId/images/:generationId/promote-reference` - body `{ characterId, expectedRevision, primary }`. Copies the completed generation's image into a new `APPROVED` reference Asset (source generation and asset are never modified), then attaches it to the profile through the normal revision path (primary=true puts it first).

## Reference changes and invalidation

Attaching, reordering, or removing references creates a new profile revision. Packages that depend on that character profile become `STALE` through the existing dependency model, and their dependent Scene images become visually stale on the next freshness check. Scenes whose packages do not depend on the character, and all Story/TTS/render state, are untouched. Historical images are never deleted.
