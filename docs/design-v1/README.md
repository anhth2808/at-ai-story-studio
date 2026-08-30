# AI Story Studio V1 Design

## Executive decision

Build V1 as a **TypeScript-first local modular monolith** in a pnpm workspace: React/TypeScript with Vite, a Fastify API, a persisted Node.js worker, Drizzle ORM with SQLite, versioned assets on the local filesystem, and FFmpeg/ffprobe.

The API and worker are independently runnable applications that share explicit domain, workflow, database, provider, and media modules. Fastify routes stay thin; SQLite is job truth; long work runs in the worker. Use Zod for runtime boundary validation where useful and share stable DTO schemas, IDs, enums, workflow statuses, and provider identifiers without exposing Drizzle rows or internal domain objects to the UI.

Python is not the main backend. Prefer native Node integration, an external HTTP API, or an existing service API such as ComfyUI. Add a versioned Python sidecar or controlled subprocess only when a model/library such as F5-TTS, WhisperX, PyTorch, Transformers, or Diffusers is substantially easier or only practical in Python. Node.js retains workflow, project state, retries, asset tracking, and orchestration.

V1's required path is deliberately narrow:

```text
Idea or owned/imported story
→ analysis/blueprint
→ chapter plans and chapters
→ cleaned, segmented narration text
→ chapter audio
→ segment subtitles
→ background visual + optional music
→ FFmpeg timeline render
→ validated MP4
```

No AI image or AI video provider is required to ship V1. The stable seams are story events, assets, workflow dependencies, providers, and a neutral timeline—not microservices or a general plugin platform.

## Product outcome

A single user can create a project, generate a new story or adapt a story they are authorized to use, review/edit chapters, generate or retry chapter audio, inspect subtitle status, choose a simple background, and render a long YouTube-ready MP4. Progress and errors survive restart. Editing chapter 5 invalidates chapter 5 audio/subtitles and the final render, not unrelated story work.

## Key decisions

| Area | V1 decision | Reason |
|---|---|---|
| Shape | TypeScript-first modular monolith in a pnpm workspace | One local deployment and shared tooling; module and process seams remain explicit. |
| Web/API | React + Vite over Fastify | Strong editor/media UI and a small typed HTTP composition boundary with thin routes. |
| Persistence | SQLite in WAL mode + Drizzle ORM | Appropriate for one machine and one local worker; typed schema and explicit migrations. |
| Assets | Immutable versioned files + metadata/lineage in SQLite | Large media does not belong in database blobs; hashes make staleness explainable. |
| Jobs | Persisted Node.js worker claiming SQLite workflow steps with leases | Restart-safe without Redis, BullMQ, RabbitMQ, or Kafka. |
| Shared contracts | Zod DTO schemas, IDs, enums, statuses, provider identifiers | Reuse stable boundaries without leaking persistence or domain internals into UI. |
| Story context | Blueprint + relevant characters + prior summaries + unresolved events + current plan | Maintains continuity without sending the whole story. |
| TTS | Stable text segments and independently retryable chunks | Provider limits and one failed chunk do not force full chapter regeneration. |
| Subtitle | TTS segment timing first; WhisperX optional | Fast, free, deterministic text; alignment remains an upgrade path. |
| Render | Manifest-driven FFmpeg/ffprobe through a shell-free process runner | Deterministic argument construction, cancellation, progress, and broad codec support. |
| Providers | TypeScript capability contracts; local/free → cheap → premium | Workflow logic stays provider-neutral and costs remain controllable. |

## Document map

1. [Product scope](00-product-scope.md)
2. [System architecture](01-system-architecture.md)
3. [Domain model](02-domain-model.md)
4. [Story engine](03-story-engine.md)
5. [Workflow engine](04-workflow-engine.md)
6. [Provider architecture](05-provider-architecture.md)
7. [Asset management](06-asset-management.md)
8. [TTS pipeline](07-tts-pipeline.md)
9. [Subtitle pipeline](08-subtitle-pipeline.md)
10. [Render and visual engine](09-render-engine.md)
11. [Database design](10-database-design.md)
12. [Background jobs](11-background-jobs.md)
13. [UI design](12-ui-design.md)
14. [Technology stack](13-technology-stack.md)
15. [Reference reuse](14-reference-reuse.md)
16. [Future roadmap](15-future-roadmap.md)
17. [Risks and decisions](16-risks-and-decisions.md)

## Smallest implementation sequence

**Question:** If one developer starts implementing tomorrow, what is the smallest sequence from zero to the first automatically generated YouTube-ready story video?

| Milestone | Deliverable | Exit check |
|---|---|---|
| **M0 - Executable skeleton** | pnpm workspace, React/Vite shell, Fastify API, SQLite/Drizzle connection, Node.js worker, FFmpeg/ffprobe health checks, local workspace. | UI reports API, database, worker, and FFmpeg healthy. |
| **M1 — Projects and assets** | Create/edit project; import story or manually enter one chapter; upload background/music; immutable asset records. | Project survives restart and imported files pass hash/probe validation. |
| **M2 — Durable workflow** | Persisted executions, dependency steps, attempts, leases, progress, cancellation, retry, invalidation, event log. | A deliberately interrupted sample step resumes; editing chapter text invalidates only descendants. |
| **M3 — Narration vertical slice** | Text cleaning, caption segments, TTS chunk manifest, first Edge TTS adapter, independent chunk retry, FFmpeg audio merge. | A long chapter becomes playable chapter audio; one failed chunk retries alone. |
| **M4 — Subtitles** | SRT from known text segments and measured audio durations; subtitle preview/download. | Captions cover the chapter audio with valid monotonic timestamps. |
| **M5 — Video render** | Timeline builder, uploaded video/image loop, narration/music mix, subtitle burn, FFmpeg progress, ffprobe validation. | A manually authored chapter produces a YouTube-compatible MP4. |
| **M6 - Story generation** | Add the thin `AiAgent` -> `OmpAgent` -> OMP SDK boundary, then generate/analyze blueprint, characters, plans, chapters, summaries, and events through configured OMP models/providers with Zod-validated outputs. | Chapter 27 can be generated from bounded recorded context. |
| **M7 — Full automation** | Pipeline command from idea/import through every chapter, audio, subtitles, timeline, and final MP4; overview/retry UI. | A new project reaches validated MP4 without manual media assembly and can recover from restart/failure. |

This order proves the risky media and persistence path with manual text before adding nondeterministic LLM behavior. Image generation, voice cloning, ASR alignment, and publishing remain post-V1 options.
