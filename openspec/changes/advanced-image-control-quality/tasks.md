## 1. Contracts and persistence

- [x] 1.1 Extend shared image schemas with candidate counts/sets, strict 1-5 quality scores, issue tags, structured regeneration feedback, `requireImageApproval`, production-readiness fields, and informational advanced-control availability; verify `packages/shared/src/image.test.ts` covers valid defaults and every invalid boundary.
- [x] 1.2 Add migration `0012_image_candidates_quality.sql`, register it in normal database startup, and update Drizzle schema definitions for candidate sets, generation links/review JSON, and approval policy; verify a fresh database and an existing Prompt #10 database both migrate successfully.
- [x] 1.3 Add candidate-set repository create/get/list behavior and strict generation parsing for candidate membership and review JSON; verify repository tests preserve legacy null membership and enforce unique candidate indexes.
- [x] 1.4 Add atomic accept/current behavior, structured review updates, and derived production readiness without deleting history; verify database tests cover Candidate 3 acceptance, rejection, approval gating, and API/database reopen persistence.
- [x] 1.5 Exclude `requireImageApproval`, candidate-set IDs, candidate indexes, and review state from output fingerprints while keeping seed, guidance, workflow, package, settings, and explicit references; verify deterministic fingerprint tests pass and feedback changes only the new candidate fingerprint.

## 2. Candidate scheduling and execution

- [x] 2.1 Implement bounded unique seed resolution for 1-4 candidates, including deterministic successors after a fixed seed; verify unit tests produce four distinct persisted seeds and preserve the configured fixed seed for Candidate 1.
- [x] 2.2 Refactor one-Scene scheduling to create one candidate set and its existing `GENERATE_SCENE_IMAGE` generations/steps/jobs transactionally; verify four candidates share one set, create four jobs, and retain independent provider prompt IDs.
- [x] 2.3 Extend selected-Scene and Chapter batches with candidate counts, retain the existing single-candidate bound, enforce the 40-job multi-candidate guardrail before writes, and keep concurrency one; verify excessive batches leave no partial execution, set, step, or job rows.
- [x] 2.4 Change generated-image publication so multi-candidate results and any result beside an existing current image remain non-current, while one fresh first image may retain default-off approval behavior; verify repository/service tests cover empty Scene, accepted current, unreviewed current, stale input, and lost-lease completion.
- [x] 2.5 Preserve technical retry as another attempt of the same candidate and make creative regeneration a new one-candidate set; verify retry retains seed/fingerprint/reference mapping while same-seed and new-seed regeneration preserve the source Asset as history.

## 3. Review and feedback regeneration

- [x] 3.1 Implement deterministic `image-review-feedback-v1` guidance assembly from current Scene camera/composition, character pose/action, location, important objects, structured issues, and notes; verify tests assert stable issue ordering and exact reinforcement for `WRONG_COMPOSITION`, `MISSING_OBJECT`, and `REFERENCE_POSE_BLEED`.
- [x] 3.2 Add structured feedback provenance to the provider-neutral request and map only its bounded guidance through the existing generation-instructions prompt seam; verify the ComfyUI graph tests show no node/template changes and request snapshots retain the structured source review.
- [x] 3.3 Regenerate feedback candidates from the current Visual Prompt Package and freshly resolved explicit character-reference bindings without mutating canonical data; verify service tests compare Story, Scene, package, profile, location, and object records before/after and confirm current reference hashes/profile revisions in the new request.
- [x] 3.4 Reject feedback regeneration without a completed rejected source review containing an issue or note and never schedule automatic follow-up work; verify invalid requests create no candidate set/job and completed feedback candidates stop for user review.

## 4. Readiness and API

- [x] 4.1 Report `advancedControl.status = NOT_ADOPTED` with the evidence-based unavailable reason while leaving TEXT_ONLY and REFERENCE_CONDITIONED readiness unchanged; verify provider/service tests pass with empty ControlNet/LoRA model lists and both approved workflows remain executable.
- [x] 4.2 Extend the existing generate and batch routes to accept candidate counts and return candidate sets plus jobs, and add bounded candidate-set listing; verify API tests cover one/four candidates, pagination, skipped Scenes, and total-job errors.
- [x] 4.3 Extend review metadata routes, add atomic candidate acceptance, and extend regeneration with `useReviewFeedback`; verify Fastify tests cover save/reload, accept/current flags, reject/history, same/new seed feedback, validation errors, and metadata-only responses.
- [x] 4.4 Keep Set Current, manual upload, retry, cancellation, and reference promotion behavior distinct and working; verify their existing API/service tests pass without compatibility aliases or a second queue.

## 5. Scene image UI

- [x] 5.1 Update the typed web API client and Scene workspace state for candidate-set responses, structured reviews, approval readiness, and job arrays; verify the web package typecheck passes with no unsafe assertions added.
- [x] 5.2 Add native 1/2/4 candidate controls, effective generation mode, explicit GPU-cost helper text, and a disabled advanced-control status with its reason; verify TEXT_ONLY and REFERENCE_CONDITIONED remain selectable and no fake control mode can be submitted.
- [x] 5.3 Replace the revision-button-only presentation with a responsive candidate grid showing image, set/index, seed, mode, generation/freshness/review state, and current marker; verify images use stable aspect ratio, lazy loading, meaningful Vietnamese alt text, and no horizontal scrolling at 375 px.
- [x] 5.4 Add visible-label quality score fields, issue checkboxes, notes, Save, Accept, Reject, and Regenerate with Feedback actions using the existing visual language; verify keyboard navigation, disabled/loading/error states, and non-color status text in Chromium.
- [x] 5.5 Extend the existing two-up comparison with candidate-set provenance, reference mappings, scores, issues, and notes while reusing persisted Scene intent; verify text-only and reference-conditioned completed candidates compare without loading binary image data into JSON.
- [x] 5.6 Show current Scene camera, composition layers/character positions, pose/action, location, and important objects beside review without introducing a duplicate control-plan editor; verify displayed values match the selected persisted Scene revision.

## 6. Focused automated verification

- [x] 6.1 Run `pnpm test -- packages/shared/src/image.test.ts packages/database/src/image.test.ts packages/workflow/src/image-service.test.ts packages/workflow/src/comfyui.test.ts` and fix every candidate, review, feedback, acceptance, fingerprint, stale-result, text-only, and reference-conditioned contract failure.
- [x] 6.2 Add or extend API route tests for candidate listing/generation/review/accept/feedback and run the specific API test file to verify thin route behavior and restart-safe metadata.
- [x] 6.3 Reopen a migrated temporary SQLite database after writing one four-candidate set and structured review, then verify all seeds, Assets, set links, issues, notes, accepted current pointer, and approval readiness survive process restart.
- [x] 6.4 Run the actual app and browser-drive one Scene through generate candidates, reject with issues, feedback regenerate, compare, and accept at desktop and 375 px; verify the accepted candidate remains current after API/worker restart.
- [x] 6.5 Run existing image generation, visual consistency, Story, Scene, and TTS regression suites once and record results.

## 7. Real ComfyUI benchmark

- [x] 7.1 Reconfirm the running ComfyUI version, model components, installed control/LoRA/preprocessor inventory, GPU, and approved workflow readiness against the actual server; record evidence and keep advanced control NONE unless compatible benchmarkable evidence has materially changed.
- [x] 7.2 Reuse or reconstruct the Prompt #10 recurring Linh benchmark with five representative Scenes and preserved reference-conditioned baselines; verify the set includes close-up, wide environment, action/pose, important-object interaction, strong composition, and the engine-room composition-bleed failure.
- [x] 7.3 Generate bounded reference-conditioned candidate sets for all five Scenes through real persisted jobs, recording generation/Asset IDs, seeds, durations, stability, and measurable GPU memory; verify every result is a real validated previewable Asset and no candidate replaces an accepted current image.
- [x] 7.4 Persist structured manual scores and issues for every compared baseline/candidate, reject failures, and generate deterministic feedback candidates where warranted; verify Scene 2 uses `WRONG_COMPOSITION` and `REFERENCE_POSE_BLEED` and all review data survives restart.
- [x] 7.5 Compare Prompt #10 baselines with selected Prompt #11 candidates for identity, composition, pose/action, prompt adherence, location, style, and overall quality; verify the report contains per-Scene evidence and does not call candidate selection ControlNet or deterministic control.
- [x] 7.6 Test one two-character Scene if practical or document exactly why it could not be run; verify explicit mappings remain persisted and record identity swaps, composition confusion, or conditioning conflicts without changing the single-character success bar.
- [x] 7.7 Derive `ADVANCED_CONTROL_TECHNIQUE`, `CONTROLNET_REQUIRED_NOW`, `LORA_REQUIRED_NOW`, and `READY_FOR_ANIMATED_STORY` from the scored evidence; verify readiness remains NO if composition/pose mitigation is not meaningful or identity materially regresses.

## 8. Documentation and durable rules

- [x] 8.1 Create `docs/implementation/advanced-image-control.md` with the actual technique matrix, compatibility evidence, NONE/selected decision, unavailable readiness, dependencies, performance, and deferral criteria; verify it matches the implemented stack and benchmark rather than theoretical ControlNet claims.
- [x] 8.2 Create `docs/implementation/image-quality.md` and `candidate-generation.md` with score/issue contracts, acceptance/current policy, approval gate, seed behavior, batch guardrails, retry versus regenerate, and restart semantics; verify examples match API DTOs and Vietnamese UI behavior.
- [x] 8.3 Create `docs/implementation/regeneration-feedback.md` with the deterministic issue mapping, source-review provenance, fingerprint effect, canonical-data isolation, and no-loop boundary; verify every mapping matches the tested assembler.
- [x] 8.4 Create `docs/implementation/control-benchmark.md` with the real five-Scene table, baseline/candidate/feedback rows, seeds, scores, notes, identity regression comparison, multi-character observation, GPU performance, exact setup, and all four final verdicts; verify every claim traces to persisted generation/Asset evidence.
- [x] 8.5 Update `comfyui.md`, `image-generation.md`, `image-consistency.md`, `architecture.md`, `workflow.md`, and `known-limitations.md` for the two unchanged workflows, candidate/review/feedback flow, current/stale behavior, approved NONE decision, and remaining pose/multi-character limits; verify no stale Prompt #9/#10 statements contradict current behavior.
- [x] 8.6 Add only the two durable AGENTS.md rules that advanced controls are additive and image quality review cannot mutate canonical Story/identity data; verify no milestone-specific model/node choice is promoted to a permanent repository rule.

## 9. Final verification

- [x] 9.1 Run `pnpm format`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`; fix all failures and record the exact commands/results.
- [x] 9.2 Run the repository-required `/ponytail-review` before any commit, remove unnecessary abstractions/dependencies or document why each finding is retained, and verify no commit occurs before this review.
- [x] 9.3 Run final real UI/ComfyUI smoke after formatting and regressions, verify TEXT_ONLY, REFERENCE_CONDITIONED, manual override, reference mapping, stale in-flight protection, candidate acceptance, persisted review, Story/Scene/TTS isolation, and restart recovery, then stop without implementing animation or AI video.
