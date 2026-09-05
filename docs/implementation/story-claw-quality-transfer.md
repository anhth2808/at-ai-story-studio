# Story-Claw Quality Transfer

This record maps the inspected Story-Claw quality behaviors to the local AI Story Studio implementation. Story-Claw is reference material only; no runtime code imports its path.

| ID     | Disposition | Story-Claw behavior                          | Product implementation                                                                 | Adaptation and reason                                                                      | Verification                |
| ------ | ----------- | -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| SC-001 | ADOPTED     | Shot-level planning precedes generation      | `packages/workflow/src/shot-director.ts`                                               | Bounded to current Chapter and deterministic Shot IDs                                      | Shot Director tests         |
| SC-002 | ADOPTED     | Separate planning from visual prompting      | `packages/workflow/src/visual-prompt-compiler.ts`                                      | Visual prompt compiler receives only canonical visual inputs                               | Compiler tests              |
| SC-003 | ADOPTED     | Character identity is canonical              | `packages/database/src/visual.ts`, `packages/workflow/src/visual-reference-service.ts` | Stable Character IDs and profile revisions are required                                    | Visual reference tests      |
| SC-004 | ADOPTED     | Location identity is canonical               | `packages/workflow/src/visual-prompt-compiler.ts`                                      | Location prompts exclude transient state and Characters                                    | Compiler tests              |
| SC-005 | ADOPTED     | Reference images are explicit inputs         | `packages/shared/src/visual.ts`, `packages/workflow/src/image-service.ts`              | Asset ID, hash, path, and profile revision are persisted                                   | Image service tests         |
| SC-006 | ADOPTED     | Prototype before derived appearance          | `packages/workflow/src/visual-reference-service.ts`                                    | Stage generation requires an approved exact prototype                                      | Visual reference tests      |
| SC-007 | ADOPTED     | Appearance stages exclude transient state    | `packages/workflow/src/visual-reference-prompts.ts`                                    | Weather, lighting, pose, and expression remain Shot inputs                                 | Prompt compiler tests       |
| SC-008 | ADOPTED     | No fuzzy reference substitution              | `packages/database/src/visual-reference.ts`                                            | Approval and hash checks fail closed                                                       | Repository tests            |
| SC-009 | ADOPTED     | Exact current references only                | `packages/database/src/repositories.ts`                                                | Current render queries require status, hash, and freshness                                 | Image and video tests       |
| SC-010 | ADOPTED     | Manual review is explicit                    | `packages/shared/src/quality.ts`, `packages/web/src/main.tsx`                          | Human approval remains separate from automatic critic status                               | API and UI checks           |
| SC-011 | ADOPTED     | Automatic quality review is non-mutating     | `packages/workflow/src/media-critics.ts`                                               | Critics persist evaluations and never edit canonical profiles                              | Critic tests                |
| SC-012 | ADOPTED     | Quality failures carry issue tags            | `packages/shared/src/quality.ts`                                                       | Strict Zod schemas preserve bounded issue vocabularies                                     | Shared tests                |
| SC-013 | ADOPTED     | Candidate generation is bounded              | `packages/workflow/src/quality-policy.ts`                                              | Candidate count depends on profile and Shot importance                                     | Policy tests                |
| SC-014 | ADOPTED     | Candidate ranking is deterministic           | `packages/workflow/src/media-critics.ts`                                               | Weighted scores use stable tie breakers and exclude non-passes                             | Ranking tests               |
| SC-015 | ADOPTED     | Candidate ranking is immutable               | `packages/database/src/image.ts`                                                       | A persisted ranking cannot be replaced by a different ranking                              | Repository implementation   |
| SC-016 | ADOPTED     | Quality uncertainty does not become PASS     | `packages/workflow/src/quality-policy.ts`                                              | UNAVAILABLE maps to block or review, never acceptance                                      | Policy tests                |
| SC-017 | ADOPTED     | Visual prompts are visual-only               | `packages/workflow/src/visual-prompt-compiler.ts`                                      | Story context is compiled upstream and not serialized into prompts                         | Compiler tests              |
| SC-018 | ADOPTED     | Off-screen Characters are stripped           | `packages/workflow/src/visual-prompt-compiler.ts`                                      | Binding and prompt output use only visible Shot participants                               | Compiler tests              |
| SC-019 | ADOPTED     | Safety rewriting preserves required identity | `packages/workflow/src/visual-prompt-compiler.ts`                                      | Safety substitutions retain binding and identity constraints                               | Compiler tests              |
| SC-020 | ADOPTED     | Continuation uses exact prior state          | `packages/workflow/src/shot-continuity.ts`                                             | Prior final frame hash and source identity are mandatory                                   | Continuity tests            |
| SC-021 | ADOPTED     | Invalid continuation is rejected             | `packages/workflow/src/shot-continuity.ts`                                             | Missing, stale, rejected, or mismatched frames fail closed                                 | Continuity tests            |
| SC-022 | ADOPTED     | Motion describes change, not static identity | `packages/workflow/src/ai-motion-plan.ts`                                              | Motion prompts reuse accepted keyframe context                                             | Motion tests                |
| SC-023 | ADOPTED     | Static intent stays static                   | `packages/workflow/src/ai-motion-plan.ts`                                              | Default motion is conservative and explicit novelty is preserved                           | Motion tests                |
| SC-024 | ADOPTED     | Video temporal QC is structured              | `packages/workflow/src/media-critics.ts`                                               | Clip, keyframe, Shot fingerprint, verdict, and guidance are persisted                      | Critic implementation       |
| SC-025 | ADOPTED     | Primary people differ from background extras | `packages/workflow/src/media-critics.ts`                                               | Critic prompt names primary-person semantics explicitly                                    | Critic contract             |
| SC-026 | ADOPTED     | Fabricated faces are rejected                | `packages/workflow/src/media-critics.ts`                                               | Back-facing or occluded sources cannot gain unjustified frontal faces                      | Critic contract             |
| SC-027 | ADOPTED     | Critic infrastructure errors are explicit    | `packages/workflow/src/media-critics.ts`                                               | Malformed/provider errors persist UNAVAILABLE                                              | Critic implementation       |
| SC-028 | ADOPTED     | Video final frames are managed evidence      | `packages/media/src/index.ts`, `packages/workflow/src/video-service.ts`                | Final frame is extracted to managed storage and hash-registered                            | Typecheck and media helpers |
| SC-029 | ADAPTED     | Backend choice is isolated                   | `packages/workflow/src/video-backends.ts`                                              | Wan and LTX use application-owned adapters without global ComfyUI edits                    | Backend tests               |
| SC-030 | ADAPTED     | LTX topology is explicit                     | `packages/workflow/src/comfyui-video.ts`                                               | Existing local 12-node graph is used; no download or global modification                   | Live readiness smoke        |
| SC-031 | ADOPTED     | Backend settings fingerprint outputs         | `packages/database/src/video.ts`, `packages/workflow/src/video-service.ts`             | Model, encoder, VAE, FPS, and mapping version affect reuse                                 | Video tests                 |
| SC-032 | ADOPTED     | TTS duration is decoded, not guessed         | `packages/media/src/index.ts`, `packages/workflow/src/tts-quality.ts`                  | ffprobe duration is authoritative with explicit fallback provenance                        | TTS quality tests           |
| SC-033 | ADOPTED     | TTS anomalies are quality failures           | `packages/workflow/src/tts-quality.ts`                                                 | Silence, activity, ratio, and duration bounds are checked                                  | TTS quality tests           |
| SC-034 | ADOPTED     | TTS retry stays at segment scope             | `apps/worker/src/index.ts`                                                             | Existing completed siblings remain reusable                                                | Worker implementation       |
| SC-035 | ADOPTED     | Dependency invalidation is selective         | `packages/database/src/repositories.ts`, `packages/database/src/visual-reference.ts`   | Reference changes invalidate bound descendants, not Story or TTS                           | Repository tests            |
| SC-036 | ADAPTED     | Production is bounded and durable            | `packages/workflow/src/production-orchestrator.ts`                                     | Existing ProductionStage state machine remains the coordinator boundary                    | Production tests            |
| SC-037 | ADOPTED     | Managed exports are immutable and safe       | `packages/workflow/src/publication-package.ts`                                         | Relative paths, staging, checksums, and manifests protect exports                          | Publication tests           |
| SC-038 | ADAPTED     | Publishing remains gated                     | `packages/workflow/src/production-orchestrator.ts`                                     | YouTube publishing is intentionally out of scope until credentials and consent are defined | Readiness policy            |

## Source files inspected

- `references/` Story-Claw research material and extracted notes.
- `packages/shared/src/shot.ts`
- `packages/shared/src/visual.ts`
- `packages/shared/src/quality.ts`
- `packages/shared/src/image.ts`
- `packages/shared/src/video.ts`
- `packages/workflow/src/shot-director.ts`
- `packages/workflow/src/visual-prompt-compiler.ts`
- `packages/workflow/src/visual-reference-service.ts`
- `packages/workflow/src/shot-continuity.ts`
- `packages/workflow/src/media-critics.ts`
- `packages/workflow/src/video-backends.ts`
- `packages/workflow/src/video-service.ts`
- `packages/workflow/src/tts-quality.ts`
- `packages/database/src/image.ts`
- `packages/database/src/video.ts`
- `packages/database/src/visual-reference.ts`
- `packages/media/src/index.ts`
- `apps/worker/src/index.ts`

## Boundary

Story-Claw behavior is adapted to the local modular monolith, SQLite source of truth, managed filesystem, OMP agent boundary, and existing ProductionStage model. The implementation does not add a Story-Claw runtime dependency, generic plugin system, distributed broker, or YouTube integration.
