# Architecture

AI Story Studio is a modular monolith with one SQLite-backed worker.

```text
apps/web -> apps/api -> packages/workflow -> packages/database
                              |             -> packages/media
                              `------------- packages/shared
apps/worker -> packages/workflow -> packages/database/media
apps/omp-agent (Bun) <- bounded NDJSON -> packages/workflow (Node)
```

- `apps/web`: React/Vite authoring UI, review-first Story controls, paginated long-story views, and job polling.
- `apps/api`: Fastify composition root, thin validated routes, Story Engine scheduling, and safe OMP readiness.
- `apps/worker`: one polling worker with heartbeat, lease recovery, retry, and graceful shutdown.
- `packages/shared`: Zod transport schemas, Story schemas, IDs, status enums, DTOs, and safe application errors.
- `packages/database`: Drizzle schema, additive migrations, SQLite connection, and repositories for revision chains, StoryState, continuity, and batches.
- `packages/media`: managed workspace, path safety, SHA-256 streaming, process runner, FFmpeg, and ffprobe.
- `packages/workflow`: Story Engine services, deterministic bounded context compilation, prompts, OMP boundary, durable scheduling, batch orchestration, TTS, subtitles, and render orchestration.
- `apps/omp-agent`: isolated Bun-only OMP SDK host. It communicates through a versioned NDJSON protocol and never writes SQLite or project files.

The Story Engine owns settings, blueprint, stable characters, dynamic CharacterState, arcs, plan windows, summaries, threads, facts, events, continuity lineage, and generation provenance. Stories up to 20 chapters may use the existing project-wide plan. Larger stories use ordered gap-free arcs and 10-25 chapter planning windows, defaulting to 20.

Accepted V2 chapter finalization writes chapter text, summary, StateDelta, reduced StoryState, normalized continuity records, lineage, nullable usage, and generation metadata in one SQLite transaction. The worker completes the workflow step only after that transaction succeeds. Previous revisions remain available for diagnosis and rebuild.

The Story Engine never starts TTS, subtitles, background generation, or rendering automatically. Manual chapter edits and explicit media handoff remain authoritative. Historical regeneration preserves later content and media while marking later generated narrative lineage stale.

The OMP host receives one bounded request, disables MCP/LSP/extensions/tools, creates an in-memory isolated session, emits progress and one terminal result/error, and disposes the session. OMP credentials and provider payloads remain outside Studio persistence.

The API binds to loopback by default. Process execution passes executable arguments separately with `shell: false`. Errors returned to clients are safe application errors; internal stack traces stay in structured logs.
