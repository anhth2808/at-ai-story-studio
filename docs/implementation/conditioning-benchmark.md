# Conditioning benchmark (Prompt #10)

Real ComfyUI benchmark executed 2026-09-02 against the tested stack
(ComfyUI 0.33.1, `flux-2-klein-base-4b-fp8`, `qwen_3_4b`,
`full_encoder_small_decoder`, RTX 3060 12GB, localhost:8188).

## Setup (exact steps)

1. Project `649a6dfa-8f9e-4d43-824d-bdceb9d50b0e` ("Reference Conditioning Benchmark"), language vi-VN.
2. Story settings + manual blueprint with recurring character `linh` ("Linh", 25-32, tan skin, black low-tied hair, old yellow rain coat).
3. One manual chapter "Ba đêm của ngọn đèn" (1,373 chars) containing five visually distinct Linh moments (golden-hour lamp platform / engine room at night / storm cliff with bleeding hand / candle-lit chart table / tower top in the storm peak).
4. OMP scene planning (`openai-codex/gpt-5.6-luna`) produced exactly 5 CURRENT scenes, all resolving `linh`.
5. OMP character profile for `linh` generated and APPROVED (v1).
6. Image settings: FIXED seed `1010101`, 1024x576, 20 steps, guidance 5, euler, `conditioningMode: TEXT_ONLY` (default).
7. Scene 1 generated TEXT_ONLY (seed 1010101), manually reviewed, then PROMOTED via
   `POST .../scenes/:id/images/:genId/promote-reference` -> new `APPROVED` `CHARACTER_REFERENCE_IMAGE` asset
   `75a4e71c-b9f3-4f2b-b85c-5710e8179939` attached as PRIMARY (profile v2). Packages rebuilt.
8. Matrix: for each of the 5 scenes, one `TEXT_ONLY` and one `REFERENCE_CONDITIONED` generation - both at seed 1010101, same package generation.

## Persistence evidence (restart-safe)

API and worker processes were restarted multiple times during the run
(migration 0011 rollout, provider fixes). References, primary selection,
approval states, conditioning metadata, and current selections survived every
restart. Failed attempts remain as immutable `FAILED`/`STALE` history rows
(duplex upload debugging iterations) - retained, never deleted.

## Per-scene results

| Scene                    | Mode                  | Workflow               | Status    | Notes                                                                                        |
| ------------------------ | --------------------- | ---------------------- | --------- | -------------------------------------------------------------------------------------------- |
| 1 lamp platform (close)  | TEXT_ONLY             | text-to-image-v1       | COMPLETED | baseline identical to the promoted reference (same seed/source)                              |
| 1                        | REFERENCE_CONDITIONED | reference-character-v1 | COMPLETED | re-anchors to its own source; near-identical pair                                            |
| 2 engine room (night)    | TEXT_ONLY             | text-to-image-v1       | COMPLETED | good adherence, clearly different person                                                     |
| 2                        | REFERENCE_CONDITIONED | reference-character-v1 | COMPLETED | identity locked, but composition re-anchored to the reference scene; engine-room moment lost |
| 3 storm cliff (wide)     | TEXT_ONLY             | text-to-image-v1       | COMPLETED | strong adherence, different face, no yellow coat                                             |
| 3                        | REFERENCE_CONDITIONED | reference-character-v1 | COMPLETED | reference identity + harness, blood, storm waves, ship in frame                              |
| 4 chart table (medium)   | TEXT_ONLY             | text-to-image-v1       | COMPLETED | adherence good, younger rounder face drift                                                   |
| 4                        | REFERENCE_CONDITIONED | reference-character-v1 | COMPLETED | closer to reference face/coat, all scene elements kept                                       |
| 5 tower top (storm peak) | TEXT_ONLY             | text-to-image-v1       | COMPLETED | identity drifted; lighthouse lamp became a street lamp on a generic pier                     |
| 5                        | REFERENCE_CONDITIONED | reference-character-v1 | COMPLETED | reference identity, lamp housing + storm + boat present                                      |

Every conditioned record persisted `workflowTemplate=reference-character-v1`,
`mappingVersion=reference-character-v1-mapping-1`, and the explicit mapping
`linh -> asset 75a4e71c` with content hash and profile revision 2.

## Manual scores (1-5, scored from the 10 real images)

| Metric                  | TEXT_ONLY (all 5) | CONDITIONED (all 5) | TEXT_ONLY (s2-5) | CONDITIONED (s2-5) |
| ----------------------- | ----------------- | ------------------- | ---------------- | ------------------ |
| FACE_IDENTITY           | 2.8               | 4.6                 | 2.25             | 4.50               |
| HAIR                    | 3.0               | 4.4                 | 2.50             | 4.25               |
| CLOTHING                | 3.4               | 4.6                 | 3.00             | 4.50               |
| STYLE                   | 4.2               | 5.0                 | 4.00             | 5.00               |
| PROMPT_ADHERENCE        | 3.8               | 3.8                 | 3.50             | 3.50               |
| Overall recognizability | 2.8               | 4.4                 | 2.25             | 4.25               |

(Scene 1 is degenerate for comparison: its conditioned output re-anchors to the
image that itself became the reference. The s2-5 columns are the honest signal.)

## What improved

- Face identity across scenes: 2.25 -> 4.50 (scenes 2-5). The text-only run
  produced a visibly different person in scenes 2, 3, and 5; the conditioned
  run kept the same woman throughout.
- Hair (tied-back black hair) 2.50 -> 4.25 and the yellow rain coat
  3.00 -> 4.50 (the text-only scene-3 output lost the coat entirely).
- Style consistency 4.0 -> 5.0.
- Prompt adherence did NOT degrade on 3 of 4 comparison scenes; scene 3 kept
  blood/harness/ship, scene 4 kept map/pencil/candle/radio, scene 5 gained the
  actual lamp housing.

## What did not improve / failures

- Scene 2 is a real failure mode: with the same seed, the reference latent
  dominated and the output re-used the reference scene's composition instead of
  the engine-room moment (adherence 2/5). Identity was perfect; the scene
  content was not. Mitigation for production use: generate conditioned images
  with new seeds or slightly reworded scene prompts when the reference
  composition bleeds through; escalate to LoRA only if that proves insufficient.
- Scene 5 conditioned shows a floating pocket-watch quirk (from the "winding
  the clock" text) and a lamp housing detached from the tower body.
- Conditioning did not fix text rendering or small-object details; both modes
  share klein's baseline quirks.

## Multi-character

`MULTI_CHARACTER_CONDITIONING = LIMITED`. The implementation supports up to 4
explicit CharacterId -> reference bindings (chained `ReferenceLatent` nodes,
per-character mapping persisted), but this benchmark validated only one
conditioned character end to end. A real two-person scene test is still
outstanding; upstream does not quantify identity-swap risk. Do not rely on
multi-character conditioning without running that test.

## Verdicts

- Identity consistency with reference conditioning is meaningfully and
  measurably better than the text-only baseline (face 2.25 -> 4.50 on
  non-degenerate scenes) at no adherence cost in 3 of 4 scenes, with one
  documented composition-anchoring failure.
- `LORA_REQUIRED_NOW = NO` - reference conditioning meets the V1 goal. Revisit
  as Prompt #10.5 if composition-bleed proves unmanageable in production or
  multi-character scenes become a hard requirement.
- `READY_FOR_ADVANCED_IMAGE_CONTROL = YES`
