# Production Run

A production run is a durable request to materialize one project scope with one
profile revision. The run references a workflow execution and eleven ordered
stage rows.

## Identity

A run stores:

- stable run ID and project ID
- workflow execution ID
- profile ID and profile revision
- normalized `FULL_PROJECT` or inclusive `CHAPTER_RANGE` scope
- deterministic input fingerprint
- current stage, bounded progress, metrics, and safe error
- timestamps for creation, start, pause, completion, and cancellation

A run never overwrites a prior run. A new profile revision, scope, or canonical
input produces a different fingerprint and can be inspected independently.

## Run statuses

| Status             | Meaning                                              | Allowed next action                  |
| ------------------ | ---------------------------------------------------- | ------------------------------------ |
| `DRAFT`            | Persisted but not started                            | preflight, start, cancel             |
| `READY`            | Preflight passed and waiting to run                  | start, cancel                        |
| `RUNNING`          | Coordinator or stage work may proceed                | pause, cancel, advance               |
| `WAITING_FOR_USER` | Review, missing input, or configuration gate is open | resolve intervention, resume, cancel |
| `PAUSED`           | Explicitly stopped before new scheduling             | resume, cancel                       |
| `FAILED`           | Safe technical or production error                   | retry or start again, cancel         |
| `CANCELLED`        | Cancellation requested and terminal                  | inspect preserved outputs            |
| `COMPLETED`        | All required stages and package gates passed         | inspect package                      |

`WAITING_FOR_USER` is not a technical failure. It preserves the run and its
completed work while exposing an intervention. `FAILED` is reserved for an
error that requires retry or correction.

## Stage projections

Each run has one row for every stage in graph order. A stage stores status,
attempt, fingerprint, progress, reuse/generated/review/blocked counters,
bounded summaries, warnings, fallbacks, blockers, and a safe error.

Stage work links a unit key to an existing workflow step. Reconciliation reads
only those links and workflow statuses. A running stage remains running while
its linked units are still pending or running; it becomes completed only after
all linked units settle successfully or are explicitly reusable.

Illegal run or stage transitions return stable `AppError` codes. Optimistic
row-version checks prevent a stale UI command from overwriting newer state.

## Commands

- **Start** runs preflight, changes `DRAFT` or `FAILED` to `READY`, starts the
  run, and queues one coordinator.
- **Advance** reuses or queues the one active coordinator.
- **Pause** prevents new scheduling; work already claimed may settle.
- **Resume** starts the same run and queues its coordinator. It does not create
  another run.
- **Cancel** marks the run cancelled and requests cancellation for linked work
  and the active coordinator. Completed outputs remain intact.
- **Retry stage** resets only failed, invalidated, or cancelled units, keeps
  successful siblings, records bounded retry metrics, and queues the next
  coordinator.

## Restart recovery

SQLite is the source of truth. On worker startup:

1. expired workflow leases are recovered by the workflow repository
2. active production runs are loaded from SQLite
3. linked stage work is reconciled
4. one coordinator is requested for each still-running run

A committed current Asset or canonical record wins over an unobserved prior
completion notification. The worker never regenerates a valid expensive output
merely because its process restarted.

## Metrics and audit data

Run metrics contain bounded scalar counters such as retry count and stage
summaries. They do not contain full prompts, chapter prose, credentials, raw
provider graphs, binary media, or unbounded logs. Provider usage remains
nullable when the provider does not report it.
