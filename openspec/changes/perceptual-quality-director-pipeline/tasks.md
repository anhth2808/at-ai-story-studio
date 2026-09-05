## 1. Shared contracts and additive persistence

- [x] 1.1 Add strict Shot-plan, NarrativeBeat, Shot, dialogue-mode, importance, static/dynamic intent, continuity-state, continuation-decision, and validation-issue schemas in `packages/shared`; verify invalid ordinals, ranges, event counts, enums, and oversized arrays fail focused schema tests.
- [x] 1.2 Add appearance-stage, reference-generation, exact `ReferenceBinding`, and hard/soft Location contracts in `packages/shared`; verify emotion/action/location-only input cannot parse as an appearance stage and duplicate binding ordinals fail.
- [x] 1.3 Extend existing image score/issue/error schemas with automatic critic status, evaluation, ranking, stage mismatch, character count, anatomy, and required-reference behavior; verify old manual review payloads remain compatible.
- [x] 1.4 Extend video contracts with closed backend identity, backend preference/fallback, backend-specific frame metadata, temporal critic status/issues, continuation lineage, and typed LTX errors; verify Wan requests remain valid and backend node IDs/raw graphs remain absent.
- [x] 1.5 Extend ProductionProfile settings with bounded candidate policy, image/video gates, thresholds, regeneration limits, backend preference/fallback, and strict-reference policy; verify every out-of-range setting and arbitrary graph field is rejected.
- [x] 1.6 Add workflow-step and managed Asset role/type values for Shot planning, reference generation, image/video critics, continuation extraction, and Shot media; verify existing #1-#14 values and DTO imports remain valid.
- [x] 1.7 Add migration `0016_perceptual_quality.sql` for Shot plans/beats/Shots, appearance stages, visual reference generations, critic evaluations, Shot timing/linkage, and nullable Shot lineage on existing image/video records; verify a fresh database migrates through `0016`.
- [x] 1.8 Verify an existing `0015` database upgrades additively with all Story, Scene, image, video, timeline, ProductionRun, and PublicationPackage rows preserved.
- [x] 1.9 Add matching Drizzle declarations, indexes, foreign keys, and exports; verify migration/schema names align and ownership/order/current-revision constraints reject invalid rows.
- [x] 1.10 Implement focused repositories for Shot revisions, appearance stages/reference generations, and critic evaluations using bounded reads and optimistic/current promotion; verify historical revisions remain immutable after replacement.

## 2. Shot and panel director

- [x] 2.1 Add the bounded Shot-director OMP operation and prompt contract using exact current Scene source, relevant identities, hard/soft Location, and neighboring continuity context; verify the request excludes full-novel text and all pixel-generation work.
- [x] 2.2 Implement deterministic Shot-plan fingerprints, stable IDs, revision promotion, and stale-Scene rejection; verify replanning one Scene preserves historical plans and leaves unrelated Scenes current.
- [x] 2.3 Implement one-primary-beat validation for action, dialogue, reaction, reveal, environment, object, or spatial information; verify an overloaded sequential-event Shot is rejected with `SHOT_OVERLOADED`.
- [x] 2.4 Implement visually meaningful turning-point isolation and source coverage checks; verify discovery and reaction become distinct Shots without oversplitting neutral micro-actions.
- [x] 2.5 Implement filler detection from structured useful-information kinds; verify an unrelated atmospheric Shot is rejected or excluded from accepted plan count.
- [x] 2.6 Implement dialogue visual-carrier validation with preserved source semantics and explicit off-screen rationale; verify uncarried dialogue fails and deliberate reaction coverage passes.
- [x] 2.7 Implement dialogue-mode compilation so internal monologue, thought, narration, and voice-over forbid speaking/lip motion while allowing subtle expression; verify generated motion text contains non-speaking mouth behavior.
- [x] 2.8 Persist and validate separate static image intent and dynamic video intent; verify static world detail does not leak wholesale into the video prompt.
- [x] 2.9 Add a bounded Shot-duration ceiling using planned/actual timing and require a meaningful split when exceeded; verify the validator does not split short content solely to increase Shot count.
- [x] 2.10 Add adjacent framing/angle/motion variation warnings with explicit matched/repetition override; verify accidental repetition warns but deliberate matched Shots remain valid.
- [x] 2.11 Wire `PLAN_SHOTS` through the existing worker queue, leases, cancellation, retry, and restart recovery; verify invalid or interrupted output never partially replaces the prior current plan.
- [x] 2.12 Add selective Shot-plan list/detail/generate/regenerate/review API methods and minimal existing Scene UI integration with Vietnamese copy; verify normal Scene status remains bounded at large Shot counts.

## 3. Reference-first Character and Location visuals

- [x] 3.1 Implement revisioned Character appearance stages linked to stable Character/Profile identity with clothing/accessory/equipment-only payload and explicit/inferred provenance; verify transient Shot state never creates a stage.
- [x] 3.2 Implement conservative wardrobe inference from bounded chapter/Scene evidence with confidence and reason; verify sleepwear/winter/formal/patient/changing implications can propose a stage and weak location/emotion cues cannot.
- [x] 3.3 Implement deterministic Character prototype prompt compilation from stable profile identity and current Style Bible using neutral background, ordinary clothing, no props, three full-body orientations, and frontal face close-up; verify the contract changes appropriately for non-photoreal project style.
- [x] 3.4 Generate Character prototype candidates through the existing image provider, managed staging/promotion, fingerprint, and review paths; verify no candidate attaches or becomes approved silently.
- [x] 3.5 Implement stage-reference prompt compilation and generation conditioned on the exact approved current prototype while changing only reviewed stage appearance; verify missing/stale prototype blocks before provider submission.
- [x] 3.6 Persist prototype Asset/hash/profile-revision lineage on every stage reference and propagate prototype replacement staleness only to dependent stages and Shot descendants.
- [x] 3.7 Implement exact Character-stage reference resolution by stable IDs; verify missing stage, similar stage name, prototype, other stage, other Character, rejected, stale, and cross-project Assets never substitute.
- [x] 3.8 Separate hard Location geometry fields from soft Scene-time weather, lighting, atmosphere, temporary objects, and damage; verify a weather-only edit leaves canonical Location revision unchanged.
- [x] 3.9 Implement character-free canonical Location reference prompt/generation/review using only hard geometry; verify transient lighting/weather/story props and Characters are excluded.
- [x] 3.10 Extend existing Visual Bible/reference UI and APIs minimally for prototype, stage, and Location candidates, provenance, approval, rejection, and currentness; verify keyboard access and 375px layout.
- [x] 3.11 Verify replacing one prototype, stage, or Location reference stales only exact dependent prompt/image/video/render descendants and preserves unrelated Story/TTS/media.

## 4. Visual-only prompt compiler and physical continuity

- [x] 4.1 Add `ShotContinuityResolver` that seeds structured initial state from the previous current final state, applies explicit Shot changes, and reports conflicts; verify screen side, facing, pose, held objects, and Location relation affect the next prompt.
- [x] 4.2 Persist initial/final Character/object continuity state, optional camera axis, source Shot identity, and state fingerprint with each Shot; verify free-text notes alone cannot satisfy the continuity dependency.
- [x] 4.3 Replace Scene-level semantic prompt assembly for Shot packages with the documented deterministic visual priority and bump the template version; verify identical inputs compile byte-identically.
- [x] 4.4 Remove `currentGoal`, `knowledge`, secrets, abstract roles, and other nonvisual Story-state text from diffusion prompts unless represented as an explicit visible consequence; verify focused prompts contain none of the raw semantic fields.
- [x] 4.5 Replace raw serialized camera/composition output with concise natural framing, angle, camera, foreground/midground/background, and screen-position language; verify no JSON object text appears.
- [x] 4.6 Compile exact ordered reference bindings from Shot size, role priority, and stable entity ID and snapshot them into image requests; verify provider image N always matches persisted ordinal N.
- [x] 4.7 Implement close/medium/wide reference policy retaining canonical Location in close-ups as a cropped/local slice and prioritizing Location in wide Shots; verify all three policies deterministically bind expected Assets.
- [x] 4.8 Separate `visibleCharacters` and `offscreenCharacters`; verify bare off-screen names, identity text, and references are stripped while gaze becomes a neutral off-camera direction.
- [x] 4.9 Implement minimum-change prompt safety rewriting with immutable binding metadata and exact placeholder-multiset validation; verify deletion, addition, duplication, or renumbering fails before submission.
- [x] 4.11 Extend Visual Prompt Package persistence, fingerprints, stale propagation, selective APIs, and review UI for Shot identity, continuity, static/dynamic prompts, and binding evidence; verify normal dashboard payloads remain bounded.

## 5. Strict continuation and Shot timing

- [x] 5.1 Implement deterministic continuation eligibility covering inward crop/push, identity set, face basis, frame retention, emotional reset, repositioning, Location change, leave/return, reverse angle, and camera reorientation; verify every named invalid case returns false.
- [x] 5.2 Verify a valid inward continuation with supported subject/face state returns true and records an explainable versioned decision.
- [x] 5.3 Add `EXTRACT_SHOT_CONTINUATION_FRAME` using centralized safe FFmpeg execution, actual final decodable frame extraction, media validation, hashing, cancellation, and managed Asset promotion.
- [x] 5.4 Persist continuation source video Asset/hash, source Shot, source frame position, extractor version, and frame Asset/hash; verify a stale/rejected/missing/wrong-revision source fails with `CONTINUATION_SOURCE_MISSING` or equivalent.
- [x] 5.5 Ensure eligible continuation skips independent keyframe generation and uses the extracted prior frame as video input; verify invalid continuation schedules a normal keyframe instead.
- [x] 5.6 Add Shot allocations below existing SceneTiming with exact plan revision, target/actual duration, legal frame count, FPS, and residual; verify allocations stay ordered and preserve Scene timing ownership.
- [x] 5.7 Compose accepted Shot media into existing SceneClip planning and reject stale, failed-QC, missing-reference, or non-current inputs; verify one failed Shot blocks only its Scene descendants and preserves accepted siblings.

## 6. Image candidate policy, critic, ranking, and regeneration

- [x] 6.1 Replace production `candidateCount: 1` with immutable ProductionProfile candidate policy and deterministic Shot importance while keeping existing API and total-job caps.
- [x] 6.2 Verify FAST produces one candidate, BALANCED produces one or two by importance, QUALITY produces two or three for hero/speaking-close-up/reveal/identity-sensitive Shots, and trivial Shots never receive three by default.
- [x] 6.3 Make reference conditioning the strict QUALITY default for important visible Characters and include approved exact stage and Location bindings; verify lower-cost explicit text-only mode remains functional.
- [x] 6.4 Implement the `ImageCritic` structured provider boundary through existing OMP/AiAgent infrastructure with bounded candidate/reference/Shot inputs; verify it cannot mutate canonical Story, Scene, profile, or package data.
- [x] 6.5 Persist automatic image evaluation status, evaluator/version, Asset/input hashes, scores, issue tags, confidence, explanation, guidance, and timestamps; verify critic unavailability remains `UNAVAILABLE`, not pass.
- [x] 6.6 Cover identity, face, hair, clothing/stage, visible Character count, prompt, composition, framing, pose, Location, objects, anatomy, hands, style drift, and reference-pose bleed in the critic schema/prompt; verify malformed or unknown output is rejected.
- [x] 6.7 Implement versioned deterministic ranking with hard-failure exclusion, weighted scores, severe-issue count, candidate index, and stable-ID tie break; verify tied persisted inputs choose the same winner and record why.
- [x] 6.8 Persist candidate-set ranking order, exclusions, scores, winner, and reason without adding hidden mutable best-image state; verify all candidate Assets and evaluations remain historical.
- [x] 6.9 Implement deterministic issue-to-regeneration guidance and bounded automatic candidate attempts under image regeneration/resource/stage/cancellation limits; verify successful siblings are not regenerated.
- [x] 6.10 Verify all-failed exhaustion becomes MANUAL_REVIEW_REQUIRED, intervention, or block by profile and never quality pass.
- [x] 6.11 Extend current renderable-image selection to require exact current Shot/Scene revision, required references, current accepted/ranked candidate, and passing or explicit degraded-review QC; verify stale/rejected/wrong-revision images cannot feed video.
- [x] 6.12 Integrate image critic/rank/retry settlement with existing worker and ProductionStage reconciliation; verify restart reuses completed evaluations and accepted Assets without duplicate provider work.

## 7. Wan and LTX-2 video backends

- [x] 7.1 Add the closed `VideoBackend` resolver and backend contract for readiness, legal frames, duration conversion, prompt compilation, generation, cancellation, and metadata; verify backend-specific branches do not spread into domain/orchestrator code.
- [x] 7.2 Wrap or move current Wan mapping behind `Wan22Ti2v5bBackend` without changing checkpoint, encoder, VAE, sampler/scheduler, dimensions, `4k + 1` rule, readiness, timeout, OOM, restart, or cancellation semantics.
- [x] 7.3 Run existing Wan focused tests after the refactor and verify an exact pre-change Wan generation fingerprint remains reusable.
- [x] 7.4 Inspect the running ComfyUI `object_info`, local 19B model inventory, Story-Claw LTX JSON, and any local saved workflow before freezing the application-owned LTX descriptor; record actual required nodes and parameter meanings in documentation.
- [x] 7.5 Implement `Ltx2_19bDistilledBackend` with portable defaults for the locally present 19B distilled checkpoint and Gemma encoder, versioned node/link mapping, source image/prompt/seed/dimensions/frame/FPS mappings, and no absolute paths.
- [x] 7.6 Validate the LTX graph and actual ComfyUI node/model inventory before submission; verify missing checkpoint, encoder, node, or invalid topology produces typed readiness/error state and never silent Wan execution.
- [x] 7.7 Keep Wan and LTX frame validators separate and confirm the actual 19B LTX workflow uses `8k + 1`; verify counts legal only for another backend are rejected or converted before LTX submission.
- [x] 7.8 Make one LTX descriptor FPS value drive frame conversion, graph compilation, metadata, and timeline math; verify changing it changes all derived values and the workflow fingerprint.
- [x] 7.9 Implement nearest legal duration-to-frame conversion with requested/actual duration persistence and bounds; verify representative below, between, and above-bound values.
- [x] 7.10 Implement parent timing-group frame allocation with legal child counts, minimums, and final-Shot bounded residual; verify total drift is one parent-level rounding residual rather than cumulative child rounding.
- [x] 7.11 Persist backend/workflow/mapping/model/encoder/VAE/sampler/scheduler/seed/dimensions/frames/FPS/durations/settings/keyframe/prompt/attempt/output hash/generation time metadata and omit secrets/raw graphs from status.
- [x] 7.12 Implement LOW_VRAM and BALANCED Wan defaults plus QUALITY LTX default when ready, with explicit policy-controlled Wan fallback and audit metadata; verify unavailable LTX blocks when fallback is NONE.
- [x] 7.13 Wire backend readiness and selection into existing settings, preflight, video service, worker, API, and minimal UI surfaces; verify image readiness remains independent.

## 8. Motion Director and temporal quality

- [x] 8.1 Update deterministic Motion Director defaults to STATIC, slow PUSH_IN, and justified subtle PULL_OUT while preserving existing pan/orbit/handheld choices for explicit stable intent; verify no-motion Shots do not gain novelty motion.
- [x] 8.2 Compile motion prompts from accepted keyframe state, describing only change, speed, camera, environment movement, emotional/speaking timing, and stability of face/body/clothing/objects/background; verify static identity/world prose is not duplicated.
- [x] 8.3 Implement managed first/middle/last frame extraction with optional 25%/75% samples through existing media/process helpers; verify sample lineage uses the exact clip hash and remains bounded.
- [x] 8.4 Implement the `VideoCritic` structured provider boundary and persist explicit QC states, evaluator/version, clip/keyframe/Shot fingerprints, issue tags, confidence, reason, guidance, and timestamps.
- [x] 8.5 Cover identity drift, missing/disappeared primary person, face/body distortion, extra limbs, clothing drift, object mutation, background morph, flicker, camera behavior, motion strength, and temporal instability; verify malformed critic output cannot pass.
- [x] 8.6 Implement primary-person versus background-extra semantics; verify incidental crowd changes do not fail but an unjustified new primary person does.
- [x] 8.7 Implement fabricated-face detection from source face visibility/orientation and reference basis; verify a new frontal face from a back-facing/occluded source rejects in strict mode.
- [x] 8.8 Ensure critic infrastructure errors persist `UNAVAILABLE` and follow technical retry/fallback/intervention policy rather than semantic generation retry or PASS.
- [x] 8.9 Implement deterministic temporal issue guidance and bounded semantic regeneration under `temporalRetryLimit`; verify attempt, reject reason, issues, guidance, and lineage persist and exhaustion blocks/escalates.
- [x] 8.10 Add an optional backend-local early-quality hook only if the approved LTX base decode/refinement topology supports it without global ComfyUI modification; otherwise record DEFERRED and verify full-output temporal QC remains active.
- [x] 8.11 Integrate temporal QC settlement and current-clip acceptance with worker recovery and ProductionStage reconciliation; verify restart reuses committed critic/clip state and rejected/stale clips never feed timeline.

## 9. Production, Story identity, and audio integration

- [x] 9.1 Materialize updated MANUAL_REVIEW, BALANCED, and AUTO profile defaults so all three run automatic image/video quality gates while human approval differs; verify AUTO never disables critics.
- [x] 9.2 Update production preflight/planning to report exact missing references, critic readiness, backend readiness, candidate work, retry exhaustion, and honest estimates without scheduling side effects.
- [x] 9.3 Update existing `SCENES`, `VISUAL_PROFILES`, `VISUAL_PROMPTS`, `SCENE_IMAGES`, `AI_MOTION`, and `TIMELINE` adapters to aggregate bounded Shot work without adding Product stages or direct provider/critic/FFmpeg calls.
- [x] 9.4 Verify quality blockers create deduplicated interventions and no stage completes while a required Shot lacks eligible media; verify BALANCED escalates only uncertainty/exhaustion and MANUAL_REVIEW pauses at human gates.
- [x] 9.5 Verify backend-setting changes invalidate video only, Shot-plan changes invalidate exact Shot descendants, Location/stage changes invalidate bound Shots only, and timing-only edits reuse accepted raw video.
- [x] 9.6 Add bounded future-reveal Character resolution from aliases, blueprint, plan windows, summaries, and capped later context with evidence/confidence; verify one revealed identity reuses canonical Character, voice, and reference IDs.
- [x] 9.7 Verify ambiguous future identity remains unresolved for review and future-only Characters do not receive current-chapter resources.
- [x] 9.8 Add robust decodable playback-duration measurement to centralized media utilities with measurement provenance and explicit fallback; verify a padded MP3 uses decoded duration for accumulation.
- [x] 9.9 Add provider-aware TTS anomaly checks for near-empty audio, text/duration ratio, excessive silence/activity loss, and extreme duration; verify a short-speech/long-silence segment is rejected.
- [x] 9.10 Integrate TTS quality retry at segment scope under existing limits and explicit fallback policy; verify completed sibling segments are not regenerated and inspection failure is not quality pass.
- [x] 9.11 Verify pause/cancel/retry/restart/worker settlement and second-run reuse across new Shot/reference/critic/backend steps using existing canonical outputs as source of truth.

## 10. Focused behavioral verification

- [x] 10.1 Add Director tests for overloaded Shot, turning-point split, filler rejection, dialogue carrier, internal-monologue mouth rule, prompt separation, duration ceiling, and variation warning.
- [x] 10.2 Add Character/Location tests for prototype contract, prototype-derived stage, transient-state exclusion, supported/unsupported wardrobe inference, exact stage identity, no substitution, hard/soft split, no-character Location reference, and Location binding.
- [x] 10.3 Add prompt compiler tests proving no `currentGoal`, `knowledge`, raw serialized JSON, or off-screen names; deterministic order; close/medium/wide policy; exact ordinals; and safety rewrite preservation.
- [x] 10.4 Add continuity/continuation tests proving previous final state affects next initial state, every invalid continuation case is rejected, and valid continuation uses exact prior-frame lineage.
- [x] 10.5 Add image-quality tests proving profile candidate counts, persisted critic scores, deterministic ranking, bounded regeneration, exhaustion policy, restart reuse, and stale/rejected keyframe exclusion.
- [x] 10.6 Add backend tests for Wan resolver/regression, LTX resolver/readiness, QUALITY selection/fallback audit, separate frame rules, complete metadata, FPS ownership, duration conversion, and grouped residual allocation.
- [x] 10.7 Add temporal-quality tests for extra primary person, allowed background extras, fabricated face, identity drift, background morph, critic unavailable, bounded retry, exhaustion, and stale/rejected timeline exclusion.
- [x] 10.8 Add Production tests proving AUTO executes automatic gates, MANUAL_REVIEW pauses, BALANCED escalates only when needed, status remains bounded, and completed critic/accepted media reuse after restart.
- [x] 10.9 Add migration/repository tests for current promotion, immutable history, optimistic conflicts, project isolation, exact dependency queries, and an existing `0015` upgrade.
- [x] 10.10 Add API integration tests for selective Shot/reference/critic/backend endpoints, safe error mapping, bounded production responses, and no absolute paths/secrets/raw graphs.

## 11. Documentation and durable rules

- [x] 11.1 Create `docs/implementation/story-claw-quality-transfer.md` with SC-001 through SC-038 disposition, exact inspected source files, Story-Claw behavior, product implementation location, adaptation differences, reason, and verification evidence.
- [x] 11.2 Update architecture, Scene, visual consistency, visual prompt, Character/Location reference, image generation/quality, AI-video/provider, timeline, production profile/pipeline, setup, and known-limitations documents without duplicating canonical guidance.
- [x] 11.3 Document the actual local LTX 19B workflow identity, node/model readiness, frame/FPS rules, backend fallback semantics, reproducibility metadata, and no-download/no-global-modification boundary.
- [x] 11.4 Document automatic critic versus human approval semantics, explicit QC states, thresholds/retries, strict references, continuation lineage, and bounded status behavior.
- [x] 11.5 Add durable Prompt #15 rules to `AGENTS.md`: quality-mode references, stage/state separation, no fuzzy fallback, visual-only prompts, off-screen stripping, strict continuation, automatic-versus-human review, AUTO quality, backend isolation, and Story-Claw reference ownership.
- [x] 11.6 Verify no file under `references/`, `.omp/skills/`, or `.omp/commands/` changed and no runtime code contains the Story-Claw path or machine-specific absolute model paths.

## 12. Real local and release verification

- [x] 12.1 Run a real local FLUX smoke for Character prototype, prototype-derived stage, character-free Location, exact Character+Location Shot candidates, automatic critic, ranking, and accepted keyframe; record IDs, hashes, models, seeds, durations, and verdicts.
- [x] 12.2 Run the retained real Wan smoke after backend abstraction with an accepted keyframe and conservative motion; record backend/workflow/model/resolution/frames/FPS/duration/seed/codec/container/hash/generation time/QC verdict.
- [x] 12.3 Run a real LTX-2 19B distilled image-to-video smoke against the existing local ComfyUI without downloads or global changes; record the same reproducibility and temporal-QC evidence or exact BLOCKED reason.
- [x] 12.4 Run the controlled comparison Shot through accepted Character+Location references, candidate selection, Wan, LTX, and temporal QC; record observed output and state explicitly whether human perceptual comparison was executed.
- [ ] 12.5 Run the real combined three-Chapter API/worker/SQLite/filesystem production through Shot plans, references, quality gates, timeline, render, PublicationPackage, manifest, export, and playable MP4 probe.
- [ ] 12.6 During the real run, restart the worker, resolve a review wait, retry one failed smallest unit, and verify completion without losing accepted media or duplicating expensive work.
- [ ] 12.7 Start a second equivalent production run and verify canonical Shot plans, references, critic results, accepted media, renders, and package inputs are reused with zero duplicate expensive submissions.
- [x] 12.8 Run focused Vitest files, then `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, `pnpm format:check`, and strict OpenSpec validation; record exact commands, counts, and failures.
- [x] 12.9 Run `/ponytail-review` before commit, delete unnecessary abstractions/files/dependencies, and rerun checks affected by any cleanup.
- [x] 12.10 Produce the required final PASS/FAIL/NOT_RUN/BLOCKED evidence matrix and set `PROMPT_15_HARDENED`, `READY_FOR_QUALITY_E2E`, and `READY_FOR_YOUTUBE_PUBLISH` only from observed gates; `READY_FOR_YOUTUBE_PUBLISH` remains NO.
- [x] 12.11 Commit the completed implementation normally only after all required non-provider checks and strict OpenSpec validation pass; include no generated workspace/database/media artifacts.
