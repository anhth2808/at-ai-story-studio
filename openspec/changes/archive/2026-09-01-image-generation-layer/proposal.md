## Why

The persisted Visual Prompt Package now provides a stable provider-neutral input, but the application cannot turn it into pixels or manage Scene image revisions. This change adds the first real image path through one local ComfyUI instance while preserving the current Story, Scene, visual consistency, workflow, asset, TTS, subtitle, and render boundaries.

## What Changes

- Add a narrow `ImageProvider` contract whose input is a CURRENT `VisualPromptPackage`; providers do not reconstruct Story, chapter, character, location, or StoryState context.
- Add `ComfyUiImageProvider` for the current self-hosted ComfyUI API: validate one application-approved API-format workflow, submit through `/prompt`, persist the prompt ID, resume through `/history/{prompt_id}` and `/queue`, retrieve outputs through `/view`, and classify provider failures.
- Commit one zero-custom-node `text-to-image-v1` workflow template and a centralized node mapping for prompt, negative prompt, seed, dimensions, steps, guidance, sampler, model components, and output node. Keep model filenames configurable and validate required native nodes and model availability before use.
- Add minimal persisted project image settings for ComfyUI URL, timeouts, template, model components, resolution, steps, guidance, sampler, and RANDOM/FIXED seed mode. Add readiness states `NOT_CONFIGURED`, `UNREACHABLE`, `READY`, `INVALID_WORKFLOW`, `INCOMPATIBLE_API`, and `ERROR`.
- Add immutable Scene image generation revisions with separate generation status, visual freshness, review status, requested/actual seed, provider prompt ID, input fingerprint, attempt/error metadata, dimensions, duration, feedback, and explicit current selection.
- Store validated PNG/JPEG/WEBP output in generated workspace paths, register it as `SCENE_IMAGE`, and serve metadata/URLs rather than image bytes in list JSON. Provider filenames and subfolders are never used as workspace paths.
- Reuse the existing SQLite workflow step/job/lease/retry/cancellation system for one-Scene and bounded batch generation. Default local GPU concurrency remains one because the existing worker executes one step at a time.
- Keep technical retry on the same logical generation and seed separate from creative regeneration, which creates a new revision with the same or a new seed. Preserve every prior valid image.
- Prevent a stale package or changed generation fingerprint from becoming CURRENT. A completed historical output may remain stored with stale freshness for review.
- Add manual Scene image upload, explicit current selection, simple UNREVIEWED/ACCEPTED/REJECTED review, optional review/regeneration notes, preview, same-seed regeneration, new-seed regeneration, and missing/stale/selected Scene batch actions.
- Add Vietnamese Scene and Image Generation settings UI, readiness testing, persisted job polling, image history, preview, review, retry, regeneration, and current-selection controls.
- Add provider mapping, malformed workflow, output validation, stale-result, retry, regeneration, manual override, restart recovery, batch, regression, and real ComfyUI smoke verification. Completion requires two persisted real revisions for one Scene and visual inspection; a fake provider alone is insufficient.
- Document the tested ComfyUI/model setup, API lifecycle, workflow mapping, seed semantics, recovery/cancellation limits, staleness, manual override, and the lack of reference conditioning or pixel-perfect identity guarantees.
- Do not add arbitrary workflow execution, a node editor, custom nodes, model download, cloud scheduling, reference conditioning, vision scoring, automatic best-image selection, AI video, image-to-video, or a second queue.

## Capabilities

### New Capabilities

- `image-generation`: Provider-neutral Scene image requests/results, controlled ComfyUI execution, readiness, settings, immutable generation revisions, validated assets, seeds, review/current selection, manual override, batch generation, recovery, and real-image verification.

### Modified Capabilities

- `visual-consistency`: A CURRENT Visual Prompt Package becomes the exclusive image-generation input, reference assets remain forward-compatible but unused by `text-to-image-v1`, and stale visual dependencies mark generated images visually stale without deleting them.
- `durable-workflow-jobs`: Add independently retryable Scene image steps with persisted provider prompt IDs, restart reconciliation, stale-result guards, timeout/cancellation classification, and bounded batch scheduling.
- `managed-assets`: Add validated generated/manual Scene image assets, immutable revision history, safe workspace storage, explicit current selection, freshness metadata, and streamed preview URLs.
- `scene-engine`: Link generated/manual image revisions to the exact Scene and Visual Prompt Package without moving image-provider logic into Scene planning.
- `story-engine-ui`: Add Vietnamese image settings, readiness, Scene image generation/history/review/preview/manual-upload, regeneration, retry, current-selection, and batch controls.
- `project-and-chapter-management`: Add minimal project image-generation settings and scoped visual-image invalidation while preserving unrelated narrative and media outputs.

## Impact

Affected areas are `packages/shared` image schemas and DTOs; `packages/database` additive migration, Drizzle schema, generation/settings repositories, asset-current transactions, and freshness queries; `packages/workflow` provider contracts, controlled ComfyUI adapter/template mapping, image orchestration, scheduling, recovery, validation, and tests; `packages/media` streamed download and image inspection helpers where existing utilities do not cover them; `apps/api` thin settings/readiness/image/history/manual-upload/batch routes; `apps/worker` image step dispatch through the existing executor; `apps/web` Vietnamese Settings and Scene image UI; `docs/implementation`; and permanent provider/stale-result rules in `AGENTS.md`.

The first tested local configuration targets the running self-hosted ComfyUI `0.33.1` server at `http://127.0.0.1:8188` with native Flux 2 nodes, `flux-2-klein-base-4b-fp8.safetensors`, `qwen_3_4b.safetensors`, and `full_encoder_small_decoder.safetensors`. Model names remain project/provider settings rather than domain or Style Bible fields. Existing databases migrate in place, and no current Story/TTS/subtitle/render contract is removed.