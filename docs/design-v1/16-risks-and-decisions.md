# Risks and Architecture Decisions

## Decision register

### ADR-001 — Modular monolith

- **Decision:** One .NET application/solution with explicit modules; web and worker may be separate run modes, not services.
- **Alternatives:** microservices; desktop monolith with work in UI process.
- **Why:** one developer/local deployment needs minimal operations and one transactional authority.
- **Trade-offs:** modules require discipline without network enforcement; one database limits distributed scale.
- **Future impact:** extract only a proven resource/deployment boundary, keeping application contracts.

### ADR-002 — SQLite metadata, filesystem assets

- **Decision:** EF Core/SQLite stores transactional metadata; immutable media/text artifacts use managed files.
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

### ADR-006 — Capability-based provider adapters

- **Decision:** compiled interfaces for LLM/TTS/ASR/image/video/translation; local/free first, paid fallback only by explicit configuration.
- **Alternatives:** provider-specific workflow branches; dynamic plugin framework; provider microservices.
- **Why:** provider replacement/cost control without premature extension complexity.
- **Trade-offs:** a common contract can hide unique features; capability flags and native extensions need care.
- **Future impact:** adapters can move to sidecars/remote services without workflow changes.

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

### ADR-009 — React SPA served locally

- **Decision:** React/TypeScript UI over ASP.NET API; polling first.
- **Alternatives:** Blazor; Electron; server-rendered forms.
- **Why:** rich chapter editing, media playback, virtual lists, and status dashboard without desktop packaging.
- **Trade-offs:** second language/toolchain; native filesystem features use API endpoints.
- **Future impact:** desktop wrapper or remote hosting remains possible.

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
| “Deterministic render” mistaken for byte identity | Medium/low | define determinism as recorded inputs/timeline/args/environment; software encoder default; validate semantic output. |

## Deferred decisions with triggers

- **PostgreSQL/broker:** only with multi-machine workers or measured SQLite contention.
- **SignalR:** after polling/status projections work; needed only for lower-latency updates.
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
