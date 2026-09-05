# Production Pipeline

Prompt #14 adds one explicit production boundary over the existing Story,
TTS, Scene, visual, image, motion, timeline, render, and publication services.
It does not replace those services or introduce another queue.

## Stage graph

```text
STORY
  -> CHAPTERS
  -> AUDIO
  -> SCENES
  -> VISUAL_PROFILES
  -> VISUAL_PROMPTS
  -> SCENE_IMAGES
  -> AI_MOTION
  -> TIMELINE
  -> RENDER
  -> PUBLICATION_PACKAGE
```

The graph is ordered, persisted, and bounded. A stage can reuse current
canonical output, schedule a bounded batch of existing workflow steps, wait for
review or configuration, or fail with a safe error. A downstream stage is not
scheduled while a required upstream stage is pending, stale, blocked, or failed.

## Ownership

- `ProductionOrchestrator` owns run coordination, stage order, scope conflict
  checks, pause/resume/cancel/retry commands, coordinator deduplication, and
  restart reconciliation.
- `ProductionPreflightService` owns read-only readiness checks.
- `ProductionPlanner` owns bounded REUSE/BUILD/REVIEW/BLOCKED classifications
  and honest estimates. It never creates runs, jobs, provider prompts, or
  Assets.
- Existing Story, Scene, image, AI motion, Timeline, and media services remain
  the only producers of their canonical records and media Assets.
- `PublicationPackageService` owns package revisions, metadata, manifest
  validation, and managed export. It does not publish to an external platform.
- SQLite remains the source of truth. Filesystem media is referenced by Asset
  ID and hash, not embedded in production or package rows.

## Coordinator behavior

`ADVANCE_PRODUCTION_RUN` is a small workflow step. It parses a bounded payload,
reconciles linked work, inspects the next stage, and either records a projection,
creates an intervention, or asks the existing service adapter for bounded work.
It must not call a provider, FFmpeg, ffprobe, hashing routine, filesystem copy,
or media probe. Those operations remain in the existing worker step handlers.

One active coordinator is allowed per run. `requestAdvance` uses a persisted
monotonic sequence and reuses an existing pending or running coordinator. A
completed coordinator wakes the next advance; a failed coordinator moves the
run to `FAILED` with a safe retryable production error.

## Profiles and scope

Profiles are project-owned immutable revisions. The built-in keys are
`MANUAL_REVIEW`, `BALANCED`, and `AUTO`. Settings bound chapter/image batches,
review gates, AI motion policy, Ken Burns fallback, retries, resource limits,
render quality, subtitle policy, music, metadata, and thumbnail requirements.

A run scope is either the full project or an inclusive chapter range. Scope is
normalized against active chapters before a run fingerprint is written. Full
project and overlapping chapter-range runs cannot run concurrently; disjoint
terminal or disjoint range runs remain allowed.

## Lifecycle and recovery

Every run and stage is durable. Stage work links each bounded unit to an
existing workflow step and stores its classification and input fingerprint.
The worker reconciles these links after a restart, recovers expired leases
through the existing workflow repository, and requests another coordinator
without relying on in-memory queues.

Successful current Assets and committed records are reused after a crash.
Changing one chapter, image, timing, subtitle, or render input invalidates only
its dependent production descendants. A manual replacement is authoritative
and never triggers hidden provider work.

## Worker and API boundary

The worker constructs one `StudioService`, starts production reconciliation,
and dispatches coordinator and publication steps through `WorkerExecutor`.
Existing individual handlers continue to work without a ProductionRun.

The API exposes validated profile, preflight, plan, run, stage, intervention,
package, and export routes. Route handlers only parse input, enforce project
ownership, call application services, and return persisted DTOs. They never own
transactions, provider logic, FFmpeg commands, or scheduling policy.

The web Production surface polls the persisted run and package state. It shows
bounded plan classifications, warnings, blockers, interventions, stage
progress, metadata, validation, manifest, and export controls. It has no
YouTube publishing action.

## Verification boundary

Provider and media execution remains behind the existing worker boundaries.
When local GPU capacity is reserved, image and AI-motion steps stay pending
while preflight, planning, reuse, package validation, and safe export remain
available. Prompt #14 also verified the ComfyUI image and AI-motion paths
through the worker; the remaining release-scale limitations are recorded in
`known-limitations.md`.

## Prompt #14 evidence matrix

| Gate                                               | Result       | Evidence                                                                                             |
| -------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| Shared contracts, durable stages, bounded planning | PASS         | Focused Vitest, full Vitest, typecheck, build, lint, and format checks                               |
| Real ComfyUI image generation                      | PASS         | Worker-backed generation completed with a 1024x576 PNG and verified hash                             |
| Real AI motion generation                          | PASS         | Worker-backed generation completed with a 704x384 H.264 MP4 at 24 fps and verified hash              |
| Production orchestration and package export        | PASS         | One-chapter run completed all 11 stages; package `READY` revision 3 and export `COMPLETED`           |
| Browser desktop and 375px production surface       | PASS         | Plan, intervention, pause/resume, package, markers, export history, and no-YouTube boundary observed |
| Required three-chapter release E2E                 | NOT VERIFIED | Current real smoke used one chapter                                                                  |
| Restart/recovery and second-run reuse release gate | NOT VERIFIED | Lease recovery is covered by focused tests; full interrupted release rerun remains                   |
| YouTube publication                                | OUT OF SCOPE | No external publishing route or credential handling exists                                           |

`READY_FOR_YOUTUBE_PUBLISH = NO`.

## Prompt 15 quality gates

Production consumes bounded Shot plans, exact reference bindings, current
accepted media, and persisted critic evaluations. Automatic image and video
critics run independently of human approval; missing, stale, rejected,
uncertain, or unavailable evidence blocks or escalates by profile. The worker
owns retries and reconciliation, while the coordinator only schedules
durable steps.
