## Why

The repository already contains durable Story, long-story, TTS, Scene, visual-consistency, image, AI-motion, timeline, and hierarchical render workflows, but each remains an explicit user action. A user cannot start one controlled production operation that reuses valid work, schedules only missing dependencies, pauses for review, survives restart, and ends with a verified package ready for a future publishing connector.

## What Changes

- Add a new Production Pipeline capability centered on a lightweight `ProductionRun` that coordinates canonical Story, Chapter, Scene, Asset, timeline, and render records without copying their state.
- Add revisioned `ProductionProfile` settings for `MANUAL_REVIEW`, `BALANCED`, and `AUTO`, including approval gates, bounded batches, AI-motion policy, retry limits, render options, and resource caps.
- Persist product-facing `ProductionStage` records for Story, Chapters, Audio, Scenes, Visual Profiles, Visual Prompts, Scene Images, AI Motion, Timeline, Render, and Publication Package. Stages aggregate existing workflow jobs rather than replacing them.
- Add durable `ProductionIntervention` records for approvals, missing references, continuity staleness, configuration blockers, quality warnings, and required user actions. `WAITING_FOR_USER` remains distinct from failure.
- Add side-effect-free ProductionPreflight and ProductionPlan services. Plans classify canonical work as reusable, buildable, review-required, or blocked, include bounded counts and honest estimates, and never enqueue jobs or generate content.
- Add a `ProductionOrchestrator` that advances one run at a time, schedules existing domain jobs in dependency order, records stage fingerprints and audit summaries, reconciles current canonical state after restart or pause, and remains idempotent under duplicate advance requests.
- Reuse existing Story/long-story batch, TTS/subtitle, Scene, visual profile/package, image candidate, AI-video, timeline, and SceneClip/ChapterVideo/ProjectVideo services. No second pipeline, worker queue, renderer, or invalidation engine is introduced.
- Support full-project and bounded chapter-range scopes, active-run conflict protection, pause, resume, cancel, failed-stage retry, automatic retry only for classified technical failures, and explicit AI-video fallback to Ken Burns where policy permits.
- Add platform-neutral `PublicationPackage` records referencing the verified final ProjectVideo, subtitles, optional thumbnail Asset, editable metadata, chapter markers, production metadata, and a package fingerprint. Package creation never stores binaries in SQLite and never calls YouTube APIs.
- Add manifest generation and safe local export for a publication directory containing referenced media plus `publication.json`, metadata, subtitles, thumbnail when selected, and checksums where available.
- Add production status, stage-detail, intervention-inbox, plan-preview, run-control, and publication-package UI surfaces in the existing web application. All new user-facing copy follows the Vietnamese UI convention while code and planning artifacts remain English.
- Add additive migrations, bounded repository queries, focused orchestration/package tests, scale simulation, restart and reuse evidence, and real browser/API/worker verification for a three-Chapter production run.
- Preserve every existing individual workflow and legacy background render path. Prompt #14 stops at `PublicationPackage READY`; YouTube authentication, upload, scheduling, channel management, and automatic publishing remain Prompt #15.

## Capabilities

### New Capabilities

- `production-pipeline`: Production profiles, runs, stages, preflight, side-effect-free plans, orchestration, interventions, pause/resume/cancel/retry, scoped reuse, reconciliation, progress, guardrails, and the production dashboard.
- `publication-package`: Platform-neutral ready-to-publish package metadata, chapter markers, editable metadata revisions, validation, manifest, and local export without external publishing.

### Modified Capabilities

- `durable-workflow-jobs`: Add the lightweight orchestration advance/package steps and stage-to-job aggregation while preserving the existing single queue, leases, retries, cancellation, and restart recovery.
- `render-planning-and-cache`: Expose the existing render-plan quality/readiness contract to ProductionPlan and package validation without replacing fine-grained fingerprints or scoped invalidation.
- `animated-story-timeline-ui`: Add Production navigation, plan preview, stage progress, intervention inbox, run controls, and links to existing review surfaces without duplicating timeline editing.
- `hierarchical-video-rendering`: Define the final ProjectVideo quality-gate contract consumed by package creation while keeping SceneClip, ChapterVideo, and ProjectVideo rendering unchanged.
- `managed-assets`: Add the explicit publication-thumbnail role, package manifest references, export metadata, and storage accounting without storing binary content in package rows.

## Impact

Affected areas include `packages/shared` schemas and DTOs; additive SQLite migrations and repositories in `packages/database`; orchestration, preflight, planning, package validation/export, and worker integration in `packages/workflow`; existing media and Asset helpers in `packages/media`; thin Fastify routes in `apps/api`; the React production surface in `apps/web`; worker startup/reconciliation in `apps/worker`; implementation documentation; and real verification evidence.

Canonical Story, Chapter, Scene, image, AI-motion, timeline, render, Asset, and job records remain authoritative. Prompt #14 introduces coordination and package records only. No YouTube API, authentication, scheduling, multi-project batch factory, distributed worker, generic plugin system, or giant `RUN_PRODUCTION` job is included.
