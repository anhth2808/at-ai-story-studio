## Why

AI Story Studio needs a reviewed V1 product and architecture baseline before implementation begins. The design must make long-running story-to-video production resumable, local-first, cost-aware, and evolvable from audio stories to novel-to-movie workflows without importing reference-application architecture or source code wholesale.

## What Changes

- Define the V1 product boundary for generated and adapted long-form stories.
- Define a modular-monolith architecture using ASP.NET Core, SQLite, EF Core, a database-backed worker, provider adapters, local filesystem assets, and FFmpeg.
- Specify the story, workflow, provider, asset, TTS, subtitle, visual, render, database, job, and UI models.
- Document dependency-driven invalidation, resumability, deterministic rendering, and cost-tiered provider selection.
- Classify all ten reference projects as LEARN FROM, WRAP, REIMPLEMENT, OPTIONAL, or DO NOT USE with license implications.
- Define an incremental path from V1 audio stories through future novel-to-movie generation.
- Produce the requested architecture package under `docs/design-v1/`; no application code, migrations, or provider implementations are included.

## Capabilities

### New Capabilities

- `ai-story-studio-v1-design`: Complete, implementation-ready architecture and product design for the first AI Story Studio release, including its forward-compatible evolution path.

### Modified Capabilities

- None.

## Impact

- Adds architecture documentation under `docs/design-v1/`.
- Adds OpenSpec planning artifacts under `openspec/changes/ai-story-studio-v1-design/`.
- Does not modify reference repositories or implement runtime application behavior.
- Establishes future contracts for application modules, persisted entities, external-process adapters, and media artifacts.
