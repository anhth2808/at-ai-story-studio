## 1. Shared image contracts and fingerprints

- [x] 1.1 Add strict provider, readiness, settings, seed-mode, generation-status, freshness, review-status, source, error-code, request, result, and metadata schemas in `packages/shared`; verify valid bounded values parse and unknown/provider-graph fields fail.
- [x] 1.2 Add Scene image settings, generation detail/list, manual upload response, generation/regeneration/review/current-selection, and batch request/response DTOs; verify API payload bounds and nullable manual/provider fields.
- [x] 1.3 Add `GENERATE_SCENE_IMAGE` to the existing workflow step vocabulary without adding a second job type system; verify existing Story, Scene, Visual, TTS, subtitle, and render DTO fixtures still parse.
- [x] 1.4 Define stable image settings and generation fingerprint inputs including package fingerprint, provider, template/mapping version, model components, output-affecting settings, concrete seed, and regeneration instructions; verify each relevant change alters the hash while retry policy/display fields do not.
- [x] 1.5 Resolve RANDOM seeds with Node crypto before scheduling and validate FIXED/same-seed values within the supported safe integer range; verify deterministic fingerprints always contain a concrete persisted seed.

## 2. Additive database and repository support

- [x] 2.1 Add migration `0010_image_generation.sql` for project image settings and Scene image generation revisions with foreign keys, status checks, bounded current indexes, provider prompt correlation, workflow/Asset links, and timestamps; verify an existing database migrates without resets or lost Story/Scene/Visual/media rows.
- [x] 2.2 Mirror migration 0010 in the Drizzle schema and exports; verify SQL and TypeScript columns, indexes, nullable rules, and constraints match.
- [x] 2.3 Implement project image settings read/update/default behavior with optimistic row version and settings fingerprint; verify settings survive close/reopen and invalid updates preserve the current row.
- [x] 2.4 Implement Scene image generation creation, exact Scene/package ownership checks, per-Scene revision numbering, provider prompt lookup, bounded history, and current detail queries; verify historical revisions survive and lists remain metadata-only.
- [x] 2.5 Derive generated freshness from current package/status/fingerprint and current settings fingerprint while treating valid manual images separately; verify profile/style/package/settings changes stale only dependent generated images without fan-out row rewrites.
- [x] 2.6 Implement guarded generated-output commit that verifies the active step lease/fingerprint, stores Asset and generation metadata, and moves current generation/Asset pointers only for fresh input; verify stale-worker and stale-package commits remain historical/non-current.
- [x] 2.7 Implement explicit Set Current and review/note updates transactionally; verify selecting an older READY image clears the prior Scene role pointer without changing Scene/chapter revisions.
- [x] 2.8 Implement manual Scene image registration through the same revision/current model while preserving generated history; verify manual origin, Asset ownership, review status, and current selection survive restart.
- [x] 2.9 Add focused migration/repository tests for revision uniqueness, current-pointer uniqueness, historical preservation, cross-project rejection, restart persistence, and rollback when guarded publication loses its lease.

## 3. Controlled ComfyUI workflow template and mapping

- [x] 3.1 Commit the approved TypeScript `text-to-image-v1` API-format graph using only native `UNETLoader`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode`, `RandomNoise`, `KSamplerSelect`, `Flux2Scheduler`, `EmptyFlux2LatentImage`, `CFGGuider`, `SamplerCustomAdvanced`, `VAEDecode`, and `SaveImage` nodes; verify no custom node or arbitrary client graph path exists.
- [x] 3.2 Centralize node IDs, expected classes, input names, output node, template version, and mapping version in one mapping module; verify no ComfyUI node ID appears in service, route, domain, Style Bible, or UI code.
- [x] 3.3 Map canonical `fullPrompt`, negative prompt, concrete seed, normalized width/height, steps, guidance, sampler, configured diffusion model/text encoder/VAE, and generated output prefix into a cloned template; verify a deterministic fixture maps every field and leaves the source template immutable.
- [x] 3.4 Validate required node classes, inputs, links, output node, allowed template ID, bounded values, and Flux 2-compatible configuration before submission; verify a removed/renamed node produces `WORKFLOW_INVALID` before any provider call.
- [x] 3.5 Preserve project-owned reference image descriptors in `ImageGenerationRequest` but emit a clear `REFERENCE_IMAGES_UNUSED` warning for `text-to-image-v1`; verify no reference upload or conditioning node is added.
- [x] 3.6 Normalize unsupported dimensions conservatively for the template while retaining requested dimensions and persisting actual output dimensions; verify 16:9 and 9:16 examples map predictably.

## 4. ComfyUI HTTP provider and readiness

- [x] 4.1 Implement a bounded Node 22 `fetch` client that accepts only credential-free HTTP(S) base URLs, composes paths safely, streams bodies, applies connection/generation timeouts plus AbortSignal, validates response shapes, and redacts prompts/graphs/secrets from errors; verify malformed URLs and responses fail safely.
- [x] 4.2 Implement readiness using `/system_stats`, approved in-memory mapping validation, `/object_info/{class}`, `/models/diffusion_models`, `/models/text_encoders`, `/models/vae`, sampler choices, and optional `/api/jobs` capability detection; verify all six readiness states and actionable model/node diagnostics.
- [x] 4.3 Implement preflight model availability for the configured diffusion model, text encoder, and VAE without inventing availability or downloading files; verify a missing component returns `MODEL_MISSING` before submission.
- [x] 4.4 Implement provider prompt UUID correlation and pre-submit recovery lookup through `/history/{prompt_id}` plus `/queue`; verify an existing queued, running, or completed prompt resumes instead of being submitted twice.
- [x] 4.5 Submit the mapped API-format workflow through `POST /prompt` with the persisted prompt UUID and generated client ID; verify returned prompt identity, queue acceptance, 400 `node_errors`, network failure, and incompatible response classification.
- [x] 4.6 Poll matching queue/history evidence until success, execution failure, cancellation, or timeout and normalize queued/running/progress/completed/failed state; verify successful submission alone never completes a generation.
- [x] 4.7 Read only the mapped output node from terminal history and stream `/view` output into attempt staging with encoded provider filename/subfolder/type parameters and an independently generated local destination; verify missing output and download failures are classified.
- [x] 4.8 Implement targeted cancellation through `/api/jobs/{id}/cancel` only when capability detection confirms it, otherwise delete matching queued work through `/queue` or stop local waiting with an honest unsupported-running warning; verify no uncertain global interrupt is issued.
- [x] 4.9 Add deterministic fake-server/provider tests for readiness, node/model failure, resume-before-submit, queue/run/success/failure, timeout, cancellation, malformed history, missing output, and bounded diagnostics.

## 5. Image validation and managed storage

- [x] 5.1 Add streaming PNG/JPEG/WEBP magic-byte detection and WEBP media-type support without a new image dependency; verify mislabeled, empty, unsupported, and corrupt files fail before registration.
- [x] 5.2 Reuse ffprobe image validation to read dimensions and enforce positive/reasonably compatible output resolution; verify provider success with unreadable or unreasonable dimensions becomes `OUTPUT_INVALID`.
- [x] 5.3 Extend managed project directories with `images/scenes`, use attempt staging plus generated filenames, SHA-256, and existing safe relative-path/promotion helpers; verify provider/upload names cannot escape or determine destination paths.
- [x] 5.4 Preserve the provider's validated PNG output without re-encoding and retain manual JPEG/WEBP inputs in their validated format; verify no unnecessary binary copy enters SQLite or API JSON.
- [x] 5.5 Add focused output-validation tests proving missing/corrupt provider output fails the generation and publishes no current Asset while preserving any prior current image.

## 6. Image orchestration, workflow, recovery, and batch behavior

- [x] 6.1 Implement `ImageGenerationService` so it loads one exact CURRENT Visual Prompt Package, uses `fullPrompt`/`negativePrompt`, resolves only package reference Assets, applies settings/seed/feedback, and never reconstructs Story context; verify stale/missing packages fail before scheduling.
- [x] 6.2 Implement first generation and creative same-seed/new-seed regeneration scheduling with separate immutable generation revisions, provider prompt IDs, workflow steps, jobs, and fingerprints; verify prior images remain untouched.
- [x] 6.3 Keep technical retry on the existing job/step and logical generation while creative regeneration creates a new row/step; verify a timeout retry retains seed/settings/fingerprint and a new-seed regeneration does not.
- [x] 6.4 Execute `GENERATE_SCENE_IMAGE` in the existing worker, persist normalized progress/provider state, stream/validate/promote output, and conditionally commit generation plus Asset before normal workflow completion; verify no second queue, subprocess, or worker is added.
- [x] 6.5 On recovered leases, reuse a matching completed generation/Asset or resume the persisted ComfyUI prompt before considering submission; verify API/worker restart does not rerun completed work or blindly duplicate an active provider job.
- [x] 6.6 Store a validated stale provider result for history without selecting it current when package/settings/fingerprint changes during execution; verify the previous current image remains selected.
- [x] 6.7 Materialize bounded jobs for one Scene, selected Scenes, one Chapter's missing images, and selected missing-or-stale images using current package/image queries; verify duplicate matching successful or pending work is skipped.
- [x] 6.8 Verify the current one-step worker enforces effective ComfyUI concurrency one and that Story/TTS work cannot create an uncontrolled ComfyUI queue; add no semaphore until actual worker concurrency changes.
- [x] 6.9 Add a 20-Scene fake-provider batch test with success, failure at Scene 8, retry, continuation, restart, and no duplicate successful generations.

## 7. Thin API and manual override endpoints

- [x] 7.1 Add shared-schema-validated routes to read/update image settings and test readiness without performing generation; verify project ownership, optimistic revision conflict, safe errors, and no raw workflow JSON response.
- [x] 7.2 Add routes to list/get bounded Scene image history/current metadata and safe `/api/assets/{id}` URLs; verify list JSON contains no binary/base64 or arbitrary local path.
- [x] 7.3 Add routes to schedule first generation, same-seed/new-seed regeneration, and optional bounded regeneration instructions; verify CURRENT-package/readiness prerequisites and durable job identifiers.
- [x] 7.4 Reuse the existing generic job retry/cancel endpoints for technical retry and local cancellation while allowing provider-aware worker cancellation; verify retry and regenerate cannot be conflated by route behavior.
- [x] 7.5 Add routes for `UNREVIEWED`/`ACCEPTED`/`REJECTED`, bounded manual notes, and explicit Set Current; verify review changes do not implicitly change current selection and vice versa.
- [x] 7.6 Add a Scene-scoped multipart manual image route using generated names, streaming size limits, PNG/JPEG/WEBP validation, and project/Scene ownership; verify provider history remains preserved after manual current selection.
- [x] 7.7 Add bounded selected/Chapter missing/missing-or-stale batch routes; verify no request can execute arbitrary ComfyUI JSON or silently schedule every project Scene.
- [x] 7.8 Add API behavior tests for readiness, generation/history, retry/regenerate, review/current, manual upload, batch eligibility, cross-project rejection, and safe error classification.

## 8. Vietnamese Image Generation and Scene UI

- [x] 8.1 Extend typed web API helpers/state with image settings, readiness, generation metadata, current image, history, job polling, review/current actions, regeneration modes, manual upload, and batch scheduling; verify reload uses persisted API state.
- [x] 8.2 Add a Vietnamese Image Generation settings panel showing ComfyUI server, approved workflow, model components, resolution, steps, guidance, sampler, seed mode, timeouts, readiness, and Test Connection; verify raw workflow JSON and secrets are absent.
- [x] 8.3 Extend Scene cards/detail with package eligibility and MISSING/queued/running/failed/current/stale image state plus Generate Image and actionable prerequisite messages; verify stale packages require rebuild before generation.
- [x] 8.4 Add streamed image preview and bounded revision history showing source, revision, seed, dimensions, provider prompt, generation/freshness/review states, current marker, errors, notes, and timestamps; verify both old and current Assets remain previewable.
- [x] 8.5 Add Accept, Reject, Retry technical failure, Regenerate Same Seed, Regenerate New Seed, optional feedback, and explicit Set Current controls; verify each control calls the distinct API behavior and canonical profiles remain unchanged.
- [x] 8.6 Add manual Scene image upload and selection with supported file hints and Vietnamese validation/error states; verify the browser never sends provider workflow data or relies on upload filenames as identity.
- [x] 8.7 Add selected-Scene, Chapter missing, and missing-or-stale batch controls with per-job outcomes; verify there is no implicit unbounded 200-chapter generation action.
- [x] 8.8 Browser-drive the actual web surface against deterministic/fake provider state to verify settings, readiness, generation polling, preview, review, regeneration, manual upload, current selection, failure/retry, empty states, and responsive usability.

## 9. Documentation and permanent boundaries

- [x] 9.1 Add `docs/implementation/image-generation.md` covering request/result contracts, generation revisions, seeds, retry versus regenerate, freshness, review/current semantics, batch behavior, and no reference conditioning/video; verify it is linked from the implementation index.
- [x] 9.2 Add `docs/implementation/comfyui.md` covering installation assumption, current API routes actually used, approved native Flux 2 workflow, tested model components, readiness/model checks, cancellation/recovery behavior, and exact local setup commands.
- [x] 9.3 Add `docs/implementation/image-provider.md` documenting the narrow provider boundary, package-only context rule, error classes, timeout/cancellation, reference-image forward compatibility, and why no generic provider marketplace exists.
- [x] 9.4 Add `docs/implementation/image-assets.md` documenting managed paths, validation, hashing, generated/manual origins, immutable history, current role, freshness, review, preview streaming, and deletion limits.
- [x] 9.5 Update `architecture.md`, `workflow.md`, `known-limitations.md`, and `setup.md` for the image path, persistence/restart policy, model/workflow requirements, real verification record, unused references, expected face drift, and no render/video handoff.
- [x] 9.6 Add only permanent `AGENTS.md` rules that image providers consume Visual Prompt Packages and stale generation results never become current; verify no provider-specific model/node details or future conditioning promises enter permanent rules.

## 10. Behavioral, regression, and scale verification

- [x] 10.1 Test VisualPromptPackage-to-ComfyUI mapping for positive/negative prompt, concrete seed, width/height, steps, guidance, sampler, model components, output node, and source-template immutability.
- [x] 10.2 Test malformed/removed expected nodes and unavailable model components produce meaningful pre-submission `WORKFLOW_INVALID`/`MODEL_MISSING` failures.
- [x] 10.3 Test terminal provider success with missing, empty, corrupt, unsupported, unreadable, or unreasonable output produces FAILED generation and no current Asset.
- [x] 10.4 Test a profile/package change during RUNNING generation preserves a validated historical image but cannot publish it current for the new state.
- [x] 10.5 Test technical failure then retry keeps one logical generation and seed while completed unrelated Scene images remain unchanged.
- [x] 10.6 Test same-seed and new-seed regeneration create distinct immutable revisions, preserve old Assets, and allow explicit older/current selection.
- [x] 10.7 Test manual Scene image upload, validation, current selection, provider-history preservation, review status, and downstream current-role metadata.
- [x] 10.8 Test database/API/worker restart with pending, running, failed, completed, provider-known, provider-unknown, and selected-current image state; verify documented recovery without duplicate successful work.
- [x] 10.9 Test large selective reads and batch scheduling remain bounded and image lists never load binaries or full project prose.
- [x] 10.10 Run focused Image, Visual Consistency, Scene Engine, Story/Long Story, workflow, migration, Asset/media, TTS, subtitle, render, API, and web tests plus repository typecheck/build/lint; record exact passing/failing commands without weakening existing contracts.
- [x] 10.11 Run `/ponytail-review` over the implementation before any commit, remove unnecessary abstractions/dependencies/duplicate code, and rerun affected verification.

## 11. Real ComfyUI and visual verification

- [x] 11.1 Confirm live ComfyUI readiness and native node/model availability for server `0.33.1`, workflow `text-to-image-v1`, `flux-2-klein-base-4b-fp8.safetensors`, `qwen_3_4b.safetensors`, and `full_encoder_small_decoder.safetensors`; fail visibly rather than substituting a fake provider.
- [x] 11.2 Rebuild and persist a CURRENT Visual Prompt Package for the existing `Smoke project` Scene, save matching project image settings, and record package/Scene/fingerprint prerequisites.
- [x] 11.3 Start the actual API, worker, and web app, schedule one real Scene generation through the UI/API, wait for terminal ComfyUI success, retrieve and validate the real image, and persist generation plus `SCENE_IMAGE` Asset.
- [x] 11.4 Verify the first real Asset path, SHA-256, non-zero bytes, PNG content, dimensions, provider prompt ID, concrete seed, workflow/model metadata, current pointer, and browser preview.
- [x] 11.5 Restart API and worker, reopen the actual Scene UI, and verify the first generation history, Asset link, preview, review state, and explicit current selection remain intact without resubmission.
- [x] 11.6 Regenerate the same Scene through the application with a new seed, wait for real completion, and verify a second immutable generation/Asset exists while the first remains previewable.
- [x] 11.7 Produce and inspect at least one additional real generated revision or eligible Scene image so manual review covers several Studio-owned outputs; preserve all revisions and do not auto-select a best image.
- [x] 11.8 Manually review real outputs for Scene action, Character Visual Profile resemblance, location, project style, camera framing, and contradictions; record concrete observations and expected identity drift without claiming reference conditioning.
- [x] 11.9 Verify package/request reference asset identifiers remain available but `text-to-image-v1` reports them unused; do not perform or claim a fake reference-conditioning smoke.
- [x] 11.10 Record exact local setup/verification steps, provider/recovery/cancellation limitations, real image paths, two required revision results, seeds/dimensions, browser evidence, regression results, and final readiness against every success criterion.
- [x] 11.11 Stop after the final Prompt #9 report and set `READY_FOR_IMAGE_CONSISTENCY = YES` only if real generation, persisted preview, restart, second revision, stale protection, manual override, batch/retry, and regressions all passed; otherwise report `NO` with exact blockers.
  - Decision: `YES` for the implementation mechanics. Real generation, preview,
    restart persistence, second revision, stale-result protection, manual
    override, batch/retry (deterministic coverage), and all regressions passed.
  - Recorded caveat: fixture scene has no characters, so character-resemblance
    consistency remains unproven; first minimal-prompt outputs were degenerate
    (pseudo-text, near-blank) and the content-bearing run showed doubled-lighthouse drift.
