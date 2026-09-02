# Control benchmark (Prompt #11)

Real ComfyUI benchmark executed 2026-09-02 against the tested stack
(ComfyUI 0.33.1, `flux-2-klein-base-4b-fp8`, `qwen_3_4b`,
`full_encoder_small_decoder`, RTX 3060 12 GB, localhost:8188). No advanced
control technique was installed or used; this benchmark evaluates the adopted
Prompt #11 path: bounded candidate generation + structured review + deterministic
feedback regeneration.

## Setup (exact steps)

1. Project `649a6dfa-8f9e-4d43-824d-bdceb9d50b0e` ("Reference Conditioning
   Benchmark") reused from Prompt #10 with its five CURRENT Scenes, approved
   Linh profile, and approved primary reference `75a4e71c-...` (profile v2,
   package fingerprints unchanged). Prompt #10 baselines remain as persisted
   revisions (revisions 1-3 region per Scene).
2. API/worker restarted on the Prompt #11 build (migration 0012 applied on
   startup). Readiness returned READY with
   `details.advancedControl = { status: NOT_ADOPTED, reasonCode:
NO_COMPATIBLE_CONTROL_MODEL }`; `/models/controlnet` and `/models/loras`
   both return `[]`.
3. Per Scene: `POST .../images/generate` with
   `{"conditioningMode":"REFERENCE_CONDITIONED","candidateCount":2}` - 10
   persisted jobs through the normal `GENERATE_SCENE_IMAGE` queue, concurrency 1.
4. Reviews persisted through the real review/accept routes; Scene 2 candidate 1
   rejected with `WRONG_COMPOSITION` + `WRONG_LOCATION` +
   `REFERENCE_POSE_BLEED`, then regenerated with
   `{"mode":"NEW_SEED","useReviewFeedback":true}`.

## Seed strategy evidence

Every set used FIXED mode seed `1010101`: Candidate 1 always got exactly
`1010101`; Candidate 2 always got the deterministic successor `1010102`; the
feedback candidate resolved a fresh random seed `964255556`. All seeds are
persisted per generation.

## Persistence evidence (restart-safe)

- The worker was restarted mid-batch; the RUNNING candidate resumed its
  provider prompt instead of resubmitting (one candidate completed via history
  download in 1.3 s).
- API was restarted after reviews; scores, issue tags, notes, candidate-set
  links, and accepted current pointers were re-read intact.
- One scheduler defect found and fixed during the run (`linkCandidate` call
  dropped during refactor): candidate-set columns were backfilled from the
  persisted request metadata - the same values the scheduler had already
  persisted there. All later schedules linked directly (verified on the
  feedback candidate).

## Per-Scene results (Prompt #11 candidates; scores 1-5)

| Scene                        | Candidate | Seed      | Identity | Composition | Pose/Action | Location | Overall | Verdict                                                            |
| ---------------------------- | --------- | --------- | -------- | ----------- | ----------- | -------- | ------- | ------------------------------------------------------------------ |
| 1 lamp platform (close)      | c1        | 1010101   | 5        | 4           | -           | 5        | 5       | ACCEPTED (current)                                                 |
| 1                            | c2        | 1010102   | 4        | 3           | -           | -        | 3       | REJECTED (DUPLICATE_OBJECT, BAD_HANDS)                             |
| 2 engine room (failure case) | c1        | 1010101   | 5        | 1           | 2           | 1        | 2       | REJECTED (WRONG_COMPOSITION, WRONG_LOCATION, REFERENCE_POSE_BLEED) |
| 2                            | c2        | 1010102   | 5        | 4           | 4           | 3        | 4       | ACCEPTED (later runner-up)                                         |
| 2                            | feedback  | 964255556 | 5        | 4           | 5           | 4        | 5       | ACCEPTED (current)                                                 |
| 3 storm cliff (wide/action)  | c1        | 1010101   | 5        | 5           | 5           | 5        | 5       | ACCEPTED (current)                                                 |
| 3                            | c2        | 1010102   | 4        | 4           | 5           | -        | 4       | REJECTED (WRONG_HAIR - loose instead of tied)                      |
| 4 chart table (objects)      | c1        | 1010101   | 5        | 4           | -           | 5        | 5       | ACCEPTED (current)                                                 |
| 4                            | c2        | 1010102   | 4        | 4           | -           | 4        | 4       | REJECTED (younger face)                                            |
| 5 tower top (composition)    | c1        | 1010101   | 5        | 4           | -           | 4        | -       | REJECTED implicitly (ARTIFACTS: floating watch quirk)              |
| 5                            | c2        | 1010102   | 4        | 4           | -           | 4        | 4       | ACCEPTED (current)                                                 |

Prompt #10 baseline comparison (from `conditioning-benchmark.md`): conditioned
identity 4.5/5 on non-degenerate scenes; Scene 2 adherence 2/5 with full
reference re-anchoring.

## What improved

- **Scene 2 (the targeted failure)**: baseline conditioned output at seed
  1010101 reproduced the failure exactly (composition 1/5: lamp
  platform/railing/boat instead of the engine room). The SAME SET's second
  seed escaped the bleed (composition 4/5: Linh operating a pressure-gauge
  device at night). The feedback candidate (after rejecting c1 with
  `REFERENCE_POSE_BLEED`) produced the best frame: hand on the switch lever
  plus the pressure-gauge panel inside a tight machine-room space, storm
  outside, composition 4/5, pose/action 5/5. Practical mitigation proven:
  2/5 -> 4-5/5 prompt adherence on the exact failure case.
- **Selection value elsewhere**: Scene 1 rejected a duplicate-prop/bad-hands
  defect; Scene 3 rejected a wrong-hair drift; Scene 4 rejected a younger-face
  drift; Scene 5 avoided the floating-watch artifact present in its c1 and in
  the Prompt #10 baseline.
- **Identity**: every candidate kept Linh recognizable (accepted set identity
  avg 4.8/5 vs Prompt #10's 4.5/5 on non-degenerate scenes). No identity
  regression.

## What did not improve / limits

- Seed c1 of every scene reproduces the fixed-seed behavior of #10 - including
  the Scene 2 bleed. The mitigation is generating multiple seeds, not a fix of
  any specific seed.
- Feedback guidance is prompt reinforcement; it worked here but is not
  guaranteed against stronger bleed cases (no deterministic control exists -
  `ADVANCED_CONTROL_TECHNIQUE = NONE`).
- Scene 5 c1 retained the floating-watch quirk from the baseline family.
- Scene 2 location scored 3-4/5: a machine shed/room is present, but it is not
  a literal old generator room inside a lighthouse.

## Multi-character

`MULTI_CHARACTER_CONDITIONING = LIMITED` - unchanged. The benchmark project has
one recurring character; a two-character scene was not run this milestone
(requires a new OMP-generated 2-character project and was out of the recorded
benchmark scope). Candidate/feedback workflows do not change identity-swap
risk; explicit CharacterId -> ReferenceAsset mappings remain persisted on every
conditioned generation.

## GPU / performance

- VRAM: ~11.3 GB / 12.3 GB observed at 100% utilization during conditioned
  generation (reference latents + `--lowvram` build).
- Duration: ~110-150 s per conditioned candidate at 1024x576/20 steps
  (concurrency 1). One candidate completed in 1.3 s via restart history
  recovery; the feedback candidate took 44 s (provider-side prompt dedup).
- Stability: 11/11 requested candidates completed; zero OOM; one mid-run
  worker restart recovered cleanly.

## Verdicts

- `ADVANCED_CONTROL_TECHNIQUE = NONE` - candidate selection plus deterministic
  feedback mitigated the targeted failure without any control model. The
  evaluated techniques (classic ControlNet, pose/depth preprocessors, RefControl
  LoRA) remain rejected/deferred for this stack.
- `CONTROLNET_REQUIRED_NOW = NO` - no compatible FLUX.2 Klein control model
  exists locally or officially; the failure case is practically mitigated
  without one.
- `LORA_REQUIRED_NOW = NO` - unchanged from Prompt #10; identity remained
  stable, so training is still unjustified.
- `READY_FOR_ANIMATED_STORY = YES` - Scene images generate reliably through
  real persisted jobs; recurring-character identity is stable (4.8/5 accepted
  average); users can create, review, compare, and select better candidates;
  the known composition-bleed failure has a practical two-lever mitigation
  (extra seeds + feedback regeneration); accepted current images are explicit
  and restart-safe.

This does NOT mean AI video is implemented. The next milestone may consume
accepted current Scene images.
