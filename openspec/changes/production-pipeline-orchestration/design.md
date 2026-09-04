## Context

See `proposal.md` for motivation and scope. The repository already has one SQLite-backed workflow queue with atomic claims, leases, attempts, retries, cancellation, and restart recovery. `StudioService` composes the current Story, chapter-batch, Scene, visual-consistency, image, AI-video, timeline, Asset, and render services. `WorkerExecutor` executes existing `workflowStepTypeSchema` steps, while `TimelineWorkflowService` owns SceneTiming, MotionPlan, SceneClip, ChapterVideo, and ProjectVideo planning/render materialization.

The current database migration head is `0014_ai_video`. Shared contracts live in `packages/shared`, persistence is Drizzle plus focused SQLite repositories, media stays in the managed workspace, and `apps/api` and `apps/worker` independently compose the same application modules. Existing APIs intentionally expose individual workflows and do not auto-chain them.

The production layer therefore needs durable coordination and product-facing projections, not a second set of Story/media entities or another queue. One local worker remains the operating assumption; all provider and FFmpeg work stays outside short database transactions and outside the orchestrator itself.

## Goals / Non-Goals

**Goals:**

- Persist a resumable run/profile/stage/intervention projection with stable fingerprints and bounded status reads.
- Make preflight and plan computation read-only and explain reuse, build, review, and blockers before any job is created.
- Schedule existing fine-grained workflow steps through one queue, with an idempotent lightweight advance step and restart reconciliation.
- Preserve exact current-Asset, revision, dependency, lease, cancellation, retry, and scoped-invalidation invariants from the existing services.
- Add a deterministic final quality gate, a revision-safe platform-neutral publication package, manifest, and safe local export.
- Provide thin API routes and a responsive Vietnamese production dashboard that links to existing review/editor surfaces.
- Prove the behavior with SQLite integration tests, a real three-Chapter run, restart/pause/review/reuse scenarios, and browser verification.

**Non-Goals:**

- A replacement Story, Chapter, Scene, image, AI-video, timeline, render, Asset, or invalidation model.
- A giant production job, in-memory pipeline, second queue, distributed scheduler, Redis/BullMQ/RabbitMQ/Kafka, or multi-worker resource planner.
- Automatic regeneration loops, autonomous quality selection, full novel context, character/world memory, shot planning, or new AI capabilities.
- YouTube authentication, upload, scheduling, analytics, channel management, or platform-specific publication rules.
- A generic plugin/provider registry, arbitrary user workflow DSL, desktop shell, or new state-management dependency for the web UI.

## Decisions

### 1. Keep coordination in the existing modular monolith

Add production orchestration to the existing `packages/workflow` module and expose only shared Zod contracts/DTOs from `packages/shared`. Add focused repositories to `packages/database`; do not create a production package merely to separate one implementation. `StudioService` owns the composed production service just as it owns the current visual/image/video/timeline services.

The dependency direction remains:

```text
web -> shared -> API DTOs
api -> workflow -> database/media/provider contracts
worker -> workflow -> database/media/provider contracts
workflow -> canonical Story/Scene/Image/Video/Timeline services
```

Production code may call canonical service read/planning/scheduling methods. It must not import Drizzle tables into the UI, call provider SDKs directly, construct FFmpeg argument arrays, or mutate canonical current pointers itself.

### 2. Use additive normalized coordination tables with bounded JSON summaries

Add migration `0015_production_pipeline.sql` and matching Drizzle declarations. Keep fields used for ownership, uniqueness, ordering, status filtering, concurrency, and fingerprints relational. Keep bounded settings, summaries, diagnostics, metrics, validation issues, metadata, marker lists, and export manifests as validated JSON so the schema does not mirror every canonical domain field.

Tables:

| Table | Purpose and important columns |
|---|---|
| `production_profiles` | Project-owned profile revisions: `id`, `project_id`, profile key, revision, settings JSON, current flag, row version, created/updated timestamps. Unique `(project_id, profile_key, revision)`; one current revision per key. Built-in defaults are materialized lazily for existing projects. |
| `production_runs` | One coordination aggregate: `id`, `project_id`, `workflow_execution_id`, `profile_id`, `profile_revision`, scope type/start/end, run fingerprint, status, current stage, advance sequence, row version, requested/started/paused/completed timestamps, cancellation timestamp, bounded plan summary/metrics/error JSON. Unique active overlap is enforced by a short transaction plus a project/scope index. |
| `production_stages` | One row per run and ordered stage key: `id`, `run_id`, ordinal, stage key, status, attempt, input fingerprint, progress current/total, reusable/generated/review/blocked counts, summary/warnings/fallback/blocker/error JSON, started/completed timestamps, row version. Unique `(run_id, stage_key)`. |
| `production_stage_work` | Bounded linkage from a production stage to an existing `workflow_step_id`, with unit key, required flag, and creation timestamp. Unique `(stage_id, workflow_step_id, unit_key)` and indexed by workflow step and stage. This prevents parsing arbitrary payload JSON to aggregate child work. |
| `production_interventions` | Durable inbox items: `id`, run/stage IDs, dedupe key, type, severity, status, affected entity type/ID, safe message, recommended actions JSON, resolution JSON, timestamps. Unique open dedupe key prevents repeated advance calls from creating duplicate prompts. |
| `publication_packages` | Stable package identity: `id`, `project_id`, `run_id`, current revision, status, current fingerprint, created/updated timestamps. One package identity per production run. |
| `publication_package_revisions` | Immutable package revisions: package ID, revision, fingerprint, final ProjectVideo Asset ID/hash, subtitle references JSON, thumbnail Asset ID/hash, metadata JSON plus manual-field ownership JSON, chapter markers JSON, manifest JSON, validation JSON, export metadata, created timestamp. Unique `(package_id, revision)`. |

All IDs are UUIDs, timestamps are UTC ISO strings, hashes are SHA-256 strings, and media references are Asset IDs plus stored hashes. Foreign keys cascade only coordination records owned by the project; canonical Asset and revision history remains governed by existing repositories. Add indexes for project/status, active runs, run/stage ordering, open interventions, and stage-work lookups. Do not add an event-sourcing table; existing workflow attempts/events plus stage timestamps supply activity history.

`publication_package_revisions` never stores media bytes or absolute paths. Export-relative names and managed Asset URLs are generated at the boundary.

### 3. Snapshot profile revisions, not mutable settings

`ProductionProfile` CRUD creates a new revision when settings change. A run stores the selected profile ID and revision and uses that immutable snapshot for all fingerprints and decisions. Changes to a profile do not mutate an active run. Profiles contain only bounded policy values, for example:

```text
review: storyApproval, imageApproval, referenceApproval, continuityApproval, qualityReview
scope: fullProject | chapterRange
batch: chapterBatchSize, imageBatchSize, imageCandidateCount
aiMotion: OFF | SELECTED_ONLY | HIGH_PRIORITY_ONLY | ALL_ELIGIBLE, maxScenes, priorityThreshold, allowKenBurnsFallback
render: existing render preset/subtitle/music settings or a validated render-config revision
retry: maxStageAttempts, automaticTechnicalRetry
resources: minimumFreeBytes, maxEstimatedGpuSeconds, maxGeneratedImages
package: requireThumbnail, requireMetadata, generateMetadataDraft
```

Defaults are conservative: `BALANCED`, review on for Story/image/quality as configured, bounded batches, `OFF` or selective AI motion rather than all scenes, Ken Burns fallback, current render configuration, and no paid-provider fallback unless an existing explicit provider policy says so. Retry limits are orchestration guardrails; they do not replace per-step `maxAttempts`.

### 4. Separate read-only preflight/plan from mutating start

Implement three application services with separate contracts:

- `ProductionPreflight`: validates project/scope and performs read-only readiness checks. Provider health and FFmpeg/ffprobe probes may be called, but no job, Asset, canonical revision, or persistent run mutation is allowed. Results contain stable issue codes, severity, stage, safe message, and action.
- `ProductionPlanner`: reads canonical current revisions, Assets, stage/job status, image/video readiness, Story batch/continuity state, and `TimelineWorkflowService.getRenderPlan`. It returns bounded stage and unit summaries, `REUSE | BUILD | REVIEW | BLOCKED` classifications, dependency explanations, approximate estimates, and a plan fingerprint. It never calls generation providers or materializes workflow rows.
- `ProductionOrchestrator`: owns mutable run/stage/intervention transitions and delegates actual work scheduling to canonical services. It rechecks live state at every advance; a plan snapshot stored on the run is an audit explanation, not a source of truth.

Plans operate on the selected chapter IDs/numbers only. For long projects, repositories use chapter-scoped/paginated reads and the planner retains counters and bounded samples instead of bodies, binary data, full prompts, or all candidate metadata.

### 5. Add one lightweight coordinator step to the existing queue

Add `ADVANCE_PRODUCTION_RUN` to the shared workflow-step type vocabulary. A run owns one `WorkflowExecution` of type `PRODUCTION_RUN`. Each requested advance creates a step with a monotonic key such as `production.advance:<runId>:<sequence>` only when no advance step for that run is `PENDING` or `RUNNING`; the request and sequence increment occur in one SQLite transaction. Completed coordinator steps remain audit history.

The coordinator step does only this:

1. load the run, profile snapshot, live canonical state, and current stage rows;
2. reconcile linked existing workflow steps and current Assets;
3. resolve interventions whose conditions are now satisfied;
4. compute the next bounded plan;
5. transition stage/run projections;
6. call existing scheduling methods for eligible missing/stale work;
7. add `production_stage_work` links and persist a bounded audit summary;
8. enqueue one future advance only when a child transition or user command makes more progress possible.

It never performs LLM, TTS, image, AI-video, hashing, probing, copying, or FFmpeg work. API start creates the run and its first coordinator step. The worker invokes `requestAdvance` after a linked child workflow step settles and at startup for active runs with no pending coordinator. SQLite uniqueness/conditional updates make duplicate API clicks, restarts, and concurrent reconciliation reuse the same step.

New package operations that are not existing domain work use the same queue, not a side queue:

- `GENERATE_PUBLICATION_METADATA` when the user/profile requests an AI metadata draft;
- `BUILD_PUBLICATION_PACKAGE` for manifest/validation/package revision creation;
- `EXPORT_PUBLICATION_PACKAGE` for filesystem copying and checksums.

These steps are bounded and cancellable. The final output is still owned by `PublicationPackageService`, not by the orchestrator.

### 6. Map product stages to canonical operations

The orchestrator uses an explicit adapter table. Each adapter returns a stage classification and, when eligible, creates/reuses existing fine-grained work. The table is the only place that knows the production dependency order; canonical services retain their own semantics.

| Product stage | Readiness/reuse source | Schedule action |
|---|---|---|
| `STORY` | Current accepted blueprint/StoryState or manual Story inputs; OMP readiness for missing generated Story | Existing Story blueprint/arc/plan operations through `StoryEngine` and existing workflow steps. |
| `CHAPTERS` | Current chapter revisions, plan windows, continuity status, existing `StoryGenerationBatch` | Existing bounded chapter batch operation; preserve sequential checkpoints and per-chapter retry. |
| `AUDIO` | Current TTS segment/chunk/merge and subtitle status for selected Chapters | Existing cleaner, TTS segment, merge, and subtitle scheduling; reuse matching chunks. |
| `SCENES` | Current Scene revisions and scene planning status | Existing SceneEngine generation/regeneration/planning operations. |
| `VISUAL_PROFILES` | Current approved/reusable character/location/object profiles and references | Existing VisualConsistencyService profile candidate operations; create `REFERENCE_REQUIRED` interventions instead of guessing. |
| `VISUAL_PROMPTS` | Current prompt package fingerprint for each selected Scene | Existing visual prompt/package builders. |
| `SCENE_IMAGES` | Current accepted READY image Asset, candidates, review state, reference mapping | Existing ImageGenerationService batch/Scene operations; candidate review policy gates downstream work. |
| `AI_MOTION` | Canonical Scene motion source, priority, accepted raw generation/normalized clip state | Existing SceneVideoService scheduling and normalization. Select deterministically under profile cap; record Ken Burns fallback decisions. |
| `TIMELINE` | Current timing/MotionPlan/SceneClip fingerprints and AI normalization state | Existing TimelineWorkflowService planning and scheduling. No production-specific timeline model. |
| `RENDER` | Existing render plan, current ChapterVideo/ProjectVideo Assets, final quality prerequisites | Existing hierarchical render scheduling and worker execution. |
| `PUBLICATION_PACKAGE` | Current validated ProjectVideo, subtitles, markers, thumbnail policy, metadata revisions | Existing Asset/media helpers plus package steps; create package only after quality gate. |

The orchestrator can overlap independent Audio and Scene planning only when canonical dependencies allow it, but it SHALL not make a downstream stage claimable on a missing required input. Stage rows report the product order even if independent child jobs execute in an allowed overlap.

### 7. Define state transitions and intervention behavior centrally

Run transitions:

```text
DRAFT -> READY                 valid preflight and scope
READY -> RUNNING               explicit start
RUNNING -> WAITING_FOR_USER    blocking intervention
RUNNING -> PAUSED              explicit pause
RUNNING -> FAILED              terminal required error or guardrail
RUNNING -> CANCELLED           explicit cancel
RUNNING -> COMPLETED           all selected stages complete + package READY
WAITING_FOR_USER -> RUNNING   all blocking interventions resolved + resume
WAITING_FOR_USER -> PAUSED    explicit pause
PAUSED -> RUNNING              explicit resume after reconciliation
PAUSED/RUNNING -> CANCELLED   explicit cancel
FAILED -> RUNNING              explicit retry when retryable/allowed
```

`DRAFT` and `READY` never schedule domain jobs. `WAITING_FOR_USER` and `PAUSED` never schedule new domain jobs. An active domain job may finish after pause, and its committed output is reconciled; cancellation uses the existing workflow cancellation flag and `AbortSignal` path.

Stage status is derived from linked work and live canonical state, then persisted as a projection. `STALE` means the stage fingerprint no longer matches live inputs; `WAITING` means an intervention or required manual review is open; `FAILED` is reserved for terminal stage errors. A stage can be `SKIPPED` only for an explicitly policy-skipped optional AI-motion unit with an audit reason; required product stages cannot be silently skipped.

Intervention dedupe key:

```text
runId + stageKey + type + affectedEntityId + liveStageFingerprint
```

Resolving an intervention is a user action plus optional metadata. A blocking intervention cannot be dismissed to bypass a required approval/configuration/asset gate; dismissal is allowed only for non-blocking warnings. Reconciliation automatically resolves an intervention when live canonical state satisfies its condition, retaining resolution history.

### 8. Preserve canonical fingerprints and scoped invalidation

Production fingerprints compose, but do not replace, canonical fingerprints:

```text
run = hash(project current revisions + profile revision + scope + requested options)
stage = hash(stage version + direct canonical revision/hash inputs + relevant profile settings + scope)
```

Transient jobs, timestamps, display labels, retry counters, and unrelated chapters are excluded. The planner delegates media freshness to the existing image/video/timeline/render planners. Examples:

- a Chapter text edit invalidates that Chapter's TTS/subtitle/timing/render descendants and the selected final assembly/package, not unrelated chapters or raw AI motion;
- an accepted image hash change invalidates only the SceneClip and downstream containing Chapter/Project/package outputs;
- a SceneTiming change reuses raw AI motion but rebuilds normalized SceneClip and downstream render/package outputs;
- project music/render settings invalidate only Project assembly/package as existing render rules define.

Production stage rows may become `STALE` immediately after a canonical edit, but canonical invalidation remains authoritative and historical outputs remain addressable.

### 9. Make restart reconciliation event-driven plus startup-safe

The worker entry point receives a `ProductionOrchestrator` and calls:

- `reconcileActiveRuns()` after database/workspace startup and after `workflow.recoverExpired()`;
- `onWorkflowStepSettled(stepId)` after complete/fail/cancel/recovery of a linked child step;
- `requestAdvance(runId, reason)` for explicit API commands and resolved interventions.

Each method is a short DB/read/scheduling operation. It does not keep an in-memory run queue. If an active run has a pending/running child, reconciliation only updates stage projection. If no child can make progress, it leaves the run waiting/paused/failed with named reasons instead of hot-looping coordinator steps. Expired coordinator leases follow the normal workflow recovery path; the next worker compares live fingerprints before scheduling anything.

`production_stage_work` means the worker can wake only affected runs without scanning every project. A deleted or missing linked step causes a fresh planner decision; it does not fabricate completion. A matching current Asset committed before a crash is reused even if the step completion transition was not observed.

### 10. Keep package construction revision-safe and platform-neutral

`PublicationPackageService` builds a package candidate from the selected run scope:

1. invoke the existing final quality gate against current ProjectVideo/ChapterVideo/SceneClip dependencies;
2. resolve current subtitles and explicit thumbnail Asset policy;
3. generate chapter markers from measured ChapterVideo durations and titles, rejecting unknown offsets;
4. carry forward manual metadata fields from the latest package revision;
5. optionally schedule/use a validated OMP metadata draft without overwriting manual fields;
6. compute a package fingerprint over final Asset hashes, subtitle hashes, thumbnail hash, metadata/marker revision, scope, and package version;
7. insert an immutable package revision and set the package current revision in one short DB transaction;
8. expose a manifest DTO with Asset IDs, hashes, media metadata, export-relative names, validation, metrics, and no absolute paths.

The package stage is `COMPLETED` only after a package revision validates as `READY`. A package input change creates a new immutable revision or marks the current revision stale; it does not delete the prior package. `PUBLICATION_THUMBNAIL` is an additive Asset type/role and uses existing upload/validation/path-safety helpers. Local export writes under a generated managed directory, copies only validated Asset paths, hashes/verifies copied bytes, and writes `publication.json` with a temporary file plus atomic rename. A user-selected destination is resolved under an explicit export policy and is never passed to a shell.

No package field contains YouTube account, privacy, schedule, channel, OAuth, or upload state. The UI labels `READY TO PUBLISH` as a local handoff state only.

### 11. API contracts and web integration

Add shared Zod request/response schemas and thin Fastify routes under the existing project route surface:

```text
GET    /api/projects/:projectId/production/profiles
POST   /api/projects/:projectId/production/profiles
PATCH  /api/production/profiles/:profileId
GET    /api/projects/:projectId/production/preflight
POST   /api/projects/:projectId/production/plan
POST   /api/projects/:projectId/production/runs
GET    /api/production/runs/:runId
GET    /api/production/runs/:runId/stages/:stageKey
POST   /api/production/runs/:runId/start
POST   /api/production/runs/:runId/pause
POST   /api/production/runs/:runId/resume
POST   /api/production/runs/:runId/cancel
POST   /api/production/runs/:runId/stages/:stageKey/retry
GET    /api/production/runs/:runId/interventions
POST   /api/production/interventions/:id/resolve
POST   /api/production/interventions/:id/dismiss
GET    /api/production/runs/:runId/package
POST   /api/production/runs/:runId/package/rebuild
PATCH  /api/production/packages/:packageId/metadata
POST   /api/production/packages/:packageId/thumbnail
POST   /api/production/packages/:packageId/export
GET    /api/production/packages/:packageId/manifest
```

Use body schemas with strict enums, chapter-range bounds, profile limits, optimistic row versions, and safe destination policy. Return bounded DTOs and existing Asset stream URLs. Map `AppError` to stable safe codes; never expose Drizzle rows, absolute paths, raw FFmpeg commands, provider graphs, secrets, full prompts, or media bytes in JSON.

Add a Production tab or route in the current React project workspace rather than a second application. Keep the initial implementation small: profile selector, plan preview, stage table, attention list, run controls, package panel, and links to existing Story/Visual/Image/Timeline/Render pages. Poll the run status endpoint while active and slow polling when idle. Use Vietnamese labels, visible text statuses, native buttons/inputs, keyboard focus, responsive stage cards, and explicit loading/error/empty states.

### 12. Migration and startup sequencing

Implementation adds the migration file, schema declarations, repository exports, and migration list entry. No destructive backfill is needed. Existing projects receive a default `BALANCED` profile on first profile/run read or a small explicit migration seed; profile creation is idempotent. Existing workflows and Assets remain valid without a run.

API and worker continue using the existing single migration path. The implementation must preserve the current rule that migrations complete before accepting work. Workspace initialization adds publication/export directories through existing managed-directory helpers and startup reconciliation ignores uncommitted package export staging.

### 13. Verification strategy

Tests must prove behavior, not table wiring:

- shared schema boundary rejects invalid profile/scope/status values and accepts bounded DTOs;
- SQLite repository tests prove profile/run/stage/intervention/package transitions, optimistic conflicts, active-overlap prevention, dedupe, and immutable package revisions;
- planner tests prove empty flow, full reuse, one-chapter scoped invalidation, side-effect-free repeated plans, unknown estimates, review blockers, optional AI fallback, required-provider blocks, and no jobs/provider calls during dry run;
- orchestrator integration tests prove stage ordering, idempotent duplicate advance, smallest-unit retry, pause/resume, cancel, worker-loss recovery, manual completion reuse, continuity-stale wait, and second-run reuse;
- package tests prove quality-gate blockers, marker offsets, manual metadata preservation, stale detection, manifest redaction, path-safe export, checksum correctness, and no binary-in-DB behavior;
- a real three-Chapter E2E uses the actual API, worker, SQLite database, managed workspace, existing provider/media paths, and real validated output. It must exercise a planned run, generated/reused stages, review wait and resolution, pause/resume, worker restart, one failed/retried unit, second-run reuse, final MP4 playback/probe, package manifest/export, and audit metrics;
- browser verification opens the real web surface, previews a plan without creating work, starts a run, observes persisted progress, resolves a visible intervention, pauses/resumes, and reaches the package panel at a narrow viewport.

Avoid adding a test for every DTO field or a fake “completed” fixture that bypasses WorkerExecutor and Asset validation. Controlled test providers may be used only behind the existing provider/AiAgent contracts when external services are unavailable; the acceptance run must still traverse the real worker, persistence, staging, promotion, and quality-gate paths.

### 14. Implementation file map

Expected ownership, subject to existing exports and naming conventions:

```text
packages/shared/src/production.ts
packages/shared/src/publication.ts
packages/shared/src/index.ts
packages/database/migrations/0015_production_pipeline.sql
packages/database/src/schema.ts
packages/database/src/production.ts
packages/database/src/publication.ts
packages/database/src/index.ts
packages/workflow/src/production.ts
packages/workflow/src/production-planning.ts
packages/workflow/src/publication-package.ts
packages/workflow/src/index.ts
packages/media/src/workspace.ts or existing workspace module
apps/api/src/index.ts
apps/worker/src/index.ts
apps/web/src/main.tsx and/or a small Production surface component
```

Only add a new file when the existing module cannot remain legible. Do not split the current web application into a new state architecture or create a new package.

## Risks / Trade-offs

- **Coordinator churn:** waking a lightweight advance step after every child completion adds rows. Keep one active advance per run, retain completed history, and avoid creating another coordinator when a pending child already explains the next state.
- **SQLite writer contention:** stage aggregation and run transitions add writes. Keep transactions short, use existing WAL/busy timeout/indexes, and never hold a transaction during provider/media work. Measure claim/status query plans.
- **Projection drift:** stage rows can lag canonical jobs after a crash. Treat live canonical state and linked workflow rows as authority; reconcile on startup and every settle, and expose “reconciling” rather than false completion.
- **Large scopes:** materializing every scene/image job at once can consume disk and DB space. Use profile batch limits and bounded chapter windows; schedule more only after prior work settles. Mark this deliberate bounded-window behavior with a `ponytail:` comment if the implementation leaves a throughput ceiling.
- **AI fallback ambiguity:** fallback can hide a quality loss. Require explicit profile policy, record per-Scene reason and source, and show warnings in the plan, stage, package audit, and UI.
- **External exactly-once limits:** a crash after provider acceptance can still make outcome unknown. Reuse existing provider IDs/idempotency/checkpoint semantics and never blindly retry non-idempotent work.
- **Package/file split:** DB revision and export files cannot commit atomically. Use managed staging, hash/probe, atomic rename, startup reconciliation, and preserve prior package revisions.
- **Metadata regeneration:** automatic drafts can overwrite creator intent if treated as canonical. Carry forward manual fields and require explicit regenerate actions.
- **UI size:** the current web entry point is large. Add the smallest production surface and reuse existing components/API helpers instead of an application-wide refactor.
- **Verification cost:** real three-Chapter generation depends on provider and FFmpeg availability. Keep a deterministic controlled adapter path for CI while reserving the real local provider/media E2E as a release gate; report unavailable external prerequisites instead of fabricating evidence.
