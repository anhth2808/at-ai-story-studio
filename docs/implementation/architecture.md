# Architecture

AI Story Studio is a modular monolith with one SQLite-backed worker.

```text
apps/web -> apps/api -> packages/workflow -> packages/database
                              |             -> packages/media
                              `------------- packages/shared
apps/worker -> packages/workflow -> packages/database/media
apps/omp-agent (Bun) <- bounded NDJSON -> packages/workflow (Node)
```

- `apps/web`: React/Vite authoring UI, review-first Story, Scenes, Visual Bible, Image Generation controls, paginated long-story views, and job polling.
- `apps/api`: Fastify composition root with thin validated Story, Scene, Visual Consistency, image, and media routes.
- `apps/worker`: one polling worker with heartbeat, lease recovery, retry, and graceful shutdown for Story, Scene, Visual Consistency, image, and media steps.
- `packages/shared`: Zod transport schemas, domain IDs, status enums, DTOs, and safe application errors.
- `packages/database`: Drizzle schema, additive migrations, SQLite connection, and repositories for revision chains, StoryState, Scenes, visual profiles, prompt packages, image generations, Assets, continuity, and batches.
- `packages/media`: managed workspace, path safety, SHA-256 streaming, image validation, process runner, FFmpeg, and ffprobe.
- `packages/workflow`: authoring services, deterministic bounded context compilation, OMP boundary, controlled ComfyUI provider, durable scheduling, TTS, subtitles, and render orchestration.
- `apps/omp-agent`: isolated Bun-only OMP SDK host. It communicates through a versioned NDJSON protocol and never writes SQLite or project files.

The Scene Engine owns chapter-to-scene visual planning, source ranges,
locations, scene-local character state, and scene provenance. The Visual
Consistency Service owns canonical visual profiles, the project Style Bible,
object resolution, deterministic Visual Prompt Packages, and scoped visual
invalidation. The Image Generation Service consumes one current package,
maps it to a controlled ComfyUI graph, and owns durable image revisions,
validation, Assets, freshness, candidate sets, structured quality review, and current
selection. Candidate sets group bounded generation attempts (1-4 per Scene request)
without changing the job model: each candidate stays an independently retryable image
revision, and multi-candidate results never auto-replace the Scene's current image -
explicit Accept atomically promotes review and current pointers. Feedback-aware
regeneration derives guidance deterministically from the persisted review and the
current Scene/package without LLM calls or canonical-data mutation. Reference conditioning reuses the same boundary: an explicit CharacterId-to-reference mapping derived from approved Visual Profile references is part of the request, fingerprint, and persisted metadata, and only the approved `reference-character-v1` native workflow conditions on references. Image providers do not
rebuild Story context or mutate canonical profiles.

The Story Engine owns settings, blueprint, stable characters, dynamic CharacterState, arcs, plan windows, summaries, threads, facts, events, continuity lineage, and generation provenance. Stories up to 20 chapters may use the existing project-wide plan. Larger stories use ordered gap-free arcs and 10-25 chapter planning windows, defaulting to 20.

Accepted V2 chapter finalization writes chapter text, summary, StateDelta, reduced StoryState, normalized continuity records, lineage, nullable usage, and generation metadata in one SQLite transaction. Scene planning follows the same durable boundary: one chapter-level plan call commits all validated scenes atomically before the worker completes the step. Previous revisions remain available for diagnosis and rebuild.

Scene plans depend on exact chapter revisions and selected Story context. Chapter or Story setting/blueprint changes mark dependent scene structures stale; Style Bible, approved location, approved character, approved object, and Scene object-resolution changes mark only matching Visual Prompt Packages stale. Visual invalidation never touches Scene structure, StoryState, TTS, subtitles, backgrounds, renders, unrelated projects, or historical revisions.

The Story Engine never starts TTS, subtitles, image generation, or rendering automatically. The Scene and Visual Consistency Engines never start image generation. Image generation never starts rendering or video work. Manual chapter/scene/image edits and explicit media handoff remain authoritative. Historical regeneration preserves later content and media while marking later generated narrative lineage stale.

The OMP host receives one bounded request, disables MCP/LSP/extensions/tools, creates an in-memory isolated session, emits progress and one terminal result/error, and disposes the session. OMP credentials and provider payloads remain outside Studio persistence.

The API binds to loopback by default. Process execution passes executable arguments separately with `shell: false`. Errors returned to clients are safe application errors; internal stack traces stay in structured logs.
