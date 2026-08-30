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

### ADR-006 - Capability-based specialized provider adapters

- **Decision:** Keep explicit TypeScript interfaces for TTS, ASR, image, video, and translation capabilities, with local/free first and paid fallback only by explicit configuration. LLM and agent execution follows ADR-011 instead of an application-owned provider hierarchy.
- **Alternatives:** provider-specific workflow branches; dynamic plugin framework; Python-first provider orchestration; provider microservices; routing specialized media through OMP.
- **Why:** specialized media capabilities need explicit asset, duration, format, model-runtime, and process semantics that an agent execution layer does not replace.
- **Trade-offs:** a common specialized contract can hide unique features; capability flags, runtime validation, and versioned sidecar contracts need care.
- **Future impact:** specialized adapters can move between Node-native, HTTP, ComfyUI, Python sidecar, or subprocess implementations without changing workflow definitions; LLM model/provider changes remain behind `OmpAgent`.

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
- **Future impact:** future specialized AI runtimes can change behind provider contracts, and OMP models/providers can change behind the thin `AiAgent` boundary, without moving the product backend to Python or transferring durable orchestration to OMP. Remote workers or PostgreSQL remain triggered by real concurrency requirements, not by this language decision.

### ADR-011 - Use OMP SDK as the primary LLM/agent execution layer

- **Status:** accepted.
- **Decision:** Intelligent application features call a thin application-owned `AiAgent` contract whose primary implementation is `OmpAgent`; `OmpAgent` delegates LLM and agent execution to OMP SDK and returns only validated feature data plus safe execution metadata. Feature, domain, and workflow code do not import OMP SDK types.
- **Execution ownership:** one OMP session belongs to one durable AI attempt. AI Story Studio remains the source of truth for jobs, attempts, retries, dependencies, invalidation, fingerprints, cost policy, assets, project persistence, and result commits. OMP session history is optional bounded diagnostics, not workflow state.
- **Structured output:** a state-changing result must be terminal and pass the feature-owned Zod schema before entering application or domain state. Invalid, incomplete, truncated, refused, timed-out, or cancelled output becomes a normalized failed attempt.
- **Scope boundary:** OMP does not replace TTS, ASR/WhisperX, image/video APIs, ComfyUI execution, FFmpeg/ffprobe, filesystem, database, job execution, or the workflow state machine.
- **Runtime boundary:** the current official SDK documentation requires Bun 1.3.14 or newer and states that it is not a Node.js SDK. Node.js remains the primary application runtime, so a small isolated Bun-hosted `OmpAgent` process runs OMP SDK until an officially supported in-process option fits the approved runtime.
- **Alternatives:** direct OMP SDK imports throughout feature code; an application-owned `OpenAIProvider`/`GeminiProvider`/`AnthropicProvider`/`DeepSeekProvider`/`OllamaProvider` hierarchy; direct provider SDKs; treating a long-lived OMP conversation as workflow state; routing all specialized media through OMP.
- **Why:** OMP already supplies broad model/provider and agent capability. One thin boundary adds testing, configuration, observability, timeouts, error translation, and a future escape hatch without rebuilding another LLM framework.
- **Trade-offs:** OMP becomes a load-bearing pinned dependency; SDK evolution requires compatibility testing; the current Bun-only runtime adds a supervised process; coding-agent discovery and tools must be restricted for product use; structured output still requires independent validation.
- **Future impact:** future tasks such as story analysis, adaptation, blueprint generation, character extraction, chapter planning/writing, summarization, continuity analysis, scene/shot planning, prompt generation, and quality evaluation use the same boundary. Add another implementation only when a concrete unmet requirement justifies the escape hatch.

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
| OMP-backed structured output is invalid, incomplete, or truncated | High/medium | Require a terminal result; validate with the feature-owned Zod schema; allow only an explicitly bounded repair attempt; preserve safe diagnostics; fail visibly rather than persist partial state. |
| Continuity lost through summaries | Medium/medium | explicit event/character selection, context inspection/pinning, review warning; add fact retrieval only from evidence. |
| Editing early chapter conflicts with later frozen chapters | Medium/medium | V1 preserves later work per invalidation requirement and surfaces continuity-review warning; user chooses regeneration range. |
| TTS chunk joins sound inconsistent | Medium/medium | punctuation-aware segments, consistent voice/settings, pause/crossfade policy, audio validation, optional local provider. |
| Subtitle timing is not word-perfect | High/low for V1 | disclose segment timing; use provider boundaries; optional WhisperX alignment; structured cue schema. |
| Three-hour render fails late | Medium/high | validate/probe inputs first, manifest, disk-space check, FFmpeg progress/logs, staging, deterministic retry. Optional future segmented render. |
| Hardware encoder changes output/fails | Medium/medium | libx264 default; hardware explicit; record encoder/build; probe validation and safe fallback only before run. |
| GPU contention/OOM between TTS/ASR/image | Medium/high later | resource-class lanes, one GPU job by default, model sidecars, actionable resource error—not unlimited retries. |
| Disk usage grows through immutable intermediates | High/medium | storage dashboard, retention classes, explicit cleanup, estimates before batch; never auto-delete current/source. |
| Secrets or story content leak through OMP events, telemetry, DB, logs, or export | Low/high | OS/OMP secret storage references, metadata-only observability by default, provider-payload redaction, safe DTOs, restricted diagnostic assets, localhost binding. |
| Localhost app exposed to LAN without auth | Low/high | bind localhost by default; enabling non-loopback requires authentication/security design. |
| OMP model/provider costs surprise user | Medium/high | Cost tier badges, estimates/unknown state, per-batch confirmation/caps, configured fallback chains only, no silent paid fallback, record effective model/provider and actual usage when exposed. |
| Node.js event loop blocked by CPU-heavy work | Medium/high | Keep FFmpeg and model work out of process; worker orchestrates and observes rather than performing heavy compute in-process. |
| Shared TypeScript types leak persistence into UI | Medium/medium | Share only Zod DTO schemas, identifiers, enums, statuses, and safe capabilities; keep Drizzle rows and domain internals private. |
| Python sidecar contract/version drift | Medium/medium | Version and validate both sides; expose health/model versions; pin environments; keep managed-file and cancellation semantics explicit. |
| Child process tree survives cancellation | Medium/high | Central process runner, shell disabled, graceful then forced tree termination, and real platform smoke checks before release. |
| OMP SDK upgrade breaks the adapter | Medium/high | Pin the SDK and Bun versions; review changelogs; run compatibility checks for session creation, configuration, restricted capabilities, structured output, lifecycle, events, and errors before upgrading. |
| Bun-hosted OMP adapter is unavailable or exits mid-attempt | Medium/high | Supervised process, health/version check, bounded restart policy, durable attempt failure/recovery in the Node.js worker, no OMP-owned workflow state. |
| OMP discovery exposes unintended tools or ambient project context | Medium/high | Explicit headless configuration, restricted tool allowlist, disable ambient skills/context/commands/extensions/MCP/LSP/subagents unless a reviewed feature requires them. |
| OMP cancellation returns while provider/tool work continues | Medium/high | Propagate deadline and `AbortSignal`, call session abort, await bounded disposal, then terminate the isolated process when graceful shutdown fails. |
| OMP dependency becomes unsuitable for a required feature | Low/high | Keep the `AiAgent` contract narrow and application-owned; add a replacement implementation only after a concrete incompatibility or missing capability is demonstrated. |
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
7. Before implementing the first intelligent feature, prototype the pinned OMP SDK through the restricted Bun-hosted adapter and verify structured output, cancellation, disposal, observability, and durable-attempt ownership.
