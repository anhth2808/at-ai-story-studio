## Context

See `proposal.md` for the motivation and scope. The repository is currently research/documentation only; `references/` is read-only. The V1 design documents require a local TypeScript modular monolith with independent React web, Fastify API, and Node worker processes, SQLite as workflow truth, managed filesystem media, and shell-free FFmpeg execution. OMP, Story AI, Python, distributed queues, and authentication are explicitly outside this change.

## Goals / Non-Goals

**Goals:**

- Establish a cloneable pnpm workspace with one explicit migration path and independently runnable web/API/worker applications.
- Prove the durable local path from manual chapter text through real Edge TTS, measured subtitles, uploaded background, FFmpeg, ffprobe, and playable MP4.
- Keep API routes thin and keep browser contracts separate from Drizzle rows, provider details, and filesystem paths.
- Make retry, restart recovery, cancellation, staging, asset promotion, and chapter-scoped invalidation observable and testable.
- Keep the initial package graph small while extracting boundaries genuinely shared by API and worker.

**Non-Goals:**

- Any LLM, OMP SDK, Story AI, chapter generation/adaptation, memory, scene planning, AI image/video, WhisperX, voice cloning, publishing, auth, broker, or multi-worker orchestration.
- A general provider/plugin framework, arbitrary user workflows, a complete design system, or an enterprise-grade scheduler.
- Byte-identical media across machines; determinism means stable manifests/segments/arguments for the same recorded inputs and tool configuration.

## Decisions

### Package and process layout

Use these initial boundaries:

```text
apps/
  web/       React + Vite browser UI
  api/       Fastify composition root and HTTP routes
  worker/    persisted workflow worker entry point
packages/
  shared/    Zod DTOs, IDs, enums, public status contracts
  database/  Drizzle schema, migrations, SQLite connection, repositories
  media/     workspace/file safety, hashing, process runner, ffmpeg/ffprobe adapters
  workflow/  application services, workflow state machine, TTS/subtitle/render orchestration
```

`shared` is browser-safe. `database`, `media`, and `workflow` are server-only. Provider details remain behind the TTS interface in `workflow` for this first vertical slice; a separate providers package is deferred until a second specialized provider creates a real reuse boundary.

API and worker share packages but run as separate processes. The API only persists commands/status; the worker performs all long-running provider/media work.

### Persistence and migrations

Use SQLite with Drizzle ORM and a single startup/migration command before API/worker work is accepted. Configure foreign keys, busy timeout, WAL, and UTC ISO timestamps. Use generated UUIDv7 identifiers. Store editable current project/chapter rows relationally; store large audio/image/video files and immutable JSON/SRT manifests in the managed filesystem with metadata rows.

Initial relational tables:

- `projects`: requested project fields, `AUDIO_STORY`, current configuration revision, lifecycle/status, timestamps, row version.
- `chapters`: project relation, unique number, title/content, status/revision, timestamps, row version.
- `workflow_executions`, `workflow_steps`, `workflow_step_dependencies`, `workflow_step_attempts`, and `jobs`: durable graph/attempt state plus a one-to-one API job projection containing type/entity/status/progress/error timestamps.
- `assets`, `asset_dependencies`, and `asset_role_current`: immutable metadata, hash/path/validation/lineage, and logical current pointers.
- `tts_segments`: chapter/index/text hash/status/audio asset/duration/attempt/error.
- `worker_heartbeats`: current worker identity and last heartbeat for health/recovery diagnostics.

Use repository transactions for short metadata mutations only. Provider calls, FFmpeg, probing, hashing, and file copying never occur in a transaction.

### Workflow materialization and recovery

Represent the first pipeline as explicit step keys scoped to a chapter/project: clean text, one step per TTS segment, chapter-audio merge, subtitle generation, background preparation when needed, and render. Persist dependency edges so chapter-local work does not depend on unrelated chapters; final render depends on selected current chapter audio/subtitles plus background/music/configuration.

Claim one due pending step in a short SQLite write transaction with a conditional status transition, attempt row, lease owner, and lease expiry. Execute after commit. Heartbeat/progress and completion updates require matching step ID, attempt ID, and lease owner. On startup, expired running leases become worker-lost attempts and return to pending when retryable, otherwise failed. Completed matching steps and TTS segments are reused.

The API creates pending work and records cancellation/invalidation requests. The worker owns execution and external process cancellation through an attempt `AbortController`. A partial output is never current.

### Invalidation model

Chapter save creates a new revision/fingerprint and, in the same transaction, invalidates only its clean/TTS/merge/subtitle descendants and the project render/timeline descendants. It does not touch other chapters' TTS or subtitle steps. Background/music/subtitle/chapter-audio changes invalidate render descendants only. Historical assets remain available but lose their current-role pointer.

Fingerprints use canonical JSON over step version, ordered source IDs/hashes, relevant configuration, provider/voice settings, and cleaner/chunker/compiler versions. Current output checks compare the fingerprint and source assets rather than relying on timestamps.

### Managed filesystem and asset commit

Initialize a configurable workspace with `studio.db`, `projects/{projectId}/chapters`, `audio/segments`, `subtitles`, `backgrounds`, `music`, `renders`, and `staging/{attemptId}`. Persist only normalized relative paths. Resolve and verify every path beneath the workspace/project root. Copy uploads to generated internal names; retain display names only as metadata.

Write generated output to same-volume attempt staging, close and hash/probe it, atomically promote it to a generated versioned destination, then commit asset metadata/current role and completed step in one short DB transaction. Startup reconciliation removes/quarantines stale staging and reports referenced missing assets.

### Process and media adapters

`ProcessRunner` accepts executable, `arguments[]`, optional cwd/environment additions, timeout, and `AbortSignal`, and returns bounded stdout/stderr, exit code/signal, duration, and structured failure context. Spawn with shell disabled. Abort/timeout terminates the child tree gracefully and then forcefully using the Windows-compatible process strategy; no user string becomes a shell command.

`FfmpegAdapter` and `FfprobeAdapter` are the only modules that construct media argument arrays. Health checks run version probes. Image backgrounds become a stream at the render canvas/duration; background videos loop/trim to narration. Music is optional and mixed below narration. Render writes a partial MP4 in staging, parses FFmpeg progress, then validates dimensions/streams/duration/codecs with ffprobe before promotion.

### TTS and subtitles

The TTS boundary accepts a normalized segment request and returns an audio candidate plus optional timing metadata. `EdgeTtsProvider` is the only implementation and uses the configured pinned Edge TTS executable/protocol through `ProcessRunner`; workflow code never depends on Edge-specific arguments or output format. Normalize successful audio to a known intermediate format and probe duration.

Text cleaning is versioned and conservative. Segmentation first produces stable caption segments and then provider-safe chunks under a finite character/byte limit, preferring paragraph/sentence/clause/word/grapheme boundaries. Persist each segment fingerprint and result. Retry only failed/invalidated segments and reuse completed matching ones. Merge ordered validated audio through FFmpeg and track the chapter audio asset.

Generate SRT from segment text and measured durations with cumulative monotonic timestamps. Store the structured cue manifest plus SRT asset. Validate uploaded/edited SRT and make it current without invalidating narration; only render descendants become stale.

### HTTP and UI contracts

Define request/response Zod schemas in `shared` and infer TypeScript types. Routes validate input, call a workflow/application service, and map safe errors. Expose project/chapter CRUD, ordering, work scheduling/status, uploads, asset streaming, subtitle replacement, render controls, and health. Use polling for active status.

The web UI is intentionally small: project list/create, project editor tabs for Story/Audio/Video/Render, chapter editing/reordering, upload controls, status/progress/error/retry controls, native audio/video playback, and explicit loading/empty/error states. It does not expose future AI controls.

### Verification strategy

Use Vitest for deterministic cleaner/segmenter, workflow transitions, claim races, restart recovery, path safety, hashing, process argument/cancellation behavior, dependency invalidation, and TTS retry reuse. Use a real local smoke procedure with actual SQLite, Edge TTS, FFmpeg, ffprobe, managed files, API, web, and worker; document exact prerequisites and any environment limitation rather than substituting mocks for the final claim.

## Risks / Trade-offs

- Edge TTS is an unofficial network dependency and may change or be unavailable. The adapter boundary, configured executable, bounded errors, and explicit integration prerequisites keep failures visible without contaminating workflow code.
- SQLite and the filesystem cannot commit atomically. Staging, hash/probe-before-reference, short DB commits, and reconciliation reduce split-brain risk but cannot remove it entirely.
- Windows child-process-tree termination needs real smoke verification; the runner must prefer graceful cancellation and bounded force termination over shell-based convenience.
- Segment-level subtitle timing is reliable enough for V1 but not word-perfect. The structured cue model preserves a later alignment path without adding WhisperX now.
- Immutable audio/manifests consume disk. Current pointers and explicit cleanup/known-limitations documentation are safer than automatic deletion during the first working-video milestone.
- Keeping initial TTS/provider logic in `workflow` avoids a premature package, but a second provider should trigger extraction into a dedicated providers package rather than growing workflow-specific protocol code.
