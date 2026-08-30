## Why

The repository currently contains research and architecture notes but no executable application. This change establishes the first reliable vertical slice that proves the local TypeScript stack, durable SQLite workflow, real Edge TTS, and FFmpeg media path can produce a playable MP4 before any Story AI or OMP integration is attempted.

## What Changes

- Create a pnpm workspace with strict TypeScript, shared contracts, React/Vite web, Fastify API, and a separately runnable Node worker.
- Add SQLite persistence through Drizzle ORM with explicit migrations for projects, chapters, workflow executions/steps/attempts, jobs, assets, TTS segments, and render metadata.
- Add managed filesystem initialization, normalized workspace-relative paths, hashing, staging, reconciliation, and safe media asset serving/upload handling.
- Add `GET /api/health` with API, database, worker, FFmpeg, ffprobe, and workspace readiness status, plus a small frontend status view.
- Implement validated project and chapter CRUD, chapter ordering, and manual chapter editing without story generation.
- Implement persisted workflow steps as the authoritative queue with atomic claiming, progress, retry, cancellation, leases, and deterministic restart recovery.
- Add one centralized shell-free process runner with argument arrays, bounded output capture, timeout, abort cancellation, process-tree cleanup, and structured results/errors.
- Add a narrow `TtsProvider` boundary with a real Edge TTS adapter, conservative deterministic text cleaning/segmentation, persisted independently retryable TTS segments, measured audio, and chapter audio merge.
- Add immutable asset metadata and current-role pointers for generated/imported media and structured artifacts.
- Generate validated SRT subtitles from known TTS segment text and measured durations; support subtitle editing and SRT replacement.
- Support validated background image/video uploads, image-to-video conversion and video looping through centralized FFmpeg media operations.
- Support optional music upload, volume, and looping with narration remaining the primary audio track.
- Add a manifest-driven render engine for 16:9/9:16 MP4 output, subtitle burn-in, audio mixing, progress, cancellation, ffprobe validation, and persisted rendered-video assets.
- Add precise dependency invalidation: chapter edits affect only that chapter's narration/subtitles and render descendants; background, music, subtitle, or chapter-audio changes invalidate render descendants without broad invalidation.
- Add a deliberately small Projects/Project UI with Story, Audio, Video, and Render flows, persisted polling status, media playback, errors, retries, and empty/loading states.
- Add meaningful unit/integration tests and implementation documentation for setup, architecture, workflow, filesystem, and known limitations.

## Capabilities

### New Capabilities

- `project-and-chapter-management`: Validated project/chapter persistence, CRUD, manual editing, ordering, and project editor status views.
- `durable-workflow-jobs`: SQLite-backed workflow executions, dependency-aware steps/jobs, attempts, claiming, progress, retry, cancellation, leases, and restart recovery.
- `managed-assets`: Immutable filesystem-backed asset records, hashes, current-role pointers, staging, validation, safe paths, and upload/media metadata.
- `narration-and-subtitles`: Conservative text cleaning, deterministic segmentation, Edge TTS synthesis, independent segment retry/reuse, chapter-audio merge, measured timing, and SRT generation/edit/replacement.
- `background-and-rendering`: Background image/video handling, optional music, manifest-driven FFmpeg rendering, progress/cancellation, ffprobe validation, MP4 assets, and media dependency invalidation.

### Modified Capabilities

None. The repository has design documentation but no existing executable capability requirements to modify.

## Impact

- Adds the initial runtime and package structure under `apps/` and `packages/`, workspace configuration, migrations, tests, and `docs/implementation/`.
- Requires Node.js LTS, pnpm, FFmpeg/ffprobe available at configured paths, and network access for Edge TTS during real narration integration.
- Does not add OMP, Bun, LLM calls, Story AI, Python, ComfyUI, distributed queues, authentication, or future roadmap features.
- Existing `references/` content remains read-only and untouched.
