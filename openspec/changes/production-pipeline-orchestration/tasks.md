## 1. Shared contracts and migration foundation

- [x] 1.1 Add production profile, run, stage, scope, intervention, preflight, plan, progress, metric, and error schemas in `packages/shared`; verify invalid enums, ranges, caps, and strict request bodies are rejected by focused Vitest cases.
- [x] 1.2 Add publication metadata, chapter marker, package status, manifest, validation issue, thumbnail, and export DTO schemas in `packages/shared`; verify manifest parsing rejects absolute paths, credentials, binary fields, and malformed timestamps.
- [x] 1.3 Extend the shared workflow-step and Asset vocabularies with coordinator/package operations and the `PUBLICATION_THUMBNAIL` role/type contract; verify existing #4-#13 schemas and API DTO imports remain type-safe.
- [x] 1.4 Design and add additive migration `0015_production_pipeline.sql` for profiles, runs, stages, stage-work links, interventions, package identities, and immutable package revisions; verify a fresh database migrates through `0015` and an existing `0014` database upgrades without data loss.
- [x] 1.5 Add matching Drizzle table declarations, indexes, foreign keys, and repository exports; verify migration/schema names match and foreign-key violations are rejected by a focused SQLite integration test.

## 2. Profiles and durable repositories

- [x] 2.1 Implement revisioned project-owned ProductionProfile persistence with lazy idempotent BALANCED defaults and MANUAL_REVIEW/AUTO presets; verify profile reads never create duplicate revisions under repeated requests.
- [x] 2.2 Implement bounded profile update and optimistic row-version handling; verify an old revision cannot mutate an active run or silently overwrite a newer profile.
- [x] 2.3 Implement ProductionRun creation, scope normalization, deterministic run fingerprints, and DRAFT/READY transitions; verify invalid project, archived project, reversed range, and out-of-range scope requests create no executable work.
- [x] 2.4 Implement active overlapping-run protection for full-project and chapter-range scopes; verify concurrent start attempts produce at most one active overlapping run while disjoint terminal/range runs remain allowed by policy.
- [x] 2.5 Implement ordered ProductionStage creation and projection updates with bounded counters, summaries, warnings, blockers, and safe errors; verify one row exists per run/stage and repeated initialization is idempotent.
- [x] 2.6 Implement stage-work linkage queries and bounded aggregation over existing workflow steps; verify a 100-unit stage returns counts and samples without returning unbounded payloads or media bytes.
- [x] 2.7 Implement intervention repository operations, stable dedupe keys, resolve/dismiss rules, and immutable resolution metadata; verify repeated reconciliation creates one open intervention and cannot dismiss a blocking required gate.
- [x] 2.8 Implement package identity/revision repositories with immutable revision history and current revision selection; verify rebuilding a package preserves prior revisions and rejects stale optimistic updates.

## 3. Read-only preflight and planning

- [x] 3.1 Implement ProductionPreflight project/scope/Story/Chapter readiness checks using existing repositories and services; verify invalid StoryState, missing required Chapters, and continuity blockers return named BLOCKED issues without creating run or workflow rows.
- [x] 3.2 Integrate read-only OMP, TTS, image, AI-video, FFmpeg, ffprobe, model, and disk checks into structured preflight; verify optional AI-video absence is a warning only when Ken Burns fallback is explicitly allowed.
- [x] 3.3 Implement ProductionPlanner stage and unit classifications from canonical current Assets, revisions, image review/reference state, AI motion state, batch state, and TimelineWorkflowService render plans; verify classifications are REUSE, BUILD, REVIEW, or BLOCKED with named dependencies.
- [x] 3.4 Implement bounded chapter/Scene planning reads and selected-scope filtering; verify a 200-Chapter project plan does not load full chapter prose, media bytes, or all provider payloads into the plan response.
- [x] 3.5 Implement honest duration, token, cost, GPU, storage, and remaining-work estimates from available historical metrics; verify unavailable values remain null/unknown and are never rendered as exact or free.
- [x] 3.6 Verify repeated preflight and plan calls are side-effect free and fingerprint-stable; assert workflow/job counts, canonical revisions, Asset current pointers, provider submission counters, and classifications remain unchanged.

## 4. Orchestrator and state transitions

- [x] 4.1 Implement central run/stage transition validation for READY, RUNNING, WAITING_FOR_USER, PAUSED, FAILED, CANCELLED, and COMPLETED; verify illegal transitions return stable safe errors and WAITING_FOR_USER remains distinct from FAILED.
- [x] 4.2 Implement `ADVANCE_PRODUCTION_RUN` as a lightweight step in the existing workflow queue; verify the coordinator performs no provider, FFmpeg, hashing, probing, copying, or other heavy work.
- [x] 4.3 Implement atomic `requestAdvance` deduplication and monotonic coordinator sequencing; verify duplicate/concurrent start and advance requests reuse one active coordinator step per run.
- [x] 4.4 Implement live stage reconciliation from linked workflow steps and canonical Asset freshness; verify a matching committed output is reused after a crash even when the prior step completion was not observed.
- [x] 4.5 Implement stage adapter dispatch in the declared order STORY through PUBLICATION_PACKAGE; verify downstream work remains pending or blocked until required canonical inputs are current.
- [x] 4.6 Implement active-run scope conflict errors and bounded stage scheduling limits; verify full-project plans do not materialize unbounded chapter/image work and later batches are replenished only after prior work settles.
- [x] 4.7 Implement explicit pause and resume with pre-scheduling guards and live reconciliation; verify pause creates no new work, manual work completed while paused is reused, and resume does not create a second run.
- [x] 4.8 Implement cancel propagation through existing workflow cancellation and AbortSignal paths; verify cancellation stops future production scheduling, preserves completed outputs, and never promotes partial files.
- [ ] 4.9 Implement stage retry and automatic technical retry policy with profile limits; verify one failed child retries at smallest unit, non-retryable/configuration/resource failures stop without a hot loop, and successful siblings remain untouched.
- [ ] 4.10 Implement restart reconciliation entry points and workflow-step settlement notifications; verify worker loss, expired coordinator leases, active provider checkpoints, and API/worker restart resume without regenerating valid expensive work.
- [x] 4.11 Add run metrics and bounded audit summaries for reused/generated/retried/approved/fallback work; verify full prompts, source prose, credentials, raw provider graphs, and unbounded logs never enter run status or ordinary logs.

## 5. Canonical stage integrations

- [x] 5.1 Connect STORY and CHAPTERS stages to existing StoryEngine and StoryGenerationBatch operations for Idea, existing Story, manual Chapters, plan windows, and continuity checkpoints; verify an existing accepted Story is reused and a failed chapter pauses only the affected batch/run.
- [x] 5.2 Connect AUDIO to existing text cleaning, TTS segment/chunk, merge, and subtitle scheduling; verify completed TTS segments are reused and one failed segment retry schedules only that segment plus required descendants.
- [x] 5.3 Connect SCENES to existing SceneEngine planning/regeneration and current revision checks; verify selected Chapter ranges schedule only selected Scenes and never invoke image/video providers during scene planning.
- [x] 5.4 Connect VISUAL_PROFILES and VISUAL_PROMPTS to existing visual profile/reference and prompt-package workflows; verify missing required references create `REFERENCE_REQUIRED` interventions rather than guessed conditioning or hidden provider calls.
- [x] 5.5 Connect SCENE_IMAGES to current accepted Asset, candidate review, reference mapping, batch size, candidate count, and image retry behavior; verify rejected/historical/stale candidates never become render inputs.
- [x] 5.6 Connect AI_MOTION to existing SceneVideoService and canonical motion-source/priority data; verify OFF, SELECTED_ONLY, HIGH_PRIORITY_ONLY, and ALL_ELIGIBLE policies are deterministic, capped, and do not generate every Scene by default.
- [x] 5.7 Implement explicit per-Scene AI fallback audit records and stage summaries; verify optional provider absence, rejected output, OOM, and generation failure choose Ken Burns only when policy allows and remain visible in plan/UI/package audit.
- [x] 5.8 Connect TIMELINE and RENDER to existing TimelineWorkflowService and hierarchical render planning/scheduling; verify raw AI motion is reused across timing/subtitle/music/render-only changes and only affected normalized/render descendants rebuild.
- [x] 5.9 Add final render quality gate checks for current ProjectVideo, selected Chapter coverage, audio, subtitles, Asset freshness, ffprobe validation, and open blocking interventions; verify invalid or incomplete output cannot mark the run or package complete.

## 6. Publication package and export

- [x] 6.1 Implement PublicationPackageService quality-gated package creation and fingerprinting from current ProjectVideo, subtitle, thumbnail, scope, metadata, markers, and package version; verify package creation is rejected before the gate passes.
- [x] 6.2 Implement editable metadata revisions with manual-field ownership and optional validated OMP metadata drafts; verify manual title/description/tags survive package rebuilds and explicit regeneration is required to replace them.
- [x] 6.3 Implement chapter marker generation from measured ChapterVideo durations and ordered titles; verify cumulative offsets are correct and missing/unknown durations produce an explicit incomplete issue instead of fabricated timestamps.
- [x] 6.4 Add explicit PUBLICATION_THUMBNAIL selection/replacement using existing managed upload/image validation; verify Asset ID/hash ownership and currentness are checked and no binary is stored in package rows.
- [x] 6.5 Implement deterministic platform-neutral package validation and READY/INCOMPLETE/STALE state projection; verify subtitle replacement, final video replacement, scope changes, and thumbnail changes stale only the package revision that depends on them.
- [x] 6.6 Implement path-safe `publication.json` manifest generation with Asset IDs, hashes, media metadata, export-relative names, markers, metadata, validation, and metrics; verify absolute paths, secrets, raw provider graphs, and binary content are absent.
- [x] 6.7 Implement bounded `EXPORT_PUBLICATION_PACKAGE` workflow work with managed staging, generated filenames, atomic manifest write, file copy/hash verification, and cancellation; verify READY export contains `publication.json`, `video.mp4`, subtitles, optional thumbnail, checksums, and no workspace escape.
- [x] 6.8 Implement explicit incomplete/stale export behavior; verify an incomplete package is refused or visibly marked incomplete and is never presented as READY TO PUBLISH.
- [ ] 6.9 Implement optional `GENERATE_PUBLICATION_METADATA` and `BUILD_PUBLICATION_PACKAGE` queue steps through existing AiAgent/OMP and worker boundaries; verify strict structured validation, bounded usage persistence, retry/cancel/restart behavior, and no direct SDK use from production orchestration.

## 7. Worker and API integration

- [x] 7.1 Wire ProductionOrchestrator, package services, and repositories into `StudioService` without moving canonical ownership; verify existing individual Story, Scene, image, AI-video, Timeline, and render methods continue to work without a ProductionRun.
- [x] 7.2 Extend `WorkerExecutor` dispatch for coordinator and package steps and keep existing step handlers unchanged; verify one worker claim executes each step once under normal operation and coordinator steps remain lightweight.
- [x] 7.3 Add worker startup reconciliation and post-settlement production wake-up calls; verify restarting the worker discovers active runs from SQLite with no in-memory queue dependence.
- [x] 7.4 Add validated profile/run/preflight/plan/status/stage/intervention control routes with bounded DTOs; verify route handlers contain no scheduling, provider, database-transaction, or FFmpeg business logic.
- [x] 7.5 Add pause/resume/cancel/retry and intervention resolve/dismiss routes with optimistic concurrency; verify responses expose stable IDs, safe errors, retryability, and current persisted state after duplicate requests.
- [x] 7.6 Add package read/rebuild/metadata/thumbnail/manifest/export routes and Asset URLs; verify JSON never exposes absolute local paths, credentials, raw commands, provider graphs, or media binaries.
- [ ] 7.7 Add API integration coverage for all status transitions, overlap conflicts, dry-run no-job guarantees, scoped plan results, safe error mapping, and package export status; verify response payloads are bounded for large projects.

## 8. Production web surface

- [x] 8.1 Add a Production navigation surface using existing React/Vite patterns and shared DTOs; verify profile selection, scope selection, and Vietnamese labels render without exposing persistence rows.
- [x] 8.2 Add Preview Plan UI with stage classifications, reuse/build/review/block counts, approximate estimates, warnings, and named blockers; verify Preview Plan performs no start/scheduling side effect.
- [x] 8.3 Add run dashboard UI with current stage, persisted progress counts, activity summary, pause/resume/cancel/retry controls, and polling states; verify refresh/reopen shows database-backed status rather than optimistic client-only progress.
- [x] 8.4 Add Needs Attention intervention inbox and deep links to existing Story, Visual Bible, Image, Timeline, and Render review surfaces; verify blocking review displays affected identity, action, status, and Resume path.
- [x] 8.5 Add Publication Package panel with final playback/download, metadata editing, markers, validation, manifest, export, and explicit no-YouTube boundary; verify READY TO PUBLISH appears only after the quality gate/package validation passes.
- [x] 8.6 Verify keyboard access, visible text status, accessible labels/alt text, loading/error/empty states, and 375px responsive layout without hover-only or color-only meaning.

## 9. Focused behavioral verification

- [ ] 9.1 Add planner/orchestrator tests for empty flow, full reuse, one-Chapter scoped rebuild, manual edit, review wait, required-provider failure, optional AI fallback, no-job dry run, and unknown estimates; verify each test asserts observable classification/scheduling behavior rather than implementation fields.
- [ ] 9.2 Add durable control tests for duplicate advance, active-run overlap, pause/resume, cancel, retry at unit scope, technical retry limits, restart recovery, expired leases, and manual work reuse; verify prior successful Assets and sibling steps remain current.
- [ ] 9.3 Add stage integration tests covering Story, chapter batches, TTS segment retry, Scenes, visual profiles, prompt packages, accepted images, references, AI motion, timeline, and hierarchical render; verify canonical services remain the only producers.
- [ ] 9.4 Add quality/package tests for current Asset gates, ffprobe failure, chapter marker offsets, metadata preservation, package staleness, manifest redaction, thumbnail selection, export checksums, traversal rejection, and no binary-in-DB behavior.
- [ ] 9.5 Add scale simulation for at least 200 Chapters and 100 Scenes/images; verify bounded reads, profile batch limits, persisted counters, deterministic selection, and no unbounded request or database payload.
- [ ] 9.6 Add a real three-Chapter API/worker/SQLite/filesystem E2E that traverses production scheduling, existing provider/media boundaries, staging, promotion, validation, and package creation; verify the MP4 is real, playable, probed, and referenced by Asset hash.
- [ ] 9.7 Extend the real E2E with review wait/resolution, pause/resume, one failed/retried unit, worker restart, second-run reuse, final package manifest/export, metrics, and absence of duplicate expensive work; record pass/fail evidence and prerequisite versions.

## 10. Documentation and release evidence

- [x] 10.1 Write `docs/implementation/production-pipeline.md` covering architecture, stage graph, profile policy, preflight, planning, orchestration, restart, retry, cancellation, metrics, and provider boundaries; verify code/comments remain English and UI examples remain Vietnamese.
- [x] 10.2 Write `docs/implementation/production-run.md` covering statuses, stage projections, fingerprints, scope, idempotency, intervention semantics, and restart recovery.
- [x] 10.3 Write `docs/implementation/production-profile.md` covering MANUAL_REVIEW/BALANCED/AUTO defaults, bounded settings, retry/resource guardrails, AI policy, render/package behavior, and estimated-versus-actual values.
- [x] 10.4 Write `docs/implementation/production-interventions.md` covering all required intervention types, OPEN/RESOLVED/DISMISSED semantics, links, blocking behavior, and safe error handling.
- [x] 10.5 Write `docs/implementation/production-planning.md` covering side-effect-free preflight/plan rules, REUSE/BUILD/REVIEW/BLOCKED classification, canonical fingerprint reuse, bounded estimates, and scope invalidation.
- [x] 10.6 Write `docs/implementation/publication-package.md` covering package revisions, metadata editing, markers, thumbnail Asset references, manifest, safe export, stale validation, and no external publishing.
- [x] 10.7 Update implementation index, architecture, workflow, animated-story-timeline, AI-video, known-limitations, setup, and design-v1 references to describe the new orchestration boundary and the remaining YouTube #15 boundary; verify links and scope statements are coherent.
- [x] 10.8 Add durable Prompt #14 rules to `AGENTS.md` for canonical reuse, package neutrality, stage/intervention semantics, no YouTube, and evidence requirements; verify no generated `.omp/skills` or `.omp/commands` files are edited.
- [x] 10.9 Run the real browser verification against the production surface at desktop and narrow viewport; capture observed plan, waiting intervention, pause/resume, completed package, export, and no-YouTube UI evidence.
- [ ] 10.10 Run focused tests, typecheck, build, lint/format checks, and the real E2E after implementation; verify only intentional failures are documented with missing prerequisites and no release claim is made from a skipped gate.
- [x] 10.11 Run `/ponytail-review` before any commit; remove unnecessary abstractions/dependencies/files and verify the final diff still preserves required validation, durability, security, accessibility, and evidence paths.
- [x] 10.12 Produce the Prompt #14 final evidence matrix and explicitly set `READY_FOR_YOUTUBE_PUBLISH = YES` only when every required production/package/browser/restart/reuse gate passes; otherwise set `NO` with named blockers and do not implement YouTube publishing.
