## 1. Workspace and shared contracts

- [x] 1.1 Create the pnpm workspace, root scripts, strict TypeScript configs, formatting/linting, Vitest setup, and Node/pnpm version policy; verify `pnpm install` and `pnpm run typecheck` work from a clean checkout.
- [x] 1.2 Scaffold `apps/web`, `apps/api`, `apps/worker`, and the `shared`, `database`, `media`, and `workflow` packages with explicit dependency direction; verify each app has a runnable development/build script.
- [ ] 1.3 Define shared Zod DTOs, opaque IDs, workflow/job/asset enums, safe error contracts, and project/chapter/work status projections; verify schemas reject invalid transport values and infer expected TypeScript types.

## 2. Database and managed workspace

- [ ] 2.1 Implement configurable workspace initialization, required project/media/staging directories, normalized relative path helpers, traversal rejection, and startup reconciliation; verify path-safety tests cover absolute paths, `..`, escaped roots, and generated internal filenames.
- [ ] 2.2 Implement the Drizzle SQLite connection with foreign keys, WAL, busy timeout, UTC timestamps, and one explicit migration command; verify a fresh database migrates and reports its schema version.
- [ ] 2.3 Add reviewed migrations and repositories for projects, chapters, worker heartbeats, workflow executions/steps/dependencies/attempts, jobs, assets/lineage/current roles, TTS segments, and render metadata; verify foreign keys, unique chapter ordering, current pointers, and status constraints.
- [ ] 2.4 Implement streaming SHA-256 hashing, asset commit/promote/validate metadata, safe asset lookup, and range-capable asset streaming; verify identical bytes hash identically and partial/unvalidated files never become current.

## 3. API and project/chapter authoring

- [x] 3.1 Implement the Fastify composition root, structured safe errors, loopback binding, health checks for API/database/workspace/worker/FFmpeg/ffprobe, and `GET /api/health`; verify the endpoint reports each dependency independently.
- [ ] 3.2 Implement thin validated project CRUD routes and application services with `AUDIO_STORY` defaults and persisted status; verify create/list/open/edit/delete behavior and invalid-input responses.
- [ ] 3.3 Implement thin validated chapter CRUD routes and services with revisions, optimistic row versions, project ownership checks, and manual content preservation; verify chapter edits never mutate the submitted original text through TTS preparation.
- [ ] 3.4 Implement deterministic complete chapter reorder validation and persistence; verify duplicate, missing, foreign, and partial orderings leave the prior order unchanged.
- [ ] 3.5 Implement status summary DTOs and persisted worker heartbeat reporting; verify status reads after API/worker process restart reflect database state.

## 4. Durable workflow and worker

- [ ] 4.1 Implement workflow status transitions, dependency graph materialization, fingerprint canonicalization, and named step keys for chapter cleaning/TTS/merge/subtitle/background/render; verify illegal transitions and dependency cycles are rejected.
- [ ] 4.2 Implement atomic single-step claim, attempt creation, lease ownership, heartbeat/progress checkpointing, and conditional completion/failure/cancellation updates; verify a claim race executes one winner and stale owners cannot complete a recovered step.
- [ ] 4.3 Implement retry scheduling and cancellation commands with persisted safe error fields and bounded diagnostics; verify failed steps create new attempts and cancellation never promotes staging output.
- [ ] 4.4 Implement worker startup recovery for expired leases, worker-lost attempts, deterministic retry/fail policy, staging reconciliation, graceful shutdown, and heartbeat loop; verify pending/completed/running recovery scenarios and no rerun of completed work.
- [ ] 4.5 Implement the worker execution loop and API scheduling/status endpoints; verify a persisted pending step is claimed and progress/result state is observable without an in-memory queue.

## 5. Process runner and media primitives

- [ ] 5.1 Implement the centralized shell-free `ProcessRunner` with executable/argument arrays, cwd, allowlisted environment, bounded stdout/stderr, exit/signal/duration results, timeout, and structured errors; verify argument boundaries are preserved and shell metacharacters are never interpreted.
- [ ] 5.2 Implement Windows-safe abort and process-tree termination with graceful then forced cleanup; verify a cancellable fixture process exits without an orphan and timeout reports a structured retryable failure.
- [ ] 5.3 Implement FFmpeg/ffprobe adapters, version/encoder detection, probe parsing, and typed image/video/audio argument builders; verify missing executables and non-zero/probe-invalid outputs fail visibly.
- [ ] 5.4 Implement managed staging promotion and media validation helpers for audio, image/video, SRT, and MP4; verify files are hashed/probed before metadata commit and corrupt outputs remain non-current.

## 6. TTS narration pipeline

- [ ] 6.1 Implement conservative versioned text cleaning with change reports and deterministic paragraph/sentence/clause/word segmentation under finite provider limits; verify same input/configuration yields identical segment text, order, and hashes.
- [x] 6.2 Define the narrow `TtsProvider` contract and implement the real Edge TTS adapter through `ProcessRunner`, including configured voice/language, normalized audio output, provider error classification, and bounded diagnostics; verify a real configured synthesis produces non-empty probeable audio or a structured environment failure.
- [x] 6.3 Implement persisted TTS segment materialization, per-segment execution, measured duration, asset promotion, progress, and completed-fingerprint reuse; verify the failure fixture with segments 1/2 completed and 3 failed executes only segment 3 on retry.
- [x] 6.4 Implement ordered chapter-audio merge manifests and FFmpeg concatenation with validation; verify missing/failed segments block promotion and a successful merge records duration and source lineage.

## 7. Subtitles, backgrounds, music, and rendering

- [ ] 7.1 Implement structured subtitle cues, SRT serialization/parsing/validation, cumulative measured timing, subtitle asset promotion, edit, and replacement APIs; verify timestamps are monotonic, bounded, UTF-8, and subtitle replacement leaves TTS current while invalidating render.
- [ ] 7.2 Implement validated background image/video uploads and current-role asset selection; verify generated internal paths, content/probe validation, preview streaming, and background replacement invalidate render only.
- [ ] 7.3 Implement optional music upload/removal, enabled/volume/loop configuration, and render dependency updates; verify music remains optional and narration is mixed as the primary track.
- [ ] 7.4 Implement immutable timeline/render manifests, 1920x1080 and 1080x1920 presets, FPS/volume/subtitle configuration validation, image stream generation, video loop/trim, subtitle burn-in, music mix, and progress parsing; verify manifests contain input hashes and reject missing prerequisites before FFmpeg starts.
- [ ] 7.5 Implement render job execution, cancellation, ffprobe validation, staged MP4 promotion, current rendered-video asset metadata, playback/download endpoints, and retry; verify failed/cancelled/corrupt renders never publish partial output.

## 8. Dependency invalidation

- [ ] 8.1 Implement transactionally precise chapter-revision invalidation for clean/TTS/merge/subtitle and render descendants while retaining historical assets; verify editing chapter 3 leaves chapter 1/2 TTS and unrelated chapter outputs current.
- [ ] 8.2 Implement background, music, subtitle, and manual chapter-audio invalidation of only render/timeline descendants; verify each source change preserves unrelated narration and exposes named stale causes.
- [ ] 8.3 Implement fingerprint/currentness checks during scheduling and completion to prevent stale in-flight results from becoming current; verify an input changed during work leaves the result historical/invalidated.

## 9. Web application

- [ ] 9.1 Implement the small accessible React/Vite project list/create/open/edit/delete flow with persisted polling and top-level health/status view; verify loading, empty, error, and restart states in the browser.
- [ ] 9.3 Implement Audio, Video, and Render tabs with upload controls, status/progress/errors/retry actions, native audio/video playback, subtitle view/replacement, and render configuration; verify the UI reflects persisted worker state rather than local optimistic state.

## 10. Documentation and verification

- [x] 10.1 Create `docs/implementation/README.md`, `setup.md`, `architecture.md`, `workflow.md`, `filesystem.md`, and `known-limitations.md` covering prerequisites, Node/pnpm, FFmpeg/ffprobe detection, migrations, workspace, process commands, real Edge TTS requirements, and limitations; verify every command is copy/paste friendly.
- [x] 10.3 Run typecheck, lint/format checks, automated tests, and the actual API/web/worker smoke path with SQLite, filesystem, Edge TTS, FFmpeg, and ffprobe; verify create project/chapter, multi-segment narration, subtitle generation, background upload, MP4 playback, restart persistence, failed-segment-only retry, and chapter-scoped invalidation.
- [x] 10.4 Record executed commands/results, environment limitations, deviations from `docs/design-v1`, known limitations, exact local run commands, manual test procedure, and the recommended next milestone without implementing it; verify the final report does not claim unperformed real integrations.
