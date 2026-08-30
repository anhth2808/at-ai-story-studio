## Context

See `proposal.md` for motivation. The repository currently contains reference-source research and recommendations, not an application. The requested output is a reviewed architecture package; implementation is explicitly deferred. The product starts as a single-user local tool, but media operations can run for hours and must survive process restarts.

## Goals / Non-Goals

**Goals:**
- Produce a coherent V1 contract across product, domain, workflows, providers, assets, media, persistence, jobs, and UI.
- Make the smallest V1 practical on one workstation while keeping stable seams for image, animation, and AI-video stages.
- Convert research evidence into license-aware build, wrap, and avoid decisions.
- Give one developer an ordered path to the first end-to-end video.

**Non-Goals:**
- Application code, migrations, executable provider adapters, prompts, or FFmpeg scripts.
- Multi-user SaaS, distributed execution, publication automation, or advanced novel memory.
- AI image/video generation in the required V1 path.

## Decisions

1. **Documentation is the deliverable.** The detailed design lives under `docs/design-v1/`; OpenSpec records the behavior contract and change boundary.
2. **Modular monolith first.** ASP.NET Core hosts API and a database-backed worker; React is a static SPA. Modules communicate through application services and persisted IDs, not network services.
3. **SQLite plus filesystem.** SQLite stores transactional metadata and state. Versioned media/text blobs live under a managed project workspace and are addressed by hashes.
4. **Workflow steps are durable work items.** A persisted dependency graph, attempts, leases, checkpoints, fingerprints, and asset lineage provide restart, retry, progress, cancellation, and precise invalidation.
5. **Context is compiled, not accumulated.** Chapter generation assembles a bounded `GenerationContext` from structured story records and summaries. The selected context snapshot is retained for traceability.
6. **Provider contracts are capability-oriented.** Provider-specific SDKs, local Python processes, and cloud APIs are adapters. Workflow steps consume normalized requests/results.
7. **TTS and subtitles are segment-first.** Cleaned text becomes stable segments/chunks. Each chunk is independently generated and timed; V1 subtitles use known TTS segments, with WhisperX alignment optional.
8. **Rendering is manifest-driven.** A neutral timeline and immutable input hashes compile to a recorded FFmpeg invocation. Temporary output is validated before atomic publication.
9. **References are evidence, not a codebase.** MIT/BSD projects may be wrapped where useful; GPL/LGPL boundaries are explicit; no reference source is copied during design.

Detailed decisions, alternatives, trade-offs, and future impact are in `docs/design-v1/16-risks-and-decisions.md` and the relevant topic documents.

## Risks / Trade-offs

- SQLite limits write concurrency; V1 deliberately uses short transactions and few worker lanes.
- Local filesystem and database commits cannot be atomic together; staged writes plus hash validation and reconciliation are required.
- LLM and TTS outputs are nondeterministic even when orchestration is deterministic; manifests make retries auditable, not magically identical.
- User-provided adaptation raises rights and similarity risks; the system transforms structure and isolates source text but cannot guarantee legal originality.
- Local AI tools may require Python/GPU environments; isolating them behind process or HTTP adapters protects the .NET core at operational cost.
- Long-form media consumes disk and compute; asset retention, cleanup, and resource-class concurrency must be visible.
