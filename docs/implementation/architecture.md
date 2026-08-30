# Architecture

The application is a modular monolith with one database-backed worker.

```text
apps/web -> apps/api -> packages/workflow -> packages/database
                              |             -> packages/media
                              `------------- packages/shared
apps/worker -> packages/workflow -> packages/database/media
```

- `apps/web`: React/Vite authoring UI, review-first Story controls, and persisted job polling.
- `apps/api`: Fastify composition root, thin validated routes, Story Engine scheduling, and safe OMP readiness.
- `apps/worker`: one polling worker with heartbeat, lease recovery, retry, and graceful shutdown.
- `packages/shared`: Zod transport schemas, Story schemas, IDs, status enums, DTOs, and safe application errors.
- `packages/database`: Drizzle schema, migrations, SQLite connection, and repositories for V1 and Story revision chains.
- `packages/media`: managed workspace, path safety, SHA-256 streaming, process runner, FFmpeg, and ffprobe.
- `packages/workflow`: Story Engine application services, bounded context compilation, prompt rendering, OMP boundary, text preparation, Edge TTS provider boundary, durable scheduling, execution, subtitle generation, and render orchestration.
- `apps/omp-agent`: isolated Bun-only OMP SDK host. It communicates with Node through a bounded NDJSON protocol and never writes Story state.

The Story Engine owns settings, blueprint, characters, chapter plans, summaries, threads, context, prompts, validation, and generation provenance. It writes accepted generated text into the normal `chapters` aggregate with source lineage. It never starts TTS, subtitles, background, or rendering automatically. Manual chapter edits remain authoritative and block silent regeneration.

The OMP host receives one validated request, disables MCP/LSP/extensions/tools, creates an in-memory isolated session, emits bounded progress/result/error events, and disposes the session before exit. OMP credentials and provider payloads remain outside Studio persistence.

The API binds to loopback by default. Process execution passes executable arguments separately with `shell: false`. Errors returned to clients are safe application errors; internal stack traces stay in structured logs.
