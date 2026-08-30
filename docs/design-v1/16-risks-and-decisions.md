# Risks and Architecture Decisions

## Decision register

### ADR-001 - TypeScript-first modular monolith

- **Decision:** One pnpm workspace with explicit TypeScript modules and three local applications: React/Vite web, Fastify API, and a persisted Node.js worker. These are run modes of one modular monolith, not services.
- **Alternatives:** ASP.NET Core/.NET solution; microservices; desktop monolith with work in the UI process.
- **Why:** one developer and local deployment need minimal operations, while one primary language/toolchain enables practical sharing of stable contracts, validation, domain vocabulary, and tooling across frontend and backend.
- **Trade-offs:** package boundaries require discipline without network enforcement; Node.js requires deliberate isolation of CPU-heavy processes; one database limits distributed scale.
- **Future impact:** extract only a proven resource or deployment boundary, keeping application contracts and TypeScript orchestration authoritative.

### ADR-002 — SQLite metadata, filesystem assets

- **Decision:** Drizzle ORM with SQLite stores transactional metadata; immutable media/text artifacts use managed files.
- **Alternatives:** PostgreSQL; BLOBs; filesystem JSON only.
- **Why:** simple local installation and efficient multi-gigabyte media.
- **Trade-offs:** DB/files cannot commit atomically; backup and reconciliation span both.
- **Future impact:** logical asset store and repositories permit object storage/PostgreSQL later.

### ADR-003 — Workflow steps are persisted queue units

- **Decision:** Materialized dependency steps, attempts, leases, checkpoints, fingerprints, and lineage provide execution and queue semantics.
- **Alternatives:** linear pipeline; generic job framework plus separate workflow; event sourcing.
- **Why:** chapter/chunk retry and exact invalidation require fine-grained authoritative state.
- **Trade-offs:** custom state-machine/claim code; cycle/idempotency tests are load-bearing.
- **Future impact:** scenes/shots/evaluations become new node types; remote transport can carry step IDs.

### ADR-004 — Revisioned inputs and immutable outputs

- **Decision:** edits/regeneration create revisions/assets and move current pointers.
- **Alternatives:** overwrite; whole-project snapshots; full event sourcing.
- **Why:** reproducible generation and stale-output explanation need exact historical inputs.
- **Trade-offs:** storage growth and cleanup UI.
- **Future impact:** candidate generation/evaluation can compare revisions without schema replacement.

### ADR-005 — Bounded structured story context

- **Decision:** compile blueprint, relevant characters, summaries, plan, and unresolved events into a recorded `GenerationContext`.
- **Alternatives:** send all story text; embeddings now; agent memory/knowledge graph.
- **Why:** explainable, low-cost continuity for long stories without building V4 early.
- **Trade-offs:** omitted subtle facts; summary extraction quality matters.
- **Future impact:** fact/vector/world-bible retrievers plug into the same context-item output.

### ADR-006 - Capability-based TypeScript provider adapters

- **Decision:** TypeScript interfaces for LLM/TTS/ASR/image/video/translation; local/free first, paid fallback only by explicit configuration.
- **Alternatives:** provider-specific workflow branches; dynamic plugin framework; Python-first provider orchestration; provider microservices.
- **Why:** provider replacement and cost control without premature extension complexity, while allowing Node-native, HTTP, ComfyUI, Python sidecar, or subprocess implementations.
- **Trade-offs:** a common contract can hide unique features; capability flags, runtime validation, and versioned sidecar contracts need care.
- **Future impact:** adapter implementations can move between runtimes or processes without changing workflow definitions.

### ADR-007 — Segment-first TTS and known-text subtitles

- **Decision:** stable text segments packed into retryable TTS chunks; V1 captions use provider/segment timing, WhisperX optional.
- **Alternatives:** unlimited chapter TTS; ASR every output; character-count interpolation.
- **Why:** reliable limits/retries and exact subtitle wording at no added inference cost.
- **Trade-offs:** segment joins/timing granularity; more manifests/files.
- **Future impact:** word timing, karaoke, character voices, and alignment enrich segments/cues.

### ADR-008 — Neutral timeline, FFmpeg renderer

- **Decision:** immutable timeline manifest compiles to recorded FFmpeg arguments and validated MP4.
- **Alternatives:** MoviePy workflow; raw FFmpeg commands in steps; browser renderer.
- **Why:** efficient long-duration local render and clean separation from visual planning.
- **Trade-offs:** filter graphs/timebases/progress parsing are specialized work; exact bytes vary by build/encoder.
- **Future impact:** AI images/video are clip producers; render contract survives.

### ADR-009 - React/Vite SPA over Fastify

- **Decision:** React/TypeScript UI built with Vite over a Fastify API; polling persisted status first.
- **Alternatives:** full-stack server-rendered framework; Electron/Tauri; server-rendered forms.
- **Why:** rich chapter editing, media playback, virtual lists, and status dashboards with one TypeScript toolchain and a clean local API boundary.
- **Trade-offs:** native filesystem features use API endpoints; shared types require deliberate DTO boundaries rather than exposing backend internals.
- **Future impact:** a desktop wrapper or remote hosting remains possible without replacing the SPA or application modules.

### ADR-010 - Replace .NET with TypeScript/Node.js

- **Status:** accepted before application implementation.
- **Decision:** replace the ASP.NET Core, EF Core, and `.NET BackgroundService` baseline with Node.js, TypeScript, Fastify, Drizzle ORM, a persisted Node.js worker, React, Vite, and a pnpm workspace.
- **Why the decision changed:** the product now prioritizes a TypeScript-first architecture so frontend and backend can share one language, tooling, selected validation schemas, stable DTO contracts, identifiers, enums, and workflow/provider vocabulary. This reduces context switching and duplicate boundary definitions while preserving the existing modular-monolith and local-first decisions.
- **Advantages:** one primary toolchain and lockfile; practical reuse of Zod schemas and DTO types; consistent domain vocabulary; direct React/Fastify integration; broad Node SDK and HTTP ecosystem; simpler contributor onboarding for a TypeScript codebase.
- **Disadvantages:** Node.js is less suitable for CPU-heavy work inside the event loop; child-process tree termination and local packaging need platform-specific care; TypeScript type sharing can accidentally couple UI, domain, and persistence; the ecosystem has more competing conventions than the previous .NET baseline.
- **Python interoperability:** Python remains optional. Prefer native Node integration, external HTTP APIs, or an existing service API such as ComfyUI. Use a small isolated Python sidecar for F5-TTS, WhisperX, PyTorch, Transformers, Diffusers, or another model/library only when Python is substantially easier or the only practical runtime. Use versioned request/response contracts. Node.js owns workflow, retries, projects, assets, and orchestration; Python owns model loading and inference.
- **Future impact:** future AI runtimes can change behind provider contracts without moving the product backend to Python. Remote workers or PostgreSQL remain triggered by real concurrency requirements, not by this language decision.

## Risk register

| Risk | Likelihood/impact | Mitigation / decision trigger |
|---|---|---|
| Imported adaptation remains too similar or unauthorized | High legal/product impact | Rights acknowledgement; source isolation; structural transformation brief; do not claim legal originality; later similarity evaluator is advisory. |
| Edge TTS service/protocol/terms change | Medium/high | Adapter boundary, health checks, pinned version, F5-TTS/local alternative; never make Edge format part of domain. |
| GPL/LGPL obligations accidentally enter product | Medium/high | No copied reference code; SBOM/notices; wrapper/process boundary review; explicit legal decision before distribution. |
| Provider/model license differs from code license | Medium/high | Record provider/model/checkpoint identifiers and terms; user-supplied models; distribution review. |
| SQLite lock contention | Low in V1/medium impact | WAL, busy timeout, short transactions, few worker lanes; measure before PostgreSQL. |
| DB/file split leaves orphan/missing media | Medium/medium | staged atomic rename, hash/probe before DB commit, startup reconciliation, coordinated backup. |
| Duplicate paid/provider execution after crash | Medium/high | idempotency keys, remote job checkpoint, leases/heartbeats, explicit “outcome unknown” error instead of blind retry. |
| LLM structured output invalid/truncated | High/medium | JSON schema, bounded repair attempt, finish-reason validation, fail visibly, preserve raw diagnostic safely. |
| Continuity lost through summaries | Medium/medium | explicit event/character selection, context inspection/pinning, review warning; add fact retrieval only from evidence. |
| Editing early chapter conflicts with later frozen chapters | Medium/medium | V1 preserves later work per invalidation requirement and surfaces continuity-review warning; user chooses regeneration range. |
| TTS chunk joins sound inconsistent | Medium/medium | punctuation-aware segments, consistent voice/settings, pause/crossfade policy, audio validation, optional local provider. |
| Subtitle timing is not word-perfect | High/low for V1 | disclose segment timing; use provider boundaries; optional WhisperX alignment; structured cue schema. |
| Three-hour render fails late | Medium/high | validate/probe inputs first, manifest, disk-space check, FFmpeg progress/logs, staging, deterministic retry. Optional future segmented render. |
| Hardware encoder changes output/fails | Medium/medium | libx264 default; hardware explicit; record encoder/build; probe validation and safe fallback only before run. |
| GPU contention/OOM between TTS/ASR/image | Medium/high later | resource-class lanes, one GPU job by default, model sidecars, actionable resource error—not unlimited retries. |
| Disk usage grows through immutable intermediates | High/medium | storage dashboard, retention classes, explicit cleanup, estimates before batch; never auto-delete current/source. |
| Secrets leak in DB/log/export | Low/high | OS secret store references, redaction, safe DTOs, restricted diagnostic assets, localhost binding. |
| Localhost app exposed to LAN without auth | Low/high | bind localhost by default; enabling non-loopback requires authentication/security design. |
| Provider costs surprise user | Medium/high | cost tier badges, estimates/unknown state, per-batch confirmation/caps, no silent paid fallback, actual usage ledger. |
| Node.js event loop blocked by CPU-heavy work | Medium/high | Keep FFmpeg and model work out of process; worker orchestrates and observes rather than performing heavy compute in-process. |
| Shared TypeScript types leak persistence into UI | Medium/medium | Share only Zod DTO schemas, identifiers, enums, statuses, and safe capabilities; keep Drizzle rows and domain internals private. |
| Python sidecar contract/version drift | Medium/medium | Version and validate both sides; expose health/model versions; pin environments; keep managed-file and cancellation semantics explicit. |
| Child process tree survives cancellation | Medium/high | Central process runner, shell disabled, graceful then forced tree termination, and real platform smoke checks before release. |
| “Deterministic render” mistaken for byte identity | Medium/low | define determinism as recorded inputs/timeline/args/environment; software encoder default; validate semantic output. |

## Deferred decisions with triggers

- **PostgreSQL/broker:** only with multi-machine workers or measured SQLite contention.
- **Push transport:** after polling/status projections work; needed only for lower-latency updates.
- **Desktop wrapper:** when installer, tray, or file-dialog limitations become material.
- **Vector database:** when structured relational context misses measured continuity cases.
- **General plugin system:** when third-party providers require independent distribution and a security/versioning model exists.
- **Segmented final rendering:** when observed long-render failure cost justifies concat-safe render partitions.
- **Automatic quality loop:** after objective validators and hard budget/attempt limits exist.

## Review gates before implementation

1. Confirm adaptation/legal language and source isolation.
2. Confirm TTS first provider boundary and distribution approach.
3. Prototype SQLite atomic claim/lease semantics and file commit/reconciliation.
4. Prototype one long chapter through Edge TTS, SRT, timeline, FFmpeg, ffprobe.
5. Confirm default codecs/fonts on target OS and distribution license notices.
6. Only then expand story generation and 100-chapter scheduling.
