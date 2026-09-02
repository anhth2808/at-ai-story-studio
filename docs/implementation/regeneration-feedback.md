# Regeneration feedback

Prompt #11 turns a rejected candidate's structured review into deterministic regeneration guidance. No LLM call, no automatic loop.

## Flow

```text
Rejected candidate + scores/issues/notes + CURRENT Scene + CURRENT Visual Prompt Package
  -> deterministic guidance assembly (image-review-feedback-v1)
  -> new one-candidate set + normal GENERATE_SCENE_IMAGE job
  -> new candidate waits for user review
```

- Endpoint: existing `POST .../images/:generationId/regenerate` with `useReviewFeedback: true` plus `mode` (`SAME_SEED` or `NEW_SEED`).
- Preconditions: source generation is completed and `REJECTED` with at least one issue or non-empty note. Otherwise scheduling fails `409` - no set, no job.
- Same-seed feedback keeps the source's concrete seed; the new fingerprint differs because the request carries the feedback.

## Deterministic issue mapping

Fixed issue-enum order; the assembler reads only the CURRENT Scene and package:

| Issues                                                                       | Guidance produced                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `WRONG_FACE` / `WRONG_HAIR` / `WRONG_CLOTHING`                               | Keep approved reference identity: same face, hair, clothing as the reference image                                               |
| `WRONG_POSE` / `WRONG_COMPOSITION` / `WRONG_CAMERA` / `REFERENCE_POSE_BLEED` | Follow the Scene composition and camera exactly (framing, angle + subjectFocus). Do not copy the reference image framing or pose |
| `WRONG_LOCATION`                                                             | Set the Scene in the current location                                                                                            |
| `MISSING_OBJECT`                                                             | Show the required objects clearly: Scene important objects                                                                       |
| `EXTRA_OBJECT` / `DUPLICATE_OBJECT`                                          | Render only the named Scene objects; no extra or duplicated props                                                                |
| `BAD_HANDS`                                                                  | Natural, correct hands                                                                                                           |
| `BAD_TEXT`                                                                   | No readable text                                                                                                                 |
| `STYLE_DRIFT`                                                                | Match the established style; no drift                                                                                            |
| `OTHER` / notes                                                              | User notes appended verbatim                                                                                                     |

The assembled object `{ version, sourceGenerationId, sourceReview, guidance }` is persisted on the new generation's request snapshot AND the candidate-set metadata, and is part of the new candidate's fingerprint. The guidance string flows through the existing `generationInstructions` seam, which the ComfyUI mapper already appends to the positive prompt - no workflow template change.

## Isolation guarantees

- Reference bindings are re-resolved from the CURRENT package at regeneration time; stale source references never leak into the new request.
- Canonical Story, Scene, package, Character Visual Profile, location, object, and Style Bible records are never mutated by review or feedback. Verified by service tests comparing records before/after.
- Review state changes never retroactively alter the source candidate's fingerprint; only the copied structured feedback changes the new candidate's fingerprint.

## No automatic loops

The system never scores or regenerates automatically. After a feedback candidate completes, it waits for explicit user review - exactly one generation per explicit user action. If deterministic feedback proves insufficient for composition bleed in the benchmark, the escalation path is a future optional OMP refinement change, not a hidden LLM call here.
