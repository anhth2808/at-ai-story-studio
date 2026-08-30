## Why

The approved V1 design still names ASP.NET Core, EF Core, and .NET worker primitives even though the primary stack decision has changed to a TypeScript-first Node.js monorepo. The architecture must be corrected before implementation so the first vertical slice is built against one coherent runtime, persistence, worker, provider, and process-execution model.

## What Changes

- **BREAKING** Replace the .NET/ASP.NET Core/EF Core application baseline with Node.js, TypeScript, Fastify, Drizzle ORM, React, Vite, SQLite, and a pnpm workspace.
- Define a small modular-monolith workspace with separate web, API, and worker applications and only packages justified by real reuse or dependency boundaries.
- Replace `.NET BackgroundService` with one persisted Node.js worker that claims workflow steps atomically from SQLite and supports restart recovery, progress, retry, cancellation, leases, and failure handling.
- Define SQLite/Drizzle schema management, migrations, transaction boundaries, WAL mode, busy timeout, indexes, and safe job-claiming behavior.
- Define a centralized shell-free external-process abstraction for FFmpeg, ffprobe, selected CLIs, and future sidecars using separate arguments, bounded output capture, timeout, `AbortSignal`, process-tree termination, and structured logs.
- Keep orchestration TypeScript-first. Prefer native Node integration or HTTP/service APIs, including ComfyUI's API, before introducing an isolated Python sidecar with versioned request/response contracts.
- Define deliberate frontend/backend contract sharing through Zod DTO schemas and shared identifiers/statuses without exposing persistence or internal domain objects to the UI.
- Record the .NET-to-TypeScript architecture decision, its trade-offs, Python interoperability, and future impact without changing V1 product scope or implementing application code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-story-studio-v1-design`: Change the required implementation baseline and architecture documentation from ASP.NET Core/EF Core/.NET workers to a TypeScript-first pnpm workspace using Fastify, Drizzle ORM, SQLite, React/Vite, and a persisted Node.js worker while preserving the existing V1 product and workflow behavior.

## Impact

- Affected documentation: `docs/design-v1/README.md`, system architecture, provider architecture, database design, background jobs, UI hosting wording, technology stack, reference-reuse wording, and architecture decisions/risks.
- Affected future dependencies and tooling: Node.js, pnpm, TypeScript, Fastify, Zod, Drizzle ORM, React, Vite, SQLite, FFmpeg, and ffprobe replace the primary .NET toolchain.
- Python remains optional and isolated to model-specific inference or tooling boundaries; Node.js remains authoritative for projects, workflow state, retries, assets, and orchestration.
- No application code, database migration, generated package, or V1 product capability is added by this change.
