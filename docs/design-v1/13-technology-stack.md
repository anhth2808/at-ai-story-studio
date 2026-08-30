# Technology Stack

## Recommended stack

| Layer | Choice | Rationale for this project |
|---|---|---|
| Runtime/backend | ASP.NET Core on current .NET LTS (target .NET 10 LTS at implementation start) | Developer fit, strong async/process hosting, DI/config/logging, maintainable domain code. |
| API | Minimal APIs or controllers by module; OpenAPI | Boring typed HTTP boundary; choose one convention and keep modules grouped. |
| Persistence | EF Core + SQLite | Transactions and migrations for rich workflow state with minimal local operations. |
| Worker | `BackgroundService` using persisted `WorkflowSteps` | No broker; shares domain/application modules; restart through DB leases. |
| Frontend | React + TypeScript + Vite | Strong long-form editor/status/media ecosystem; static assets served by ASP.NET. |
| Media | Pinned FFmpeg + ffprobe | Proven local composition, progress, codecs, long-duration efficiency. |
| AI integrations | .NET HTTP adapters; Python CLI/HTTP sidecars only where necessary | Keeps orchestration/business logic in .NET without reimplementing ML runtimes. |
| Files | Managed local workspace | Simple, fast for large media, backup/exportable. |
| Tests later | xUnit + focused integration/smoke fixtures; frontend component tests only for behavior | Fits .NET; avoid media-heavy broad tests without contract value. |

Version numbers should be pinned when implementation begins, not frozen in architecture prose except the LTS baseline. FFmpeg build/license/features must be recorded in distribution notices.

## Suggested solution layout

```text
src/
  Studio.Web/               API + SPA hosting/composition root
  Studio.Worker/            optional separate host using same modules
  Studio.Domain/            project/story/workflow/media domain types
  Studio.Application/       commands, queries, orchestration ports
  Studio.Infrastructure/    EF Core, files, process runner, secrets
  Studio.Providers/         compiled provider adapters
  Studio.Web.UI/            React/TypeScript
```

Avoid one project per tiny module. If domain/application split creates circular pressure, group by feature folders inside a smaller number of assemblies. The important boundary is dependency direction, not project count.

## ASP.NET Core

- Localhost binding by default; explicit opt-in for LAN access.
- OpenAPI for frontend/provider diagnostics.
- Range-enabled asset streaming endpoints; no raw file-server exposure.
- Built-in health checks for DB/workspace/worker/FFmpeg and configured providers.
- Structured logging and problem-details errors.

A full authentication system is unnecessary for localhost V1. If LAN binding is enabled later, authentication becomes mandatory before release.

## EF Core and SQLite

- Explicit transactions around aggregate + invalidation changes.
- WAL, foreign keys, busy timeout; short-lived `DbContext` per command/worker operation.
- Compiled/projection queries only where profiling shows need.
- Do not lazy-load large navigation graphs/chapter bodies.
- Migrations begin during implementation, but none are created in this design phase.

Dapper/raw SQL may be used only for the atomic claim query if EF cannot express it safely; keep it behind the workflow repository. Do not mix data-access styles broadly.

## Worker/process execution

Use `System.Diagnostics.Process` argument lists, no shell. Redirect bounded output, pass cancellation, terminate process tree, and set explicit environment/working directory. FFmpeg progress parser and Python sidecar lifecycle are infrastructure adapters.

Web+worker may share one process for the first milestone. Support a separate worker executable early enough to isolate long FFmpeg/GPU work, but do not require Windows services, containers, or orchestration.

## Frontend choices

- React Router for project tabs/routes.
- A small server-state library is optional; do not introduce global state machinery until polling/edit caching needs it.
- Native HTML media elements for playback.
- Accessible component primitives rather than a huge design system.
- Generate API types from OpenAPI or maintain one deliberate DTO layer; avoid duplicating domain entities into UI.

## Python boundary

Python is appropriate for WhisperX, F5-TTS, GPT-SoVITS, and ComfyUI-adjacent ML, not for the whole application. Prefer stable local HTTP APIs for stateful GPU models and one-shot CLI for small tools. Pin environments separately, health-check versions, exchange JSON/file assets, and let .NET own projects/workflows/costs.

## Packaging

V1 can be developer-run/self-contained .NET plus Node-built static assets and a configured FFmpeg path. Do not bundle large Python models by default. A later installer can manage optional provider packs and license notices after adapter behavior stabilizes.

## Alternatives

### Blazor

Single-language appeal, but React is stronger for rich editing/media UI and matches a clean API boundary. Blazor remains viable if the developer values one language more than ecosystem breadth; it does not change backend architecture.

### Python backend

Would simplify direct ML imports but weaken the stated .NET maintainability goal and mix GPU/model lifetime with business orchestration. Sidecars give the needed Python access without that cost.

### PostgreSQL + broker

Technically stronger concurrent claiming, operationally unnecessary for one local user. Introduce only with remote/multi-worker requirements.

### Desktop shell

Useful for installer/file dialogs/tray behavior later, not required for the first local web application. Avoid Electron memory/packaging cost until browser limitations are real.

## Decision: .NET owns orchestration

- **Alternatives:** all-Python app; TypeScript full stack.
- **Why:** matches developer expertise and long-term domain/workflow complexity while preserving access to AI tools through adapters.
- **Trade-offs:** process/service integration and two frontend/backend toolchains.
- **Future impact:** provider processes can change languages independently; business rules remain stable.
