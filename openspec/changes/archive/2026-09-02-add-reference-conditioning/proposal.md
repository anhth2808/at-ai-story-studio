# Proposal: Reference conditioning for Scene images (Prompt #10)

## Why

Scene images generated from text-only prompts drift on recurring character identity: face, hair, and clothing differ across Scenes because the Visual Prompt Package describes identity in words only. FLUX.2 Klein (the tested stack) natively supports reference-image conditioning through the core `ReferenceLatent` node, so the simplest reliable identity lever is available with zero custom nodes and zero new model downloads. The request contract already carries reference asset identifiers (`REFERENCE_IMAGES_UNUSED`), so this change activates an existing seam instead of adding a new provider surface.

## What Changes

- Select ONE primary conditioning technique after ecosystem research: **Flux 2 native reference latents** (`ReferenceLatent`, core ComfyUI node). IP-Adapter, InstantID, PhotoMaker: no FLUX.2 support exists (SD1.5/SDXL-stranded ecosystem). PuLID-Flux2 (community, single maintainer, non-commercial InsightFace dependency): deferred. LoRA: documented as Prompt #10.5 candidate per policy - `LORA_REQUIRED_NOW = NO` unless the benchmark disproves reference conditioning.
- Character reference images become first-class managed Assets (`CHARACTER_REFERENCE_IMAGE`) with an upload path, `CANDIDATE`/`APPROVED`/`REJECTED` approval state, one PRIMARY reference per Character Visual Profile (first entry of the existing ordered `referenceAssetIds`), and promotion of an existing generated Scene image ("Use as Character Reference").
- Explicit `CharacterId -> referenceAssetId` conditioning mapping: `ImageGenerationRequest` gains a `conditioning` block (`TEXT_ONLY` default / `REFERENCE_CONDITIONED`); the provider builds the approved `reference-character-v1` workflow (text-to-image-v1 + `LoadImage` + `VAEEncode` + `ReferenceLatent`) only for conditioned requests.
- Project image settings gain a `conditioningMode` switch (default `TEXT_ONLY`; existing behavior unchanged unless the user opts in) plus conditioning readiness diagnostics (reference node/model checks) so "READY" never lies about the conditioned path.
- Conditioning fingerprint + persisted per-generation conditioning metadata (mode, technique, workflow version, per-character reference asset ids and hashes); reference/profile changes stale only dependent conditioned outputs through the existing package-dependency invalidation; stale in-flight results still cannot become current.
- Reference delivery to ComfyUI through the official `/upload/image` API with generated internal filenames; content validation and path safety reuse the managed-asset rules.
- UI: reference management in the Visual Bible (upload/approve/reject/set primary/remove, use-scene-image promotion), generation mode control, conditioning info display, and a two-up TEXT_ONLY vs REFERENCE_CONDITIONED comparison for one Scene.
- Real 5-Scene benchmark (1 character, 1 approved reference, conditioned vs text-only baseline) with manual scoring documented in `docs/implementation/`; batch conditioned generation reuses the existing `GENERATE_SCENE_IMAGE` queue with concurrency 1.

Not in scope: LoRA training, ControlNet, regional prompting, automatic segmentation/masking, vision-based scoring, AI video, additional conditioning pipelines.

## Capabilities

### New Capabilities
- `reference-conditioning`: Character reference asset lifecycle (upload, approval states, primary selection, Scene-image promotion) and reference-conditioned generation (conditioning mapping, workflow, fingerprint/staleness, readiness, comparison, benchmark verification).

### Modified Capabilities
- `image-generation`: request contract gains an explicit conditioning block; provider workflow registry gains the approved `reference-character-v1` template; readiness validates the conditioned workflow; generation metadata records conditioning provenance; the `REFERENCE_IMAGES_UNUSED` contract is replaced by real conditioning for character references.
- `visual-consistency`: character profile reference slots may reference only `APPROVED` `CHARACTER_REFERENCE_IMAGE` assets; a reference change propagates staleness only through the existing per-character package dependency model.
