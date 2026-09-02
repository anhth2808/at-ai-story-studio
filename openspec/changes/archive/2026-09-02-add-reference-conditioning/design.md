# Design: Reference conditioning for Scene images

## Context

Prompt #9 shipped `text-to-image-v1` (Flux 2 native graph built and validated in code, not JSON files), a project `image_generation_settings` row, immutable `scene_image_generations` revisions with package/settings fingerprints, and Asset-backed Scene images. The seam already exists: character profiles carry validated `referenceAssetIds` (`CHARACTER_REFERENCE_IMAGE`, project-owned, READY), packages carry those ids into `dependencies`, `scheduleScene` collects them into `request.referenceImages`, and the provider reports `REFERENCE_IMAGES_UNUSED`.

Tested stack (docs/implementation/comfyui.md): ComfyUI 0.33.1 at 127.0.0.1:8188, `flux-2-klein-base-4b-fp8`, `qwen_3_4b`, `full_encoder_small_decoder`, native nodes only, RTX 3060 12GB.

Ecosystem research (2026-09, primary sources: bfl.ai/blog/flux-2, bfl.ai klein blog, docs.bfl.ai, docs.comfy.org/built-in-nodes/ReferenceLatent, Comfy-Org workflow_templates JSONs, ComfyUI server.py):

- FLUX.2 multi-reference is native to the architecture; klein 4B supports it (HF card; BFL API limit for klein: 4 references). `ReferenceLatent` is a **core** node (since v0.3.42, Kontext era; Flux 2 day-0 v0.3.72; klein v0.9.2). Zero custom nodes, zero extra models, Apache-2.0 stack.
- Official klein-base edit template shape: two `CLIPTextEncode` (pos+neg), each chained through `ReferenceLatent`; the same `VAEEncode` reference latent feeds both the positive and negative chain; `CFGGuider` (cfg 5) -> `SamplerCustomAdvanced`. Dev template: `LoadImage -> ImageScaleToTotalPixels (lanczos) -> VAEEncode -> ReferenceLatent`. Multi-reference = chained `ReferenceLatent` nodes.
- Rejected by research: IP-Adapter (SD1.5/SDXL; no FLUX.2 model exists), InstantID (SDXL only; HF search "flux.2 instantid" = empty), PhotoMaker (SD-era, dormant), PuLID-Flux2 (community, single maintainer, ~5 months old, requires non-commercial InsightFace antelopev2 + EVA-CLIP ~800MB) - deferred, not selected. LoRA training on klein base is mature (ai-toolkit MIT, diffusion-pipe) but per policy is the #10.5 candidate unless the benchmark proves reference conditioning insufficient.
- Reference upload API: `POST /upload/image` multipart (`image`, `type=input`, `subfolder`, `overwrite`), returns `{name, subfolder, type}`; `LoadImage` widget is `[name, "image"]`. Duplicate names get " (n)" suffixes unless identical content, so clients must use the returned `name`.
- VRAM: klein 4B base fp8 measured ~8.4-9.2GB on newer hardware; reference latents add sequence tokens (bounded by scaling references to ~1MP before encode). Fits 12GB with the existing single-concurrency worker.

## Goals / Non-Goals

**Goals:**
- One primary technique, implemented end to end: upload -> approve -> primary -> conditioned generation -> comparison -> benchmark evidence.
- Correct scoped invalidation: reference changes flow through the existing profile-dependency model only.
- TEXT_ONLY path byte-for-byte unchanged in behavior (default mode).

**Non-Goals:**
- LoRA training, PuLID/IP-Adapter/InstantID integration, ControlNet, regional prompting, segmentation, vision scoring, per-reference strength controls, multi-reference-per-character conditioning, workflow JSON files, face-detection/cropping infrastructure.

## Decisions

### D1. Primary technique: Flux 2 native reference latents (`reference-character-v1`)
Chosen because it is the only option that is core-node, zero-download, license-clean, and verified against the exact klein template. PuLID-Flux2 is the only deferred candidate with real klein support; it stays documented as an upgrade if face-embedding strength is later needed. LoRA: `LORA_REQUIRED_NOW = NO` pending benchmark evidence; revisit as #10.5.

### D2. Workflow stays in code, registry becomes per-template
Keep the existing pattern (graphs built by `buildComfyUiPrompt`, validated against per-template node-class/input/link tables). Replace the single `TEXT_TO_IMAGE_V1_*` tables with a `WORKFLOW_MAPPINGS` registry keyed by template: `text-to-image-v1` (unchanged graph) and `reference-character-v1` (text graph + per reference: `LoadImage` -> `ImageScaleToTotalPixels` (lanczos, 1.0 MP, bounds token growth) -> `VAEEncode`, `ReferenceLatent` chained on the positive `CLIPTextEncode` output and the same reference latents chained on the negative chain, matching the official klein-base CFG template). `validateComfyUiPrompt(prompt, template)` dispatches on the registry. No `comfyui/workflows/*.json` files: a JSON side-load path would be a second convention beside the validated in-code builder.

### D3. Conditioning contract
`ImageGenerationRequest` gains `conditioning: { mode: 'TEXT_ONLY' | 'REFERENCE_CONDITIONED', characters: [{ characterId, referenceAssetId, referenceSha256, referencePath, profileRevision }] }` (max 4 characters - klein's tested reference limit; overflow of eligible characters records a persisted warning). `referenceImages` (package-wide provenance list) stays as-is; in TEXT_ONLY it still triggers `REFERENCE_IMAGES_UNUSED`. No strength/end-step settings: `ReferenceLatent` exposes none natively, and the spec forbids exposing unsupported knobs. Per-character weight is not possible natively; documented limitation.

### D4. Mode resolution and fallback
`image_generation_settings.conditioning_mode` (default `TEXT_ONLY`, migration 0011) is the project default; `sceneImageGenerationScheduleSchema` and `sceneImageRegenerationSchema` gain an optional per-request override so one Scene can be generated both ways for comparison. `REFERENCE_CONDITIONED` with zero eligible approved primary references fails scheduling with `PREREQUISITE_MISSING` (explicit, no silent fallback). Technical reference failures classify as a new retryable `REFERENCE_UPLOAD_FAILED` code; retry reuses the same conditioned request. "Generate without reference" is the explicit TEXT_ONLY override, never automatic.

### D5. Reference identity: profile array stays the single source of truth
Primary = first entry of the profile's ordered `referenceAssetIds`. Approve/reject lives in asset `metadata.approval` (no new table, no migration for references). Database `assertReferences` additionally requires `metadata.approval='APPROVED'` for `CHARACTER` kind, so only approved references can enter a profile revision. Upload route registers the asset with `role='CHARACTER_REFERENCE_IMAGE'`, `metadata: { characterId, approval: 'CANDIDATE', displayName }`; listing uses `type='CHARACTER_REFERENCE_IMAGE'` + `json_extract(metadata,'$.characterId')`. Alternative rejected: a `character_reference_images` table - duplicates what profile payload + asset metadata already persist.

### D6. Reference delivery
At schedule time the service resolves each bound asset to its workspace-relative path and hash (validated READY + type + approval). At generate time the provider streams each file to `POST /upload/image` with a generated name (`studio-refs/{uuid}.png` subfolder), uses the returned `name` in `LoadImage`, and classifies upload failure as `REFERENCE_UPLOAD_FAILED` (retryable). `ComfyUiImageProvider` constructor gains the workspace root (it already receives staging) to resolve reference paths; request carries workspace-relative paths only. Provider concurrency stays 1 (existing worker claim model).

### D7. Readiness and metadata
`ComfyUiImageProvider.readiness` always checks the base template; when the project mode is `REFERENCE_CONDITIONED` it also validates the conditioning template's node classes (`LoadImage`, `ImageScaleToTotalPixels`, `VAEEncode`, `ReferenceLatent`) and reports a non-READY status with `details.conditioning` in {`CONDITIONING_READY`, `REFERENCE_NODE_MISSING`, `MODEL_MISSING`, `INCOMPATIBLE_WORKFLOW`} + `missingNodes`. In TEXT_ONLY the same diagnostic is informational only. Result metadata records `{ workflowTemplate, mappingVersion, conditioning: { mode, characters: [...] } }`; `reference-character-v1-mapping-1` is the new mapping version constant. Fingerprint input gains conditioning mode, mapping version, and per-character `{assetId, sha256}` (assets are immutable, so no false staleness).

### D8. Staleness and in-flight safety reuse the existing guards
No new invalidation edges: reference change -> profile revision bump (existing route) -> `invalidateDependency` stales dependent packages -> image freshness degrades on package-fingerprint mismatch; `commitGenerated`'s existing freshness guard keeps the late result historical. Scope is automatic: packages depend on specific character profiles, so Mei-only Scenes and Story/TTS are untouched.

### D9. UI (single main.tsx, Vietnamese copy)
Visual Bible character card: reference strip (thumbnails, upload, approve/reject, set primary = reorder via existing PUT route, remove) and "Dùng ảnh cảnh làm tham chiếu" promotion entry on Scene image revisions. Scene image panel: mode selector (project default + per-generate override), conditioning info line (technique, references used, workflow, seed), and a two-up compare of any two revisions (mode, workflow, seed, references metadata). No benchmark UI panel; benchmark evidence lives in docs (spec requires evidence, not a tool).

### D10. Promotion
`promoteToCharacterReference(projectId, sceneId, generationId, characterId)` copies the generation's committed image file to `projects/{id}/references/{uuid}.{ext}`, registers an `APPROVED` reference asset, and appends it to the profile's references via the normal revision path. Source generation/asset untouched.

## Risks / Trade-offs

- [Identity swap in 2-character scenes is unquantified upstream] -> Explicit persisted mapping + per-subject prompt text already produced by packages; honest `MULTI_CHARACTER_CONDITIONING = LIMITED` verdict in the benchmark doc; single-character is the success bar.
- [klein 4B may preserve face but drift clothing/hair] -> Benchmark scores hair/clothing/style separately; docs state exactly what the technique preserves; no "character consistency" overclaim.
- [Reference image dominates composition (all scenes look like the ref)] -> Official guidance is prompt-driven pose/scene text; benchmark includes wide/medium/close-up variance; if overfit is observed, document before adding knobs.
- [12GB VRAM with multiple reference latents] -> 1.0MP pre-scale bounds tokens; concurrency stays 1; readiness unchanged; OOM surfaces as classified retryable failure.
- [ComfyUI upload API drift] -> Upload uses documented multipart fields verified against server.py; failure is classified and retryable; no filesystem writes into ComfyUI dirs.
- [Approval metadata is advisory JSON, not a column] -> Enforced in the same `assertReferences` transaction that already validates type/ownership; one write path keeps it consistent.

## Migration Plan

1. Migration 0011: `ALTER TABLE image_generation_settings ADD COLUMN conditioning_mode TEXT NOT NULL DEFAULT 'TEXT_ONLY'`. Existing rows keep current behavior (settings fingerprint changes -> existing scenes' images go stale once, consistent with any settings change; acceptable and honest, batch regeneration is explicit).
2. Extend shared schemas additively (new enum members, new optional fields with defaults); old persisted requests in `metadata` remain parseable because `request` snapshots are schema-parsed as `unknown` JSON - the `scheduledRequestSchema` re-parse must accept legacy requests without `conditioning` (default TEXT_ONLY).
3. Rollback: feature is default-off; switching `conditioning_mode` back to `TEXT_ONLY` restores prior behavior without code rollback.

## Open Questions

- Exact `ImageScaleToTotalPixels` input names and the klein template's negative-chain wiring are confirmed against the template JSON during implementation (task 2); if the local ComfyUI build's template differs, the local `/object_info` definitions win.
