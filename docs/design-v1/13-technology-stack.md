# Technology Stack

## Recommended stack

| Layer | Choice | Rationale for this project |
|---|---|---|
| Runtime/backend | Node.js + TypeScript | One primary language across browser, API, worker, domain/application modules, contracts, validation, and tooling. |
| Package/workspace | pnpm workspace | Fast, deterministic dependency installation with explicit local package boundaries and one lockfile. |
| API | Fastify | Small core, low overhead, plugin encapsulation, lifecycle hooks, structured logging, and schema-oriented validation/serialization. |
| Boundary validation | Zod where runtime validation matters | One deliberate source for API DTO, configuration, manifest, and sidecar contract validation; inferred types reduce boundary drift. |
| Persistence | Drizzle ORM + SQLite | Typed schema/query access and explicit SQL migrations without hiding SQLite transaction behavior. |
| Worker | persisted Node.js worker using `WorkflowSteps` | Restart-safe work without a broker; shares application modules while running independently from the API. |
| Frontend | React + TypeScript + Vite | Strong long-form editor/status/media ecosystem and fast local development/build tooling. |
| Media | pinned FFmpeg + ffprobe | Proven local composition, progress, codecs, and long-duration efficiency. |
| LLM/agent execution | thin `AiAgent` contract -> `OmpAgent` -> OMP SDK | Reuses OMP model/provider execution while keeping SDK types and lifecycle out of domain and application features. |
| Specialized AI/media integrations | Node-native or HTTP adapters first; isolated Python sidecars only when justified | Keeps TTS, ASR, image, video, and model-specific media inference outside the OMP agent boundary. |
| Files | managed local workspace | Simple and fast for large media, with explicit backup/export and reconciliation. |
| Tests later | Node/TypeScript test tooling selected during implementation, focused integration/smoke fixtures, frontend tests only for behavior | Avoids freezing a runner before packages exist and avoids broad media-heavy tests without contract value. |

Pin supported Node.js, pnpm, TypeScript, dependency, SQLite driver, and FFmpeg versions when implementation begins. When the first intelligent feature enters scope, also pin the reviewed OMP SDK and Bun runtime versions; the current official SDK documentation requires Bun 1.3.14 or newer and states that it is not a Node.js SDK. Record the OMP and FFmpeg builds, licenses, and enabled features in distribution notices.

## pnpm workspace

Target layout:

```text
apps/
  web/                         React + Vite
  api/                         Fastify API composition root
  worker/                      persisted workflow worker
  omp-agent/                   optional isolated Bun host when intelligent features enter scope

packages/
  domain/                      domain rules and provider-neutral types
  database/                    Drizzle schema, migrations, repositories
  workflow/                    workflow state machine and execution
  providers/                   specialized provider contracts plus thin AiAgent/OmpAgent boundary
  media/                       process runner and FFmpeg/ffprobe
  shared/                      stable browser/server DTO schemas only
```

This is a boundary map, not a package quota. Start with fewer packages when two concerns have no independent dependencies or consumers. `apps/omp-agent` is not created before an intelligent feature needs it. A package must provide one of:

- reuse by more than one application;
- an enforceable dependency direction;
- isolation of volatile infrastructure dependencies;
- an independently testable contract with meaningful ownership.

Do not create one package per domain noun, re-export every internal type through `shared`, or preserve an empty package for future purity. Package cycles indicate a wrong boundary; merge or move ownership rather than adding indirection.

## Fastify API

Fastify fits a local-first application:

- low framework overhead for a long-running localhost process;
- plugin scopes provide explicit composition for database, workspace, logging, and routes;
- lifecycle hooks coordinate startup health and graceful shutdown;
- schema-oriented validation and serialization work with deliberate DTO contracts;
- Pino-based structured logging is available without adding another logging model;
- route grouping and encapsulation support a modular monolith without service extraction.

Bind to loopback by default; require a separate security decision before LAN exposure. Provide range-enabled asset streaming endpoints rather than raw filesystem serving. Health checks cover database/schema version, managed workspace, worker heartbeat, FFmpeg/ffprobe, configured specialized providers, and the OMP adapter host when enabled.

Routes/controllers remain thin. They validate transport input, call an application command/query, and map the result. Business rules, workflow materialization, job claiming, retries, provider behavior, asset promotion, and FFmpeg command construction stay outside HTTP handlers.

## Type and validation sharing

Good candidates for `shared`:

- Zod request/response DTO schemas and inferred transport types;
- stable enums and opaque identifiers;
- workflow statuses and progress units;
- specialized provider kinds and identifiers plus safe OMP execution-configuration identifiers;
- safe API error codes.

Do not expose Drizzle row types, database schemas, repositories, aggregates, internal commands/events, provider SDK responses, secrets, or filesystem models to the browser. TypeScript makes sharing convenient, but convenience is not a boundary reason.

During implementation, choose one API contract strategy consistently:

1. shared Zod DTO schemas consumed directly by web and API; or
2. server-owned schemas/OpenAPI with generated browser client types.

Do not maintain parallel hand-written DTO types and schemas that can drift.

## Drizzle ORM and SQLite

- Drizzle schema declarations define typed tables, relations, constraints, and indexes.
- Ordered generated SQL migrations are reviewed and recorded; production workspaces are not updated with destructive schema push.
- One explicit migration path runs before API/worker accept work; the two processes do not race startup migrations.
- Ordinary writes use short Drizzle transactions.
- The atomic claim operation may use focused parameterized raw SQL behind the workflow repository when SQLite-specific semantics are clearer.
- Every connection enables foreign keys and busy timeout.
- Workspace initialization enables WAL; startup verifies the effective journal mode.
- API and worker pools remain small because SQLite has one writer regardless of connection count.
- Provider calls, child processes, file copies, hashing, and probing never occur inside a database transaction.

PostgreSQL is not part of V1. Consider it only after measured SQLite contention, remote/multi-machine workers, or another specific requirement exceeds SQLite's local concurrency model.

## Persisted Node.js worker

Run the worker as `apps/worker`, independently restartable from Fastify. The API inserts workflow work into SQLite. The worker claims one due step in a short transaction, commits, performs work, persists progress/checkpoints/heartbeats, and conditionally commits result or failure.

Use persisted lease owner/expiry and attempt IDs even with one worker. This prevents duplicate claims under normal operation and keeps an evolution path for later worker processes. Use `AbortController`/`AbortSignal` for active cancellation. Do not introduce an in-memory-only queue, Redis, BullMQ, RabbitMQ, or Kafka.

For an intelligent operation, the worker creates the durable attempt and calls `AiAgent`. `OmpAgent` may execute in the isolated Bun host, but the worker remains authoritative for attempt state, retry, cost policy, cancellation, fingerprinting, and result commit. OMP session storage is never workflow or project state.

## Centralized process execution

One process runner in the media/infrastructure boundary accepts:

- executable path;
- argument array;
- explicit working directory;
- allowlisted environment additions;
- timeout;
- bounded stdout/stderr policy;
- structured log context;
- `AbortSignal`.

Spawn directly with shell mode disabled. Never concatenate executable and user-controlled values into a shell command. Capture stdout and stderr separately, return exit code/signal/duration, redact structured logs, and terminate the process tree gracefully before forced termination.

FFmpeg, ffprobe, an Edge TTS CLI when appropriate, and future one-shot Python tools all use this abstraction. Higher layers pass typed options and managed asset references, not raw command strings.

The optional Bun-hosted OMP adapter is a supervised long-lived process with a typed versioned local protocol, not an arbitrary command per AI request. Startup, health/version reporting, bounded diagnostics, graceful cancellation, and forced termination follow the same shell-free process safety rules.

## Frontend choices

- React Router for project tabs/routes.
- A small server-state library is optional; do not introduce global state machinery until polling/edit caching needs it.
- Native HTML media elements for playback.
- Accessible component primitives rather than a large design system.
- Poll persisted status first; lower-latency push is optional after durable state works.
- Vite builds static assets for the local application; development may proxy API requests while production serves both through one local origin or coordinated local hosts.

## OMP SDK strategy

Application LLM and agent features use one thin boundary:

```text
Application feature
  -> AiAgent
    -> OmpAgent
      -> OMP SDK
        -> configured model/provider
```

The official SDK is currently an in-process Bun SDK. Therefore Node.js remains the primary product runtime and a small isolated Bun host runs `OmpAgent` until OMP officially supports the approved Node.js runtime or the product makes a separate runtime decision. The host imports OMP SDK directly; it is not an application-owned provider framework and does not own workflows, retries, assets, or persistence.

Headless sessions use explicit model/settings selection, in-memory or attempt-scoped session management, restricted tools, and disabled ambient discovery unless a feature deliberately opts in. Every session is aborted on cancellation, disposed in `finally`, and observed through safe events/telemetry. State-changing output is validated with a feature-owned Zod schema before returning across `AiAgent`.

Pin the SDK instead of floating to latest. A compatibility check covers session creation, model/auth configuration, restricted capabilities, structured terminal output, deadline and cancellation behavior, disposal, events, and normalized failures before each upgrade.

## Python sidecar strategy

Python is not the main backend. Use this escalation order:

1. native TypeScript/Node integration;
2. external HTTP API;
3. existing service API such as ComfyUI;
4. small isolated Python sidecar;
5. Python subprocess when its one-shot lifecycle is appropriate.

F5-TTS, WhisperX, PyTorch models, Transformers, and Diffusers may justify a Python sidecar. Pin its environment separately and expose versioned request/response schemas, health/version discovery, managed-file exchange, bounded diagnostics, and cancellation where possible.

Node.js remains responsible for project state, workflow, retries, job claiming, provider selection policy, asset tracking, and orchestration. Python remains responsible for model loading, inference, and model-specific preprocessing/postprocessing. The Bun-hosted `OmpAgent` remains responsible only for OMP SDK execution and translation. ComfyUI normally runs separately and is integrated through its API rather than embedded in the Node.js process.

## Packaging

V1 can be developer-run through pnpm scripts with configured Node.js and FFmpeg/ffprobe paths. Build the web application with Vite and run API and worker as independently restartable Node.js processes. When the first intelligent feature is enabled, run the pinned Bun-hosted OMP adapter as an independently supervised local process. A coordinated development command is convenience, not a shared-process requirement.

Do not bundle Python or large model environments by default. Do not bundle Bun or OMP before an intelligent feature requires them. A later installer or desktop wrapper may manage the pinned OMP runtime, optional provider packs, and license notices after adapter behavior stabilizes.

## Alternatives

### ASP.NET Core / .NET

The previous design offered strong process hosting, mature dependency injection, and robust server tooling. It was replaced because the product now prioritizes one TypeScript language/tooling model across frontend and backend and practical sharing of boundary contracts. The change trades some .NET runtime maturity for a smaller cognitive/toolchain split.

### Python backend

Direct model imports would be simpler, but model runtimes and GPU lifecycle would become coupled to project/workflow orchestration. Explicit sidecars provide Python interoperability without making Python the main backend.

### PostgreSQL plus broker

Stronger concurrent/distributed claiming is operationally unnecessary for one local user and one worker. Introduce only for measured concurrency or remote-worker requirements.

### Desktop shell

Useful for installers, file dialogs, or tray behavior later, not required for the first local web application. Avoid Electron/Tauri until browser limitations are real.

## Decision: TypeScript owns orchestration; OMP owns LLM/agent execution

- **Alternatives:** ASP.NET Core/.NET primary application; Python-first application; distributed services; application-owned LLM provider SDKs; direct OMP SDK imports throughout feature code.
- **Why:** one primary TypeScript and pnpm toolchain maximizes practical reuse of contracts, validation, domain vocabulary, and developer tooling, while OMP avoids duplicating model/provider execution behind one controlled boundary.
- **Trade-offs:** Node.js requires deliberate CPU/process isolation; the current Bun-only OMP SDK adds a supervised runtime; shared types can create accidental coupling; OMP must be pinned and compatibility-tested.
- **Future impact:** specialized provider implementations and AI sidecars may use other runtimes, and OMP models/providers may change behind `OmpAgent`, but project state, workflow, retries, asset lineage, and orchestration remain stable TypeScript responsibilities.
