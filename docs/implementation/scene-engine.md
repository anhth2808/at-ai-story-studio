# Scene Engine

The Scene Engine is a review-first visual planning layer beside Story Engine. It converts one persisted chapter revision into an ordered scene plan and bounded visual metadata. It does not generate pixels, call image providers, or enqueue image/video jobs.

## Data model

Scene planning uses two revisioned records:

- `scene_plan_revisions`: chapter-level density, optional target range, chapter
  revision, visual-style revision, input fingerprint, generation provenance,
  status, and current pointer.
- `scene_revisions`: one revision chain per stable scene identity. Each record
  stores scene number, source range, purpose, location snapshot, characters,
  visual description, camera, composition, important objects, lighting, color
  mood, image prompt, negative prompt, continuity notes, prompt status,
  provenance, and current pointer. It also stores the exact source-content
  snapshot used for its offsets, so stale scene detail reads do not slice a
  later chapter revision.
- `scene_characters`: the scene-local character appearance/state snapshot. A reference is either resolved to a canonical blueprint character or remains explicitly unresolved.
- `visual_style_settings`: project-level revision chain used by planning and prompt refresh.
- `locations`: project registry with normalized names and draft/active status.

Historical plan, scene, style, and location rows remain queryable through the database even though normal API reads return current pointers. Manual scene edits and creative regeneration create a new scene revision; they never rewrite chapter text or prior scene evidence.

## Source traceability

Every scene has a half-open source range `[start, end)` measured in JavaScript UTF-16 code units. This matches the offsets used by the browser and JavaScript `String.prototype.slice`, including surrogate pairs such as emoji. Ranges must be non-empty, in bounds for the exact chapter revision, ordered, and non-overlapping. Detail reads may request a bounded read-only excerpt; the excerpt is never used as a replacement for the full persisted chapter text.

A chapter revision change marks its current scene plan and current scene revisions stale and marks prompts stale. The old rows remain available for comparison. Regeneration may not move a scene to a different source range or scene number.

## Splitting and density

Scene Engine makes one chapter-level OMP planning call. The requested density is a control, not a promise of an exact count:

- `LOW`: larger visual beats and fewer transitions.
- `MEDIUM`: balanced visual beats and the default.
- `HIGH`: more frequent transitions where the text supports them.

An optional `{ min, max }` target range constrains the requested output. Provider output is accepted only when scene numbers are contiguous, ranges are valid, fields satisfy the strict schema, and every scene has a non-empty image prompt. The provider cannot silently invent chapter text or change the source anchors.

## Context and provenance

The exact chapter text is required. Blueprint essentials, selected planned characters, StoryState, bounded prior summaries, current visual style, and trusted instructions are selected independently under a token budget. Optional sections are omitted as whole valid sections and recorded in generation metadata as selected/omitted diagnostics. Overlarge chapter text or regeneration context fails explicitly with a context error; it is not silently truncated.

Each accepted generation stores operation, prompt/schema versions, input fingerprint, source revision, selected/omitted context, provider/model, nullable usage values, and completion metadata before the workflow step is completed. A worker recovering after a commit uses the workflow step and fingerprint to return the committed result instead of calling OMP again.

## Workflow

`GENERATE_SCENES` creates one atomic current plan containing all scenes. `REGENERATE_SCENE` creates one new revision for the selected scene. `GENERATE_SCENE_PROMPT` changes only prompt fields and creates a new scene revision. All three use the existing SQLite workflow, job, lease, retry, cancellation, and restart paths.

The UI exposes chapter selection, density, target range, style, source excerpts, scene edits, independent regeneration, prompt refresh, and unresolved-reference/continuity warnings. Background image/video upload and MP4 rendering remain explicit V1 media actions after review.
