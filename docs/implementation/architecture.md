# Architecture

AI Story Studio is a modular monolith with one SQLite-backed worker.

```text
apps/web -> apps/api -> packages/workflow -> packages/database
                              |             -> packages/media
                              `------------- packages/shared
apps/worker -> packages/workflow -> packages/database/media
apps/omp-agent (Bun) <- bounded NDJSON -> packages/workflow (Node)
```

- `apps/web`: React/Vite authoring UI, review-first Story, Scenes, Visual Bible controls, paginated long-story views, and job polling.
- `apps/api`: Fastify composition root, thin validated routes, Story, Scene, and Visual Consistency scheduling, and safe OMP readiness.
- `apps/worker`: one polling worker with heartbeat, lease recovery, retry, and graceful shutdown for Story, Scene, Visual Consistency, and media steps.
- `packages/shared`: Zod transport schemas, Story/Scene/Visual schemas, IDs, status enums, DTOs, and safe application errors.
- `packages/database`: Drizzle schema, additive migrations, SQLite connection, and repositories for revision chains, StoryState, scenes, visual profiles, prompt packages, continuity, and batches.
- `packages/media`: managed workspace, path safety, SHA-256 streaming, process runner, FFmpeg, and ffprobe.
- `packages/workflow`: Story, Scene, and Visual Consistency services, deterministic bounded context compilation, prompts, OMP boundary, durable scheduling, batch orchestration, TTS, subtitles, and render orchestration.
- `apps/omp-agent`: isolated Bun-only OMP SDK host. It communicates through a versioned NDJSON protocol and never writes SQLite or project files.

The Scene Engine owns chapter-to-scene visual planning, source ranges, locations,
scene-local character state, and scene provenance. The Visual Consistency
Service owns canonical visual profiles, the project Style Bible, object
resolution, deterministic Visual Prompt Packages, and scoped visual
invalidation. Neither owns image-provider behavior or pixel generation.

The Story Engine owns settings, blueprint, stable characters, dynamic CharacterState, arcs, plan windows, summaries, threads, facts, events, continuity lineage, and generation provenance. Stories up to 20 chapters may use the existing project-wide plan. Larger stories use ordered gap-free arcs and 10-25 chapter planning windows, defaulting to 20.

Accepted V2 chapter finalization writes chapter text, summary, StateDelta, reduced StoryState, normalized continuity records, lineage, nullable usage, and generation metadata in one SQLite transaction. Scene planning follows the same durable boundary: one chapter-level plan call commits all validated scenes atomically before the worker completes the step. Previous revisions remain available for diagnosis and rebuild.

Scene plans depend on exact chapter revisions and selected Story context. Chapter or Story setting/blueprint changes mark dependent scene structures stale; Style Bible, approved location, approved character, approved object, and Scene object-resolution changes mark only matching Visual Prompt Packages stale. Visual invalidation never touches Scene structure, StoryState, TTS, subtitles, backgrounds, renders, unrelated projects, or historical revisions.

The Story Engine never starts TTS, subtitles, background generation, or rendering automatically. The Scene Engine never starts image generation. Manual chapter/scene edits and explicit media handoff remain authoritative. Historical regeneration preserves later content and media while marking later generated narrative lineage stale.

The OMP host receives one bounded request, disables MCP/LSP/extensions/tools, creates an in-memory isolated session, emits progress and one terminal result/error, and disposes the session. OMP credentials and provider payloads remain outside Studio persistence.

The API binds to loopback by default. Process execution passes executable arguments separately with `shell: false`. Errors returned to clients are safe application errors; internal stack traces stay in structured logs.
