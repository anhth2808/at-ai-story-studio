## Context

See `proposal.md` for motivation and `specs/ai-story-studio-v1-design/spec.md` for the changed architecture contract. The existing V1 design already defines the product, domain, workflow, provider, asset, and media behavior. This change replaces only the primary implementation stack and stack-specific operational mechanisms before application code exists.

The application remains local-first, single-user, and a modular monolith. SQLite and the managed filesystem remain authoritative. V1 still targets the smallest text-to-TTS-to-subtitles-to-background-to-MP4 vertical slice.

## Goals / Non-Goals

**Goals:**

- Make the V1 design consistently TypeScript-first across browser, API, worker, domain/application modules, workflow, persistence, providers, and media tooling.
- Define a minimal pnpm workspace whose boundaries reflect deployable applications and justified shared code.
- Preserve durable workflow behavior with one persisted Node.js worker and safe SQLite coordination.
- Make external process execution and optional Python interoperability explicit, cancellable, observable, and shell-free.
- Share stable boundary contracts without coupling the UI to database rows or internal domain models.

**Non-Goals:**

- Implement packages, applications, database schemas, migrations, tests, or generated API clients.
- Change V1 product behavior, workflow stages, provider priorities, or roadmap scope.
- Add Redis, BullMQ, RabbitMQ, Kafka, PostgreSQL, microservices, a plugin platform, Electron, or mandatory Python infrastructure.
- Decide exact dependency versions before implementation begins.

## Decisions

### Use a small pnpm modular-monolith workspace

Start with `apps/web`, `apps/api`, and `apps/worker`. Use packages only for boundaries consumed by more than one application or requiring independent dependency direction: initially `domain`, `database`, `workflow`, `providers`, `media`, and `shared` are candidates, not mandatory scaffolding. `shared` is limited to stable cross-boundary Zod schemas, DTO types, identifiers, enums, and workflow/provider statuses.

Alternative: one package for the entire backend. It is initially simpler but makes API, worker, and provider dependency direction harder to keep explicit. Alternative: create every conceptual package immediately. Rejected because empty or one-file packages add tooling and release friction without isolation value.

### Use Fastify as the HTTP composition boundary

Fastify fits a local-first API because it has low runtime overhead, a small core, mature plugin encapsulation, structured logging support, schema-oriented validation/serialization, and straightforward lifecycle hooks for local resources. Routes validate transport input, authorize any future non-loopback access, call application commands/queries, and map results to DTOs. They do not claim jobs, orchestrate workflows, execute providers, or build FFmpeg commands.

Alternative: Express. Viable but requires more assembly for typed schemas, lifecycle, and consistent validation. Alternative: a full-stack framework. Rejected because V1 needs a clear API/worker boundary and no server-rendering framework behavior.

### Use Zod only at boundaries

Zod schemas validate API requests/responses, configuration files, provider/sidecar contracts, and persisted JSON manifests where runtime validation is valuable. Types may be inferred from those schemas. Core entities, repository models, Drizzle row types, and application command internals are not exported to the browser merely because they are TypeScript.

Alternative: share all domain/database types. Rejected because it leaks persistence shape and backend invariants into UI evolution. Alternative: generate all client types from OpenAPI immediately. Deferred until the API surface exists; either generated contracts or deliberate shared Zod DTOs may be chosen consistently during implementation.

### Use Drizzle ORM with explicit SQLite operations

Drizzle owns schema declarations, typed queries, and ordered SQL migrations. Migrations run as a deliberate startup or CLI step under an exclusive application-level migration lock, never concurrently in API and worker startup. Transactions remain short. Raw parameterized SQL is acceptable behind the workflow repository for atomic claiming when it expresses SQLite semantics more clearly than the query builder.

Every connection enables foreign keys and a busy timeout. The database uses WAL mode, with checkpoint/backup behavior coordinated by the application. Claim and dependency indexes follow the documented access paths. PostgreSQL remains deferred until measured write contention or remote/multi-machine workers create a real limitation.

### Keep one persisted Node.js worker

The API materializes workflow rows in SQLite. One separately runnable worker process polls for due steps, claims one in a short `BEGIN IMMEDIATE` transaction using a conditional update, creates an attempt, commits, then performs work outside the transaction. The claim records owner, lease expiry, current attempt, and running state. Completion commits validated asset metadata and terminal step state in a short transaction.

Heartbeats renew leases and persist monotonic progress/checkpoints. Cancellation is a durable timestamp plus an in-memory `AbortController` for the active attempt. Expired leases become `WorkerLost` attempts and retry only under policy. Input fingerprints, idempotency keys, provider job checkpoints, staging paths, and conditional terminal updates prevent duplicate execution under normal one-worker operation and reduce crash ambiguity. The schema retains leases so a later multi-worker design does not require replacing workflow truth.

Alternative: an in-memory queue. Rejected because restart loses work and status. Alternative: Redis/BullMQ or a broker. Rejected because one local worker does not justify another state authority or operational dependency.

### Centralize external process execution

One media/infrastructure process runner accepts executable path, argument array, working directory, allowlisted environment additions, timeout, output limits, log context, and `AbortSignal`. It invokes processes without a shell, captures stdout/stderr separately, returns exit code/signal/duration, emits redacted structured logs, and terminates the process tree gracefully before forced kill on timeout or cancellation.

FFmpeg, ffprobe, appropriate Edge TTS CLI usage, and future one-shot Python tools use this boundary. Domain and workflow modules request media/provider operations and never concatenate commands or accept raw user command strings.

### Keep Python behind an explicit escalation order

Use, in order: native TypeScript/Node integration, an external HTTP API, an existing service API such as ComfyUI, a small isolated Python HTTP sidecar, then a Python subprocess when its lifecycle and workload make that appropriate. F5-TTS, WhisperX, PyTorch, Transformers, and Diffusers may justify Python; the existence of an AI feature alone does not.

Long-lived model sidecars expose versioned request/response schemas, health/version discovery, managed-file references, bounded diagnostics, and cancellation where supported. Node owns project/workflow state, retries, provider selection, asset lineage, and orchestration. Python owns model loading, inference, and model-specific pre/post-processing. ComfyUI normally remains a separately managed service accessed through its API.

### Preserve provider-independent workflows

TypeScript contracts such as `LLMProvider`, `TTSProvider`, `ASRProvider`, `ImageProvider`, and `VideoProvider` describe capabilities and normalized request/results. Implementations may be Node-native, remote HTTP, ComfyUI, Python sidecars, or external processes. Provider-specific authentication, polling, errors, and retries remain in adapters; scheduling and durable attempts remain in workflow modules.

## Risks / Trade-offs

- [TypeScript package boundaries become circular] → Enforce dependency direction, keep packages coarse, and merge packages that lack an independent reason to exist.
- [SQLite writer contention between API and worker] → Use WAL, busy timeout, short transactions, indexed claim queries, one worker, and measurements before considering PostgreSQL.
- [Drizzle cannot express a safe claim succinctly] → Keep one parameterized raw SQL claim operation inside the database/workflow repository and validate affected-row semantics.
- [Lease expiry permits duplicate side effects after a crash] → Use idempotency keys, provider checkpoints, attempt-scoped staging, conditional completion, and explicit outcome-unknown failures instead of blind retries.
- [Cross-platform process-tree termination differs] → Centralize platform handling and validate cancellation against real FFmpeg processes on supported operating systems.
- [Shared TypeScript types couple UI and backend] → Share only stable transport contracts and keep domain/persistence types private to backend packages.
- [Python sidecars drift from Node contracts] → Version schemas, validate both sides at runtime, expose health/version metadata, and pin sidecar environments separately.
- [Two Node processes complicate local startup] → Use pnpm scripts for coordinated development while keeping API and worker independently restartable.

## Migration Plan

1. Update the V1 architecture documents and decision register; do not create application packages.
2. Validate that no active V1 design statement still selects ASP.NET Core, EF Core, `.NET BackgroundService`, or .NET-owned orchestration.
3. Preserve all product/domain/workflow requirements not affected by runtime choice.
4. Use the revised design as the baseline for the later implementation change.

Rollback is documentation-only: restore the previous architecture revision before implementation begins. No data or runtime migration is required because application code and schemas do not yet exist.
