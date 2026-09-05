## Context

See `proposal.md` for motivation. The repository is exactly at Prompt #14 baseline commit `3e3ea9283e6cb9b60e7575093064f42164d07720`. It already has one SQLite workflow queue, canonical Scene revisions, Visual Prompt Packages, explicit Character reference conditioning, bounded image candidate sets, manual image/video review, Wan 2.2 TI2V-5B generation, SceneTiming/MotionPlan/SceneClip rendering, ProductionProfile revisions, ProductionStage projections, and PublicationPackage output. Migration head is `0015_production_pipeline.sql`.

Current quality gaps are concrete:

- `packages/workflow/src/visual-prompts.ts` includes `StoryCharacterState.currentGoal`, `knowledge`, and raw `stableSerialize({camera, composition})` in diffusion prompts.
- current conditioning persists Character-to-reference data but lacks one durable ordered binding model covering exact appearance stages and Location references.
- `packages/workflow/src/index.ts` schedules production image batches with `candidateCount: 1` despite profile settings.
- video schemas and `comfyui-video.ts` assume one Wan workflow and one `4k + 1` frame contract.
- automatic image and temporal critics are absent; existing issue vocabularies and manual review persistence are reusable.
- Scene continuity is largely free text and video generation is Scene-level rather than Shot-level.

The local Story-Claw audit found concrete quality behavior in:

- `references/story-claw/runner/pipeline.ts`: hard/soft Scene split, bounded later-chapter identity lookup, appearance-stage restrictions, one-panel-one-event, dialogue carrier, turning-point isolation, filler rejection, internal-monologue mouth rules, static/dynamic prompt split, end-position continuity, conservative motion, strict continuation, and panel duration checks.
- `references/story-claw/tools/generate-character.ts`: neutral multi-view prototype sheets and prototype-conditioned stage sheets.
- `references/story-claw/tools/generate-scene.ts`: character-free hard-Location references.
- `references/story-claw/runner/render.ts`: exact stage tag matching, reference order placeholders, Shot-size-aware Location use, off-screen stripping, safety softening constraints, final-frame continuation, LTX `8k + 1` conversion, workflow FPS ownership, group-level residual allocation, bounded retries, decodable audio duration, and TTS anomalous-duration detection.
- `references/story-claw/scripts/comfy_person_face_gate_node.py`: base-frame extra-primary-person and fabricated-face gate before refinement.
- `references/story-claw/video_ltx2_3_i2v_PRESUB.json`: 25 FPS, 1280x720, duration-to-length expression, base latent decode, optional `PersonFaceGate`, latent upscale/refinement, and final video output topology.

The checked-in Story-Claw workflow names an LTX-2.3 22B development checkpoint, so its model strings cannot be copied into this product. The running local ComfyUI `0.33.1` currently reports `ltx-2-19b-distilled-fp8.safetensors`, `gemma_3_12B_it_fp4_mixed.safetensors`, native LTX image-to-video nodes, and no `PersonFaceGate`. The product adapter will reuse verified topology and parameter semantics while taking portable model identifiers from typed settings and validating the actual server. Fail-early custom-node gating stays optional; post-generation temporal QC is the portable required path.

## Goals / Non-Goals

**Goals:**

- Add Shot-level planning and media units without replacing Scene, ProductionStage, timeline, render, or publication ownership.
- Transfer proven Story-Claw quality constraints as typed, validated, fingerprinted behavior rather than prompt prose alone.
- Make exact managed references the quality default while preserving explicit low-cost text-only behavior.
- Add automatic, explainable, bounded image and video quality loops distinct from human approval.
- Preserve Wan and add one validated LTX-2 19B distilled backend with honest readiness and reproducibility.
- Keep every new operation durable, restart-safe, cancellation-aware, auditable, and scoped.
- Produce real local evidence where the configured providers are available and report every skipped or blocked gate honestly.

**Non-Goals:**

- Replacing `ProductionOrchestrator`, Scene Engine, timeline renderer, workflow queue, or current Asset ownership.
- Product-level ProductionStage proliferation for every Shot operation.
- Arbitrary ComfyUI graph upload, global ComfyUI modification, automatic model downloads, cloud marketplace support, or hidden backend fallback.
- Character memory, world bible, scene graph, precise 3D coordinates, generic director DSL, or a provider plugin framework.
- YouTube publishing, authentication, upload, scheduling, or `READY_FOR_YOUTUBE_PUBLISH = YES`.

## Decisions

### 1. Keep Scene as the narrative boundary and add Shot revisions below it

Add three normalized persistence concepts through additive migration `0016_perceptual_quality.sql`:

| Table | Purpose and key fields |
|---|---|
| `shot_plans` | Stable plan identity and immutable revisions per exact Scene revision: project/chapter/Scene IDs, revision, status, template/schema versions, fingerprint, provenance, bounded diagnostics, current flag, timestamps. |
| `narrative_beats` | Ordered source-grounded groups within one Shot-plan revision: stable ID, ordinal, source offsets or narrative-source descriptor, beat kind, meaning, importance, timing-group key. |
| `shots` | Ordered Shot revisions: stable ID, beat ID, ordinal, source lineage, importance flags, dialogue mode, visible/off-screen Character IDs, structured static/dynamic intent, camera, continuation decision/reason, initial/final continuity state, validation, fingerprint. |

Use existing UUID, ISO timestamp, current-revision, immutable-history, and Zod JSON conventions. Keep queryable ownership/order/status/fingerprint columns relational and bounded intent/continuity/diagnostics as validated JSON. Do not create a coordinate engine.

One `PLAN_SHOTS` workflow step consumes one current Scene revision and bounded continuity context. The OMP output is strictly validated, then deterministic validators enforce one beat, turning points, no filler, dialogue carrier, internal-monologue behavior, source coverage, Shot duration ceiling, and continuation eligibility before one short transaction promotes the plan revision. Invalid output never partially replaces the current plan.

### 2. Use deterministic validation after LLM direction

The director prompt transfers Story-Claw's narrow rules, but acceptance does not trust prose compliance. Validators produce typed bounded issues:

- `SHOT_OVERLOADED`
- `TURNING_POINT_NOT_ISOLATED`
- `SHOT_FILLER`
- `DIALOGUE_CARRIER_MISSING`
- `MONOLOGUE_LIP_MOVEMENT`
- `PROMPT_RESPONSIBILITY_MIXED`
- `SHOT_DURATION_EXCEEDED`
- `CONTINUITY_INVALID`
- `CONTINUATION_INELIGIBLE`

Obvious checks are deterministic: count structured event kinds, require exactly one primary beat, require a visual-carrier field for spoken dialogue, forbid speaking/lip instructions for non-spoken modes, require useful-information kinds, compare adjacent camera/motion values, and validate source ranges. Nuanced turning-point classification remains in structured OMP output plus a deterministic requirement that every marked turn owns its Shot. Do not add a second LLM just to re-judge the whole plan unless the existing agent output remains genuinely ambiguous.

### 3. Separate identity, appearance stage, and Shot state cleanly

Keep existing `CharacterVisualProfile` as stable identity. Replace the current lightweight variant meaning for production wardrobe with revisioned `character_appearance_stages` containing stable stage ID, Character/profile revision, clothing/accessory/equipment payload, explicit or inferred provenance, source Scene/chapter, confidence/reason, review status, fingerprint, and current flag.

Transient expression, pose, action, position, current injury visibility, held objects, lighting, and Location stay in Shot state. They never create a stage. Context inference can propose a stage only when bounded source evidence implies an actual wardrobe/equipment change. Inferred stages are never silently approved.

No compatibility alias is added. Existing visual variants remain readable for existing packages; code that creates new production wardrobe references migrates to appearance-stage identity. A one-time compatibility resolver may map an existing exact variant to a proposed stage only through explicit review, not implicit generation.

### 4. Reuse managed Assets for prototypes, stages, and Locations

Extend Asset roles/types for `CHARACTER_PROTOTYPE_REFERENCE`, `CHARACTER_STAGE_REFERENCE`, `LOCATION_REFERENCE`, `SHOT_CONTINUATION_FRAME`, and bounded critic sample evidence if existing general image roles cannot express ownership safely.

Add a compact `visual_reference_generations` table rather than three nearly identical generation tables. Its target kind is a closed enum, with target entity/revision, source prototype Asset/hash where required, prompt/workflow/provider/settings/seed, fingerprint, technical status, approval, Asset ID/hash, attempt, error, and timestamps. The service uses the existing image provider, managed staging/promotion, review, and stale-input checks.

Prototype prompt compilation follows the Story-Claw multi-view contract but derives medium/style from the current Style Bible. Stage generation always conditions on the exact approved prototype and changes only reviewed stage fields. Location generation uses only hard geometry and explicitly excludes Characters and transient state.

### 5. Make reference bindings first-class package data

Add a strict `ReferenceBinding` schema:

```ts
{
  ordinal: number;
  role: 'PRIMARY_CHARACTER' | 'CHARACTER' | 'LOCATION' | 'OBJECT';
  assetId: Id;
  entityId: string;
  stageId: string | null;
  sha256: string;
  revision: number;
  fingerprint: string;
}
```

Bindings live in the current Shot Visual Prompt Package payload and are snapshotted into each image generation. This is enough for persistence and fingerprints; a separate binding table adds no query value and is not introduced. Ordinals are assigned deterministically from Shot size and role priority, then entity stable ID. Provider reference input is compiled from these persisted ordinals only.

Strict QUALITY resolution blocks a missing exact primary Character stage reference. Explicit lower-cost fallback can produce `TEXT_ONLY` only when the profile allows it and must record `REFERENCE_FALLBACK_TEXT_ONLY`; it never claims the requested reference was consumed.

### 6. Compile visual-only prompts in fixed order

Bump the prompt template version. The compiler reads structured Shot intent and emits concise natural language in this exact order:

1. visible subject and one action/information beat;
2. exact Character reference placeholders and stage identity;
3. visible pose, expression, position, facing, and relationships;
4. important objects and holders;
5. hard Location reference placeholder and soft local state;
6. natural framing, angle, camera, and composition sentences;
7. lighting, time, weather, and atmosphere;
8. Style Bible look;
9. quality constraints;
10. deduplicated negative constraints.

Delete `currentGoal`, `knowledge`, role labels with no visible consequence, and raw object serialization from provider prompt text. They may remain in bounded planning context, never diffusion text. `stableSerialize` remains valid for fingerprints and structured agent context, not end-user diffusion prompts.

Visible and off-screen Characters are separate arrays. The compiler emits reference placeholders only for visible Characters. Gaze/dialogue toward an off-screen identity compiles to direction such as `someone off camera to camera-right` with no bare name.

Safety rewriting receives immutable binding metadata and placeholder tokens. Post-rewrite validation compares the exact ordered placeholder multiset and Shot purpose. Any deletion, insertion, duplication, or renumbering fails as `REFERENCE_BINDING_INVALID`; only the unsafe phrase can change.

### 7. Resolve physical continuity before prompt compilation

Each Shot stores structured initial/final state:

- Character ID, visibility, screen region, world-position description, facing, body orientation, pose, held-object IDs;
- important object ID, position, optional holder;
- optional camera axis;
- source Shot ID and state fingerprint.

`ShotContinuityResolver` starts from the previous accepted final state in narrative order, applies explicit current-Shot changes, and returns current initial state plus conflicts. This resolved state enters the Visual Prompt Package fingerprint and text. Human-readable positions remain acceptable. No exact coordinates, physics simulation, or scene graph.

The adjacent-Shot variation check is a warning unless the plan says `MATCHED` or `INTENTIONAL_REPEAT`. Production motion defaults to STATIC, slow PUSH_IN, or justified subtle PULL_OUT. Existing pan/orbit/handheld enum values remain but require explicit intent and bounded strength.

### 8. Treat continuation as a strict media contract

The deterministic eligibility function takes prior final state, current initial state, prior/current camera, identity set, face visibility/orientation, emotional-turn flag, Location identity, and leave/return markers. Same Scene alone is insufficient.

If eligible, schedule `EXTRACT_SHOT_CONTINUATION_FRAME` after the previous clip is accepted and current. Use centralized FFmpeg process helpers, extract the actual final decodable frame, validate it, hash it, and register it as a managed Asset. Persist source video Asset/hash, source Shot, frame timestamp/index, extractor version, and frame Asset/hash. The next video generation uses that Asset and skips image generation. Extraction or freshness failure blocks; no silent new keyframe.

### 9. Evolve image quality around existing candidate/review ownership

Extend the existing image issue taxonomy and review storage instead of replacing it. Add `image_critic_evaluations` keyed to immutable candidate Asset/hash and Shot/package/reference fingerprints. Persist critic provider/model/version, status, bounded score map, issue tags, confidence, explanation, guidance, timestamps, and input fingerprint.

`ImageCritic` is a provider boundary backed first by the existing OMP/AiAgent structured-output path. It sees only the candidate image, exact approved reference images, Shot visual intent, visible Character list, Location reference, object expectations, and bounded rubric. It does not mutate Story, Scene, profiles, or prompt packages.

Ranking uses a versioned deterministic function:

1. exclude hard failures and non-PASSED required evaluations;
2. compare weighted overall/identity/prompt/composition scores;
3. compare fewer severe issues;
4. use candidate index, then stable generation ID as final tie break.

Persist ranking version, ordered candidate IDs, scores, exclusions, winner, and reason in candidate-set metadata. No hidden best-image field.

Production candidate policy fixes the current hard-coded `candidateCount: 1`:

- FAST: 1;
- BALANCED: 2 only for high-importance, speaking close-up, hero, reveal, or identity-sensitive Shots, otherwise 1;
- QUALITY: 3 for high-importance identity-sensitive Shots, otherwise 2;
- hard cap remains 3 in production even though the user candidate API retains its existing cap of 4.

All-failed sets derive deterministic guidance from issue tags and schedule a new candidate set only while `imageRegenerationLimit`, `maxGeneratedImages`, stage attempts, and cancellation allow it.

### 10. Add backend adapters without a generic plugin system

Retain `VideoGenerationProvider` as the network/process boundary. Add a closed `VideoBackend` enum and resolver with two adapters:

- `Wan22Ti2v5bBackend`: move or wrap current graph mapping and readiness with no behavioral change.
- `Ltx2_19bDistilledBackend`: compile one approved graph descriptor based on the inspected local Story-Claw topology and actual local model/node inventory.

The resolver is one switch in infrastructure composition, not conditionals throughout business services. Production settings use `WAN22_TI2V_5B`, `LTX2_19B_DISTILLED`, plus an explicit allowed fallback enum. LOW_VRAM and BALANCED default to Wan. QUALITY defaults to LTX when ready. A readiness failure blocks unless the immutable profile snapshot explicitly allows audited Wan fallback.

Do not copy Story-Claw's 22B checkpoint string. Defaults target the locally reported `ltx-2-19b-distilled-fp8.safetensors` and `gemma_3_12B_it_fp4_mixed.safetensors`, but remain typed portable identifiers. Readiness verifies the selected server inventory.

### 11. Isolate LTX workflow topology and timing rules

The LTX adapter owns a versioned node descriptor, fixed link validation, and the mappings for input image, prompt, width, height, frame count, FPS, seed, sampler stages, checkpoint, text encoder, output, and optional base-stage hook. Domain code never sees IDs such as `320:300`.

Confirmed Story-Claw semantics use a temporal step of 8 and length `8k + 1`; the local adapter must validate the same rule against the actual 19B workflow before enabling READY. FPS is one field in the descriptor and drives:

- requested duration to legal frame count;
- graph compilation;
- result metadata;
- actual duration calculation;
- timeline allocation.

`nearestLegalFrames(duration, fps, step, min, max)` returns a bounded legal count and actual duration. For multiple Shots in one Narrative Beat/timing group, resolve legal parent frames once, allocate legal child counts, enforce minimums, and apply residual to the final eligible Shot. If a legal allocation cannot meet child minimums, planning must revise Shot count or timing rather than submit invalid geometry.

### 12. Add temporal QC after provider validation, with an optional early hook

Add `video_critic_evaluations` keyed to clip Asset/hash, keyframe Asset/hash, Shot/plan fingerprints, and critic version. The portable path extracts first, 25%, middle, 75%, and last frames when inexpensive, with first/middle/last mandatory. The structured critic extends the existing issue vocabulary with extra/missing primary person, fabricated face, clothing drift, and temporal instability.

Primary Character IDs and expected visibility come from the Shot package. Background extras are allowed unless they violate intent or become primary. Fabricated-face detection compares source face visibility/orientation with later frames and exact reference evidence.

State is `NOT_RUN | RUNNING | PASSED | REJECTED | UNAVAILABLE | DEGRADED_ACCEPTED | MANUAL_REVIEW_REQUIRED`. Infrastructure failure is `UNAVAILABLE`. Semantic rejection can regenerate with deterministic guidance only within `temporalRetryLimit`. Missing models, invalid graphs, stale sources, OOM, and critic outages follow technical/readiness policy.

The Story-Claw base-decode `PersonFaceGate` is useful but its custom node is absent locally. The LTX adapter may expose an optional early-gate hook if an approved local graph cleanly supports it later. Prompt #15 does not modify global ComfyUI or require that node. Full-output automatic temporal QC remains the required product behavior.

### 13. Keep automatic QC independent from human approval

Extend ProductionProfile settings with bounded typed fields:

```text
imageCandidatePolicy: FAST | BALANCED | QUALITY
imageQualityGate: DISABLED | REQUIRED
imageAutoAcceptThreshold: 1..5
imageRegenerationLimit: 0..3
videoBackendPreference: WAN22_TI2V_5B | LTX2_19B_DISTILLED
videoQualityGate: DISABLED | REQUIRED
temporalRetryLimit: 0..3
qualityFallback: BLOCK | MANUAL_REVIEW | ALLOW_DEGRADED_WITH_REVIEW
strictReferenceRequirement: boolean
allowedVideoFallback: NONE | WAN22_TI2V_5B
```

Automatic critics are REQUIRED by built-in MANUAL_REVIEW, BALANCED, and AUTO production profiles. MANUAL_REVIEW adds human gates. BALANCED auto-accepts clear passes and escalates uncertainty/exhaustion. AUTO auto-ranks/retries/accepts clear passes and intervenes only on hard blockers or exhaustion. `DISABLED` remains available only for explicit non-production/manual low-cost workflows, not built-in production quality profiles.

### 14. Integrate through existing ProductionStage adapters

Do not add Product stages. Existing adapters aggregate fine-grained work:

| Stage | Added internal units |
|---|---|
| `SCENES` | Shot-plan revisions and validation. |
| `VISUAL_PROFILES` | profile review, prototype, stage, and Location reference generation/approval. |
| `VISUAL_PROMPTS` | continuity resolution, visual-only Shot packages, exact bindings. |
| `SCENE_IMAGES` | bounded candidate sets, image critic, ranking, regeneration, keyframe acceptance. |
| `AI_MOTION` | backend resolution, continuation extraction, raw video generation, temporal critic, retry/acceptance. |
| `TIMELINE` | Shot timing allocation and accepted Shot-media composition. |

The orchestrator only inspects, schedules canonical service jobs, links stage work, and reconciles. It never calls critics, providers, ComfyUI, or FFmpeg. Stage summaries store counts and bounded samples. Restart reconciliation treats committed Asset/evaluation state as authority and avoids duplicate expensive work.

### 15. Use one scoped invalidation chain

Extend existing dependency fingerprints rather than add another invalidation engine:

```text
Scene revision
  -> Shot plan revision
  -> Shot continuity + Visual Prompt Package + bindings
  -> image candidates + critic/ranking + accepted keyframe
  -> raw video + temporal QC
  -> normalized SceneClip
  -> ChapterVideo -> ProjectVideo -> PublicationPackage

Character prototype
  -> dependent stage references
  -> bound Shot packages and descendants

Character stage reference or Location reference
  -> exact bound Shot packages and descendants
```

A backend setting changes raw video and descendants, not accepted keyframes. A timing-only change reuses raw accepted video. A Location reference change affects only bound Shots. Historical Assets and evaluations remain queryable. In-flight stale results may be preserved historically but never become current.

### 16. Resolve future Character identity through bounded existing Story context

Add a resolution operation only when a current chapter introduces an unresolved alias. It searches current blueprint aliases, plan-window context, chapter summaries, and then a capped number of future chapter plans or texts already present locally. Persist evidence references and confidence. It cannot create resources for future-only Characters. Ambiguity remains unresolved for review.

This adapts Story-Claw's on-demand later-chapter read without passing unbounded future prose into every request. One canonical Character ID continues to own TTS voice and visual reference lineage.

### 17. Centralize robust audio measurement and anomaly checks

Add a media helper that decodes audio through the existing safe process runner to measure actual playback duration where MP3 padding matters. Prefer machine-readable progress/probe output; use container duration only as an explicit fallback with provenance.

Add a generic TTS segment quality result using text length, decoded duration, optional silence ratio/audio activity, near-empty duration, and configured provider-aware bounds. Failure retries only that segment within current limits. Do not copy Story-Claw's fixed 1.2 characters/second threshold as a universal constant or silently switch voices unless existing provider policy explicitly allows and audits it.

### 18. Keep API and UI additions selective

Add only selective Shot plan/detail, reference-generation/review, critic-detail, and backend-readiness endpoints needed by existing Scene, Visual, Image, Video, and Production surfaces. Normal Production status remains bounded. Reuse existing cards/forms and Vietnamese UI copy. Do not add another application, client state library, or workflow designer.

### 19. Persistence and service file map

Expected ownership, adjusted only when an existing file stays legible:

```text
packages/shared/src/shot.ts
packages/shared/src/quality.ts
packages/shared/src/visual.ts
packages/shared/src/image.ts
packages/shared/src/video.ts
packages/shared/src/production.ts
packages/database/migrations/0016_perceptual_quality.sql
packages/database/src/shot.ts
packages/database/src/quality.ts
packages/database/src/schema.ts
packages/workflow/src/shot-director.ts
packages/workflow/src/shot-continuity.ts
packages/workflow/src/visual-prompts.ts
packages/workflow/src/visual-reference-generation.ts
packages/workflow/src/image-service.ts
packages/workflow/src/media-critics.ts
packages/workflow/src/video-service.ts
packages/workflow/src/video-backends.ts
packages/workflow/src/comfyui-video.ts
packages/workflow/src/ltx2-video.ts
packages/workflow/src/scene-timing.ts
packages/workflow/src/production-planning.ts
packages/workflow/src/production-orchestrator.ts
packages/media/src/* existing probe/process module
apps/api/src/index.ts
apps/worker/src/index.ts
apps/web/src/main.tsx
```

No new package is justified. Prefer extending current repositories/services and add a file only where mixing Shot, critic, or LTX mapping logic would make an existing file unsafe.

### 20. Story-Claw parity disposition

The required implementation document `docs/implementation/story-claw-quality-transfer.md` will carry this matrix with exact source paths, product locations, differences, reasons, and verification evidence. Initial audited disposition:

| ID | Disposition | Story-Claw source | Product adaptation |
|---|---|---|---|
| SC-001 | ADOPTED | `tools/generate-character.ts` | Managed approved multi-view prototype per Character profile. |
| SC-002 | ADOPTED | `tools/generate-character.ts` | Stage generation conditions on exact approved prototype. |
| SC-003 | ADOPTED | `runner/pipeline.ts` | Stage schema accepts clothing/accessory/equipment, not transient Shot state. |
| SC-004 | ADAPTED | `runner/pipeline.ts` | Bounded evidence-backed wardrobe inference with confidence and review. |
| SC-005 | ADOPTED | `runner/pipeline.ts`, `tools/generate-scene.ts` | Hard Location profile separate from soft Scene state. |
| SC-006 | ADOPTED | `tools/generate-scene.ts` | Managed character-free canonical Location reference. |
| SC-007 | ADAPTED | `runner/pipeline.ts` | One durable bounded Scene Shot-planning job, not transient per-agent files. |
| SC-008 | ADOPTED | `runner/pipeline.ts` | NarrativeBeat and Shot hierarchy. |
| SC-009 | ADOPTED | `runner/pipeline.ts` | Structured primary-beat validator. |
| SC-010 | ADOPTED | `runner/pipeline.ts` | Typed dialogue carrier. |
| SC-011 | ADOPTED | `runner/pipeline.ts` | Turning-point marker requires isolated Shot. |
| SC-012 | ADOPTED | `runner/pipeline.ts` | Useful-information enum rejects filler. |
| SC-013 | ADOPTED | `runner/pipeline.ts` | Dialogue mode forbids lip motion for internal voice. |
| SC-014 | ADOPTED | `runner/pipeline.ts` | Separate image/video intent and prompts. |
| SC-015 | ADAPTED | `runner/pipeline.ts` | Structured initial/final continuity replaces free-text-only end positions. |
| SC-016 | ADOPTED | `runner/pipeline.ts`, `runner/render.ts` | Exact stable stage identity, not filename tags. |
| SC-017 | ADOPTED | `runner/render.ts` | Missing exact reference blocks or audited text-only fallback. |
| SC-018 | ADAPTED | `runner/render.ts` | Ordinals are persisted and fingerprinted instead of transient LLM order. |
| SC-019 | ADOPTED | `runner/render.ts` | Location remains in close-up bindings. |
| SC-020 | ADOPTED | `runner/render.ts` | Deterministic close/medium/wide priority policy. |
| SC-021 | ADOPTED | `runner/render.ts` | Visible/off-screen split and compiler stripping. |
| SC-022 | ADOPTED | `runner/pipeline.ts` | Deterministic strict continuation eligibility. |
| SC-023 | ADOPTED | `runner/render.ts` | Managed prior final-frame continuation lineage. |
| SC-024 | ADAPTED | `runner/render.ts` | Candidate critic guidance and profile-bounded regeneration replace blind retry. |
| SC-025 | ADAPTED | `runner/render.ts` | Safety rewrite validates exact placeholder multiset and ordinals. |
| SC-026 | ADOPTED | `runner/render.ts`, LTX JSON | Backend validates confirmed `8k + 1` LTX lattice separately from Wan. |
| SC-027 | ADOPTED | `runner/render.ts`, LTX JSON | Backend descriptor owns FPS. |
| SC-028 | ADAPTED | `runner/render.ts` | Parent-level legal frames integrate with SceneTiming. |
| SC-029 | ADOPTED | `comfy_person_face_gate_node.py` | Temporal critic distinguishes primary people from extras. |
| SC-030 | ADOPTED | `comfy_person_face_gate_node.py` | Temporal critic detects unsupported fabricated faces. |
| SC-031 | ADAPTED | gate node and PRESUB workflow | Optional backend early hook; portable full-output QC required. |
| SC-032 | ADAPTED | `runner/render.ts` | Durable semantic attempts and profile limits, not generic blind retries. |
| SC-033 | ADAPTED | `runner/pipeline.ts` | Bounded plan/summary/look-ahead with provenance. |
| SC-034 | ADOPTED | `runner/render.ts` | Central decodable audio duration with explicit fallback. |
| SC-035 | ADAPTED | `runner/render.ts` | Provider-neutral multi-signal TTS anomaly check and bounded retry. |
| SC-036 | ADAPTED | `runner/pipeline.ts` append-group validator | Shot duration ceiling is validated from actual/planned timing, not a fixed language rate alone. |
| SC-037 | ADOPTED | `runner/pipeline.ts` motion rules | Static/push/subtle-pull grammar is the production default. |
| SC-038 | ALREADY_EQUIVALENT | `runner/pipeline.ts` completion guard | Existing durable workflow commit/recovery supersedes file polling. |

### 21. Verification strategy

Focused tests cover every named requirement with behavior-level assertions. Real verification uses the current local ComfyUI and existing models without downloads or global changes:

1. generate and approve one Character prototype and one derived stage reference;
2. generate/approve one character-free Location reference;
3. compile one controlled Shot with exact Character and Location bindings;
4. generate bounded FLUX candidates, run critic, persist rank, and accept winner;
5. generate Wan and LTX clips from the same accepted keyframe and conservative motion prompt;
6. sample frames, persist temporal verdicts, probe media, and record backend/workflow/model/resolution/frames/FPS/duration/seed/hash/generation time;
7. perform human perceptual comparison or explicitly state it was not executed;
8. run the combined real three-Chapter production, restart during work, resolve review, retry one failed unit, run again, verify no duplicate expensive work, and validate package/export.

Release commands: focused Vitest files, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, `pnpm format:check`, and `openspec validate perceptual-quality-director-pipeline --strict`. Run `/ponytail-review` before commit. A skipped real provider or perceptual gate is `NOT_RUN` or `BLOCKED`, never `PASS`.

## Risks / Trade-offs

- **Scope size:** Shot media multiplies durable units. Keep product stages unchanged, use bounded scheduling windows, and return aggregate counts/samples.
- **Migration complexity:** nullable Shot linkage on existing image/video rows must preserve old Scene-level records. Add columns/tables only, migrate no historical media, and resolve legacy Scene generation when no current Shot plan exists.
- **Reference quality dependency:** strict mode can block more often. This is intentional; explicit audited text-only fallback remains available outside strict QUALITY.
- **Critic nondeterminism:** model output can vary. Persist evaluator/version/evidence and make final ranking deterministic from stored results. Do not claim objective superiority without human comparison.
- **LTX resource pressure:** the local 19B FP8 checkpoint may be slow or OOM on RTX 3060 12GB. Readiness, one-at-a-time generation, long bounded timeout, cancellation, OOM classification, and explicit Wan fallback policy prevent false success or loops.
- **Workflow mismatch:** Story-Claw's checked-in graph targets 22B development while this machine exposes 19B distilled. Validate real node/model semantics and run a smoke before setting LTX READY; never change the global install to force parity.
- **Missing early gate node:** local ComfyUI lacks `PersonFaceGate`. Keep early QC optional and perform portable sampled-frame QC after generation.
- **Continuation coupling:** a continuation Shot cannot run before its predecessor is accepted. Persist the dependency and allow other independent Shots to proceed rather than serializing the full project.
- **Audio measurement cost:** decoding every segment adds process overhead. Use it where padding affects accumulation and cache measurement metadata by Asset hash.
- **Old Prompt #14 release gaps:** combined verification must cover restart/reuse/package behavior after this change. Do not close or archive either change based only on unit tests.