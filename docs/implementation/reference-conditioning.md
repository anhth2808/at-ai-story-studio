# Reference conditioning

Prompt #10 selects ONE primary identity-conditioning technique and implements it end to end.

## Technique evaluation (researched 2026-09 against the actual stack)

Tested stack: ComfyUI 0.33.1, `flux-2-klein-base-4b-fp8`, `qwen_3_4b`, `full_encoder_small_decoder`, RTX 3060 12GB.

| Technique                                                     | Current model compatible                                                                                                                                    | Face   | Full identity                                                                        | Complexity                                                                                   | Decision     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------ |
| Flux 2 native reference latents (`ReferenceLatent` core node) | YES - native to FLUX.2 architecture; klein supports up to 4 references (BFL API docs); verified in `/object_info` and the official klein-base edit template | Strong | Face, clothing, proportions, style per official BFL/ComfyUI guidance (not face-only) | Zero custom nodes, zero extra models                                                         | **SELECTED** |
| IP-Adapter (+ FaceID)                                         | NO - SD1.5/SDXL only; community FLUX.1 adapters (XLabs, Shakker); no FLUX.2 model exists (HF search evidence)                                               | -      | -                                                                                    | Custom node (maintenance-only since 2025-04)                                                 | Rejected     |
| InstantID                                                     | NO - SDXL only; HF search "flux.2 instantid" returns nothing                                                                                                | -      | -                                                                                    | Custom node (dormant)                                                                        | Rejected     |
| PhotoMaker                                                    | NO - SD1.5/SDXL, frozen since 2024                                                                                                                          | -      | -                                                                                    | Core nodes experimental, upstream dead                                                       | Rejected     |
| PuLID-Flux2                                                   | Community port (iFayens, MIT, Klein 4B/9B supported)                                                                                                        | Strong | Face-focused                                                                         | Custom node + InsightFace antelopev2 (non-commercial) + EVA-CLIP (~800MB), single maintainer | Deferred     |
| Character LoRA on klein base                                  | Mature training path (ai-toolkit MIT, diffusion-pipe GPL; train the BASE, not distilled)                                                                    | Strong | Full identity, promptable without reference image                                    | Dataset collection + training + lifecycle management                                         | Deferred     |

`LORA_REQUIRED_NOW = NO` pending benchmark evidence; LoRA is the documented #10.5 candidate if reference conditioning proves insufficient. See `conditioning-benchmark.md` for the verdict after the real 5-Scene benchmark.

## Selected workflow: `reference-character-v1`

The graph is the existing `text-to-image-v1` base plus, per conditioned character reference:

```text
LoadImage -> ImageScaleToTotalPixels (lanczos, 1.0 MP, resolution_steps 1)
          -> VAEEncode -> ReferenceLatent (chain on positive conditioning)
                       -> ReferenceLatent (chain on negative conditioning)
```

- The same `VAEEncode` reference latent feeds both the positive and negative `ReferenceLatent` chain; the last chain output feeds `CFGGuider` positive/negative. This mirrors the official ComfyUI klein-base CFG edit template.
- Multiple references = chained `ReferenceLatent` nodes (node `conditioning` input from the previous chain output).
- The reference image is scaled to ~1 MP before encoding to bound sequence-token growth (VRAM safety on 12GB; the base fp8 workflow measures ~8.4-9.2GB).
- Node shapes verified against the local server's `/object_info`: `LoadImage{image}`, `ImageScaleToTotalPixels{image,upscale_method,megapixels,resolution_steps}`, `VAEEncode{pixels,vae}`, `ReferenceLatent{conditioning,latent?}`.

## Conditioning contract

- `ImageGenerationRequest.conditioning = { mode, characters[] }`, `mode` in `TEXT_ONLY` (default) / `REFERENCE_CONDITIONED`.
- `characters[]` is the explicit `CharacterId -> reference` mapping: `{ characterId, referenceAssetId, referenceSha256, referencePath, profileRevision }`, max 4 (klein's tested reference limit). Overflow records a persisted `conditioningWarnings` entry.
- Only the PRIMARY reference (first entry of the profile's `referenceAssetIds`) conditions a character in this milestone. Additional approved references are stored but not consumed.
- Per-reference strength/end-step controls do NOT exist natively in `ReferenceLatent`, so none are exposed. Per-character weighting is not possible natively; it is a documented limitation.
- No automatic fallback: conditioning failures classify as retryable `REFERENCE_UPLOAD_FAILED` and retry the same conditioned job. "Generate without reference" is an explicit TEXT_ONLY choice.

## Fingerprint and staleness

The generation fingerprint input includes the package fingerprint, settings fingerprint, actual `workflowTemplate`, and the full request - which carries the conditioning block with per-character asset ids and content hashes. Assets are immutable, so hashes cannot produce false staleness. Reference changes flow ONLY through the existing profile-dependency invalidation (profile revision -> package STALE -> dependent images stale). Unrelated characters' images and all Story/TTS/render data are untouched. A conditioned result completing after its reference changed is stored as history and never becomes current.
