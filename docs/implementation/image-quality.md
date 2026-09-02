# Image quality review

Prompt #11 adds structured manual quality review for Scene images. Review never mutates canonical Story, Scene, Visual Prompt Package, or Character Visual Profile data.

## Review model

One current review per Scene image generation, persisted on the generation row:

- `status`: `UNREVIEWED` | `ACCEPTED` | `REJECTED`
- `scores`: optional integer 1-5 per category - `IDENTITY`, `PROMPT_ADHERENCE`, `COMPOSITION`, `POSE_ACTION`, `LOCATION`, `IMPORTANT_OBJECTS`, `STYLE`, `ARTIFACTS`, `OVERALL`
- `issues`: unique bounded list of `WRONG_FACE`, `WRONG_HAIR`, `WRONG_CLOTHING`, `WRONG_POSE`, `WRONG_COMPOSITION`, `WRONG_CAMERA`, `WRONG_LOCATION`, `MISSING_OBJECT`, `EXTRA_OBJECT`, `DUPLICATE_OBJECT`, `BAD_HANDS`, `BAD_TEXT`, `STYLE_DRIFT`, `REFERENCE_POSE_BLEED`, `OTHER`
- `notes`: free text (max 1000 chars)

No score weighting or automatic `OVERALL` calculation exists; reviewers set it directly.

## API

- `PUT /api/projects/:p/scenes/:s/images/:g/review` - save/update a review. `status` must be `UNREVIEWED` or `REJECTED`; acceptance is a separate atomic endpoint. Invalid scores, duplicate tags, unknown tags, or overlong notes fail without replacing the last valid review.
- `PUT /api/projects/:p/scenes/:s/images/:g/accept` - atomically sets the review `ACCEPTED` AND makes the generation + its Asset the current Scene image in one transaction. All other generations/Assets for the Scene become non-current. History is never deleted.

Rejecting a candidate preserves its image, seed, metadata, and candidate-set membership. The system never picks a replacement automatically.

## DTO additions

`SceneImageGenerationDto` now carries:

- `review`: parsed structured review or `null`
- `candidateSetId` / `candidateIndex`: candidate grouping
- `productionReady` / `productionBlockers`: derived readiness - generated images must be completed, current, and visually fresh; when the optional policy below is on, review must be `ACCEPTED`

## Approval gate (optional, default off)

`image_generation_settings.requireImageApproval` (default `false`). When enabled, a Scene image is ready for downstream visual production only when current + `ACCEPTED`. Changing this policy does NOT change fingerprints, does NOT stale images, and does NOT schedule work - it is a readiness gate, not a generation input.

## Restart safety

Review scores, issues, and notes live in SQLite columns on the generation row and survive API/worker restart. Verified by the repository test that writes a rejection, closes the database, reopens it, and reads the review back intact.
