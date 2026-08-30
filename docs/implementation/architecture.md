# Architecture

The application is a modular monolith with one database-backed worker.

```text
apps/web -> apps/api -> packages/workflow -> packages/database
                              |             -> packages/media
                              `------------- packages/shared
apps/worker -> packages/workflow -> packages/database/media
```

- `apps/web`: React/Vite authoring and persisted job polling.
- `apps/api`: Fastify composition root and thin validated routes.
- `apps/worker`: one polling worker with heartbeat, lease recovery, retry, and graceful shutdown.
- `packages/shared`: Zod transport schemas, IDs, status enums, DTOs, and safe application errors.
- `packages/database`: Drizzle schema, migration, SQLite connection, and repositories.
- `packages/media`: managed workspace, path safety, SHA-256 streaming, process runner, FFmpeg, and ffprobe.
- `packages/workflow`: text preparation, Edge TTS provider boundary, durable scheduling, execution, subtitle generation, and render orchestration.

Dependencies are directed inward. Provider and process details do not appear in HTTP handlers. User media stays on the filesystem; SQLite stores metadata, workflow state, lineage, hashes, and current-role pointers.

The API binds to loopback by default. Process execution passes executable arguments separately with `shell: false`. Errors returned to clients are safe application errors; internal stack traces stay in structured logs.
