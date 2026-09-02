## Context

See `proposal.md` for motivation and `specs/` for observable behavior.

The verified local stack is ComfyUI 0.33.1 on `127.0.0.1:8188`, launched with `--lowvram`, PyTorch 2.13.0 + CUDA 13.0, an RTX 3060 12 GB, `flux-2-klein-base-4b-fp8.safetensors`, `qwen_3_4b.safetensors`, and `full_encoder_small_decoder.safetensors`. The application-approved native workflows are `text-to-image-v1` and `reference-character-v1`; the latter adds `LoadImage -> ImageScaleToTotalPixels -> VAEEncode -> ReferenceLatent` chains and produced the Prompt #10 identity improvement.

Actual local inspection found:

- `ControlNetLoader` and `ControlNetApplyAdvanced` are native nodes.
- `/models/controlnet` returns an empty list.
- `/models/loras` returns an empty list.
- The only relevant native preprocessor found is `Canny`; no OpenPose, DWPose, Depth Anything, or ControlNet Aux nodes are installed.
- Prompt #10 Scene 2 is the concrete failure: reference identity remained strong, but the reference framing displaced the target engine-room composition.
- `scene_image_generations` already stores immutable revisions, full scheduled request metadata, seeds, review status/notes, Assets, and current flags. `commitGenerated` currently auto-selects every fresh result.
- `ImageGenerationService` already creates persisted `GENERATE_SCENE_IMAGE` workflow steps and jobs, differentiates technical retry from creative regeneration, resolves explicit character-reference mappings, and fingerprints the full request.
- The React Scene image panel already supports the two generation modes, history, two-up comparison, basic accept/reject, manual override, and Scene camera/composition display.

## Goals / Non-Goals

**Goals:**

- Add the smallest durable candidate, review, acceptance, and feedback workflow that can mitigate Prompt #10's practical failure without weakening identity provenance.
- Keep all new GPU work explicit, bounded, independently retryable, and restart-safe.
- Make current-image promotion safe for multi-candidate review.
- Produce benchmark evidence strong enough to decide animated-story readiness honestly.

**Non-Goals:**

- No `SceneImageControlPlan`, control Asset, automatic pose/depth extraction, third ComfyUI workflow, ControlNet model, LoRA, custom node, machine vision scorer, OMP multimodal refinement, regional prompting, pose editor, or automatic regeneration loop in this change.
- No AI video, image-to-video, motion, timing, or render handoff.
- No replacement of `reference-character-v1` and no claim that candidate selection is deterministic pose control.

## Decisions

### D1. Advanced control technique is NONE for this stack

Research and local evidence select no advanced control provider path in this milestone.

| Technique | Problem solved | Klein 4B Base compatibility | Required nodes/models | VRAM/speed | Pose/composition quality | Identity interaction | Setup/maintenance | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Classic ControlNet with OpenPose/depth/edge | Spatial pose, depth, edges | No verified official FLUX.2 Klein checkpoint; SD1.5, SDXL, and FLUX.1 checkpoints are incompatible | Native loader/apply nodes exist, but a matching checkpoint and pose/depth preprocessors are absent | Additional model residency and preprocessing; not measurable without a compatible model | Potentially strong only with a model trained for the exact base | Usually additive, but untested with native reference latents | High because model provenance and preprocessing stack are missing | Reject now |
| OpenPose/DWPose | Human skeleton/pose | Preprocessor alone is not generation control; matching Klein control weights are absent | ControlNet Aux or equivalent custom nodes plus a compatible model | Extra detector pass and model memory | Strong keypoint signal when paired with a valid model | Character isolation remains uncertain | High; no nodes installed | Reject now |
| Depth ControlNet | Layout, scale, camera depth | No installed or official native Klein ControlNet model found | Depth estimator plus compatible control model | Extra detector/model load | Good coarse composition in supported families | Can preserve identity if weights are trained for it; unverified here | High | Reject now |
| Third-party RefControl FLUX.2 Klein 4B depth LoRA | Reference identity plus depth-defined structure | Model card targets the exact Base 4B family | Community LoRA, LoRA loader, depth preprocessing custom nodes, manual workflow/model install | LoRA is small, but depth preprocessing and 50-step Base generation add cost; no local measurement | Author claims useful depth composition; local value unproven | Designed to fuse identity and depth, but no local regression data | Medium-high: small community model, custom preprocessor, new LoRA lifecycle | Defer pending independent evidence |
| Native extra `ReferenceLatent` as composition reference | Broad image editing/composition hints | Native | Existing nodes only | More reference tokens; modest additional VRAM/time | Ambiguous, no spatial strength/start/end controls | Identity and composition references share one unlabeled conditioning mechanism and can worsen reference bleed | Low setup, high semantic risk | Reject |
| New seeds plus deterministic Scene feedback | Candidate diversity and prompt reinforcement | Fully compatible | Existing workflows only | No per-image overhead; total time scales linearly with explicit candidate count | Not exact pose control, but gives practical selection and prompt correction | Preserves the proven explicit reference mapping | Low | Select as Prompt #11 quality path, not as advanced control |

Primary sources: Black Forest Labs documents FLUX.2 Klein text-to-image and single/multi-reference editing, not Klein ControlNet; ComfyUI's official ControlNet guide requires a model compatible with its base family and notes that most preprocessors require custom nodes; the RefControl 4B model card identifies itself as a community LoRA requiring depth preprocessing.

Consequences:

- `ADVANCED_CONTROL_TECHNIQUE = NONE` is the planned decision unless implementation-time evidence materially changes compatibility before code work begins.
- `CONTROLNET_REQUIRED_NOW = NO` and `LORA_REQUIRED_NOW = NO` remain evidence-gated final verdicts, re-stated after the real benchmark.
- Do not add `REFERENCE_PLUS_CONTROL` to the accepted generation request enum. The UI may show it as disabled explanatory text, but the API must not accept a mode it cannot execute.
- Readiness gains `details.advancedControl = { status: 'NOT_ADOPTED', technique: null, reasonCode: 'NO_COMPATIBLE_CONTROL_MODEL', message }`. This is informational and never degrades text-only or reference-conditioned readiness.
- A future adopted technique requires a separate OpenSpec change adding `SceneImageControlPlan`, control Assets, fingerprints, invalidation, workflow mapping, and benchmarks. No placeholder domain model is created now.

Alternative rejected: installing the RefControl LoRA first and deciding later. It violates the evidence-first sequence and Prompt #10's LoRA deferral, and it would add a second composition mechanism before candidate/review behavior exists.

### D2. One lightweight candidate-set table groups existing generations

Migration `0012_image_candidates_quality.sql` adds:

`scene_image_candidate_sets`

- `id` primary key
- `project_id` foreign key
- `scene_stable_id`
- `scene_revision_id` foreign key
- `visual_prompt_package_id` nullable foreign key
- `mode`
- `workflow_template`
- `package_fingerprint`
- `settings_fingerprint`
- `requested_count`
- `source_generation_id` nullable foreign key for creative/feedback regeneration
- `generation_instructions`
- bounded `metadata` JSON for common reference/workflow/feedback provenance
- timestamps

`scene_image_generations`

- nullable `candidate_set_id` foreign key
- nullable `candidate_index`
- `review_scores` JSON default `{}`
- `review_issues` JSON default `[]`
- unique partial index on `(candidate_set_id, candidate_index)` when grouped

`image_generation_settings`

- `require_image_approval` integer boolean, default `0`

Existing generation rows keep null candidate membership and remain valid history. Manual image rows remain ungrouped because candidate sets describe provider generation requests, not manual overrides.

The complete scheduled request remains on every generation because retry/restart recovery needs it without joining a mutable aggregate. The candidate set stores shared provenance for grouping and comparison, not as the only execution snapshot. This small duplication is safer than normalizing the request into several tables.

Alternatives rejected:

- Store only a `candidateSetId` inside generation metadata: grouping, paging, uniqueness, and restart assertions would depend on JSON scans.
- Add separate quality review and regeneration feedback tables: the product needs one current review per immutable candidate, and existing review status/notes already live on the generation. JSON score/issue columns plus request metadata are sufficient.

### D3. Candidate scheduling is one transaction over existing jobs

`sceneImageGenerationScheduleSchema` gains `candidateCount` with default 1 and maximum 4. Selected-Scene and Chapter batch schemas gain the same field plus the existing effective conditioning mode/instruction inputs where needed.

Scheduling flow:

1. Validate every Scene and current package before writes.
2. Compute job count. Single-candidate batch behavior retains the existing 200-Scene explicit bound. Requests with `candidateCount > 1` are limited to 40 total GPU jobs. Reject the whole request before writes when the limit is exceeded.
3. Resolve all concrete seeds and provider prompt UUIDs before writes.
4. In one SQLite transaction create one execution, one candidate set per Scene, one generation/step/job per candidate, and links between them.
5. The current worker claims the existing `GENERATE_SCENE_IMAGE` steps one at a time. No queue or concurrency abstraction is added.

Seed rules:

- Candidate count 1 uses current `RANDOM` or `FIXED` behavior unchanged.
- A multi-candidate RANDOM set generates unique random concrete seeds with an in-memory collision check.
- A multi-candidate FIXED set uses the configured fixed seed for Candidate 1 and deterministic successive safe seeds for later candidates. This keeps the first result reproducible while avoiding duplicate work.
- Same-seed creative regeneration creates one candidate; a multi-candidate same-seed request is rejected because it would submit duplicate effective inputs while no advanced controls exist.
- Candidate set identifiers and candidate indexes are grouping metadata and SHALL NOT enter image fingerprints. Concrete seed, generation guidance, package/settings fingerprints, workflow/mapping version, and explicit reference mappings remain fingerprint inputs.

Alternative rejected: ask ComfyUI for several outputs from one graph. The current provider contract expects one image, recovery is keyed by one provider prompt UUID, and independent retry/cancellation would be lost.

### D4. Completion never displaces an existing current image

`commitGenerated` keeps its lease and freshness checks, always stores a validated Asset, and computes `autoSelect` as:

- inputs are fresh;
- candidate set requested count is 1;
- no current Scene image exists;
- `requireImageApproval` is false.

If any condition fails, the generation completes with a historical non-current Asset. In particular, new completion never displaces an accepted or unreviewed current image. Multi-candidate completion never auto-selects.

`acceptCandidate` is a new repository transaction that:

1. validates the generation is completed and its Asset is READY;
2. writes the complete structured review with status `ACCEPTED`;
3. clears current flags for the Scene generation and role Assets;
4. sets the target generation and Asset current;
5. returns the parsed current DTO.

The existing explicit Set Current operation remains for manual history management and does not silently mark a candidate accepted. Reject updates review state only. Rejecting a current image leaves it current but makes it fail the optional approval gate; no replacement can be guessed safely.

Alternative rejected: make every candidate non-current, including the first image in old projects. The conditional first-image behavior preserves the working default while making candidate review safe.

### D5. Structured review extends the existing review contract

`ImageQualityReview` is one strict object:

- `status`: `UNREVIEWED | ACCEPTED | REJECTED`
- `scores`: strict object with optional integer 1-5 values for the nine named categories
- `issues`: unique bounded array of the specified enum values
- `notes`: existing bounded text

Review JSON columns are parsed through shared Zod schemas on every repository read. Invalid persisted JSON is a data-corruption error, not silently replaced with empty review. The update endpoint can save draft/unreviewed or rejected review data; the accept endpoint owns the atomic accept/current transition.

No score weighting or automatic overall calculation is added. Human reviewers can set `OVERALL` directly; inventing a formula would imply an unsupported quality model.

### D6. Feedback guidance is deterministic and persisted as structured provenance

`sceneImageRegenerationSchema` gains `useReviewFeedback`, default `false`. When true, the source must be completed and `REJECTED` with at least one issue or non-empty note. `ImageGenerationService` reads the current Scene and package, then assembles guidance in fixed issue-enum order:

- identity issues reinforce approved reference identity and the package's canonical character appearance;
- pose/composition/camera/reference-bleed issues reinforce Scene camera, composition layers, character positions, pose, and action and explicitly tell the model not to copy the reference framing;
- location and object issues reinforce current Scene location and important objects;
- extra/duplicate object, hands, text, style, and artifact issues add bounded positive or negative constraints;
- `OTHER` contributes only the user's notes.

The assembler produces:

`{ sourceGenerationId, sourceReview: { scores, issues, notes }, guidance, version: 'image-review-feedback-v1' }`

This object is added to the provider-neutral generation request. `generationInstructions` receives the bounded guidance string, which the existing ComfyUI mapper already appends to the positive prompt. The full structured object is fingerprinted and persisted on the new generation and candidate set. The new request resolves reference bindings again from the current package, so stale source references cannot leak into the regenerated candidate.

No OMP call is added. If deterministic feedback fails the benchmark, the result is evidence for a later optional OMP refinement change, not a reason to hide an LLM call here.

### D7. Approval policy is derived readiness, not image input

`requireImageApproval` is persisted with image settings for product ownership but excluded from `imageSettingsFingerprint`. `updateSettings` compares output-affecting fingerprints before and after update and invalidates image steps only when that fingerprint changes.

`SceneImageGenerationDto` gains derived `productionReady` and bounded `productionBlockers`:

- generated image must be completed, current, and visually fresh;
- manual current image must be completed;
- when approval is required, current review must be `ACCEPTED`.

No current downstream image-to-video pipeline consumes this flag yet. It is the stable gate for the next milestone and must not be wired into current Story/TTS/render invalidation.

### D8. Staleness and identity guarantees reuse existing guards

No new control dependency exists. Therefore control-plan fingerprint and pose-control invalidation tests are explicitly not applicable to this decision and must not be faked.

Existing dependency behavior remains:

- Scene camera/composition/action edits create a new Scene revision and stale/rebuild its Visual Prompt Package; dependent generated images no longer match the current package.
- Character reference changes stale only packages and conditioned images that depend on that character profile.
- Story and TTS remain untouched by image review, candidate grouping, selection, and feedback.
- In-flight completion after package, reference, or output-affecting settings change is retained as history and never auto-selected.

Feedback changes the request and therefore fingerprint. Review scores, issues, and notes do not retroactively change the source candidate fingerprint; only the copied structured feedback changes the new candidate fingerprint.

### D9. API changes remain thin and metadata-first

- Existing `POST /api/projects/:projectId/scenes/:sceneId/images/generate` accepts `candidateCount` and returns candidate-set metadata plus `jobs[]`.
- Existing selected-Scene and Chapter batch routes accept `candidateCount`; they return candidate sets, jobs, and skipped Scene ids.
- Add bounded candidate-set listing under the Scene image resource; candidates remain the existing metadata DTOs with Asset URLs.
- Existing review route accepts structured review data but cannot atomically accept.
- Add `PUT .../images/:generationId/accept` for the atomic accepted-current transition.
- Existing regenerate route accepts `useReviewFeedback`; no duplicate feedback route is needed.
- Existing Set Current remains an explicit selection action distinct from quality acceptance.
- No control-plan or control-asset route exists while advanced control is not adopted.

Fastify routes only parse, call `ImageGenerationService`, and choose status codes. Binary images continue through Asset streaming.

### D10. UI uses native controls and the existing visual language

Keep the work inside the existing Scene workspace and stylesheet; do not add a component library.

- Generation controls: native mode select, candidate count choices 1/2/4, concise GPU-cost helper text, and one primary Generate action.
- Advanced control: visible disabled status with the readiness reason; no selectable fake mode.
- Scene intent: reuse current camera, composition, character visual state, location, and important-object fields. Do not create an editable duplicate control plan.
- Candidate grid: responsive one-column to multi-column CSS grid, fixed aspect ratio to avoid layout shift, lazy-loaded images, visible seed/mode/review text, and 44 px minimum action targets.
- Review form: visible labels, 1-5 native selects, issue checkboxes, notes, Save Review, Accept, Reject, and Regenerate with Feedback. Status is never communicated by color alone.
- Compare: extend the existing two-up selector to show review scores/issues and candidate-set provenance for text-only and reference-conditioned images.
- Loading, empty, unavailable, failure, and stale states remain explicit. Keyboard operation and image alt text are required.

### D11. Verification uses focused automated contracts and real pixels

Automated checks:

- shared schemas reject invalid candidate counts, scores, issues, feedback, and settings;
- migration/repository tests cover candidate grouping, unique indexes, structured review persistence after database reopen, accept/current atomicity, rejected history, approval readiness, and first-image/multi-candidate current policy;
- service tests cover four unique seeds/four jobs/one set, fixed-seed derivation, batch job guardrails, technical retry versus creative feedback regeneration, deterministic guidance ordering/content, fresh current reference resolution, feedback fingerprint changes, and no canonical mutation;
- existing stale in-flight reference/package test is retained and extended to candidate completion policy;
- ComfyUI mapper/provider tests prove both approved workflows remain unchanged and reference mappings remain explicit;
- API tests cover candidate listing, review, accept, feedback regeneration, and bounded errors;
- existing image generation, visual consistency, Story, Scene, TTS, workflow, and database suites run once after implementation;
- browser verification exercises the real Scene image surface at desktop and 375 px viewport.

Real benchmark:

- Reuse the Prompt #10 recurring Linh project and its five Scenes where possible, preserving the prior conditioned outputs and scores as baseline evidence.
- For every Scene, generate a bounded reference-conditioned candidate set with new seeds, review all candidates, reject documented failures, and generate feedback candidates where issues exist.
- Scene 2 engine room is mandatory and must use `WRONG_COMPOSITION` plus `REFERENCE_POSE_BLEED` feedback.
- Record generation IDs, Asset IDs, mode, workflow, seed, duration, identity, composition, pose/action, prompt adherence, location, style, overall, notes, and observed GPU memory where `nvidia-smi` can measure it.
- Compare the Prompt #10 reference-conditioned baseline against the selected Prompt #11 candidate and feedback result. Candidate selection success means practical best-image quality improves; it is not reported as ControlNet or deterministic control.
- Test one two-character Scene if practical. Identity swaps or conditioning conflicts remain documented limitations and are not hidden.
- Final verdicts derive from the evidence. `READY_FOR_ANIMATED_STORY = YES` requires reliable selection and a practical mitigation for the failure case without meaningful identity regression.

## Risks / Trade-offs

- [More candidates increase GPU time linearly] -> Default to one, expose only 1/2/4, enforce total-job bounds, keep concurrency one, and show explicit cost text.
- [Prompt feedback may not overcome strong reference composition bleed] -> Benchmark the known failure, keep multiple seeds, report failure honestly, and leave readiness NO if practical mitigation is insufficient.
- [Fixed-seed successor derivation may surprise users] -> Display and persist every concrete seed; Candidate 1 remains exactly the configured fixed seed.
- [Review JSON columns allow malformed historical data from manual SQL edits] -> Strictly parse every row and surface data corruption instead of defaulting silently.
- [Accept and current selection can race] -> One SQLite transaction owns review and both current-pointer updates.
- [Rejecting a current image leaves a rejected current pointer] -> Approval readiness blocks it when enabled; automatic replacement would be a more dangerous guess.
- [No advanced control means exact pose remains probabilistic] -> State this limitation, do not expose fake controls, and use the benchmark to decide whether a later dedicated control milestone is justified.
- [Multi-character identity remains limited] -> Preserve explicit mappings and include an observation if practical; do not block the single-character milestone or claim isolation.

## Migration Plan

1. Add migration 0012 and update Drizzle schema definitions. Existing settings receive `require_image_approval = 0`; existing generations remain valid with null candidate membership and empty structured review fields.
2. Deploy shared contracts, repositories, and service changes together. New candidate scheduling starts only after the migration is applied by normal startup.
3. Update API and UI consumers in the same clean cutover; no compatibility alias or second route convention is retained.
4. Run focused tests and real browser verification before generating benchmark candidates.
5. Run the real five-Scene benchmark, update requested implementation documents and durable AGENTS.md rules, run ponytail review, then perform final regressions.

Rollback: disabling approval returns old readiness behavior. Older code ignores the added table and columns and can continue reading legacy generation fields, but candidate-set-only UI features disappear. SQLite migration data is retained rather than destructively dropped; generated Assets and history remain valid.
