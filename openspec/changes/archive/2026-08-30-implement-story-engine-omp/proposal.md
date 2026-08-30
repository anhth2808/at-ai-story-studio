## Why

The first working video pipeline is complete, but projects still require manually authored chapter text. This change adds the Story Intelligence layer above the existing media factory so a user can generate reviewable story structure and chapters from an idea while preserving SQLite-owned workflow state, independent retries, precise invalidation, and the existing TTS/subtitle/render path.

## What Changes

- Add a small revisioned story configuration for idea-based generation mode only.
- Add structured story blueprint, character, story thread, chapter plan, chapter summary, and generation-context records.
- Add a thin application-owned `AiAgent` boundary with an OMP-backed implementation using the current OMP SDK API.
- Isolate the Bun-only OMP SDK runtime behind a typed local protocol so Node remains authoritative for API, worker, persistence, and orchestration.
- Add versioned, testable prompt templates for blueprint, chapter-plan, and chapter-generation operations.
- Add schema-validated structured generation results and safe generation metadata.
- Add compact deterministic continuity context for chapter generation without sending all previous chapter prose.
- Extend the existing durable workflow with independently retryable blueprint, chapter-plan, chapter, and summary steps.
- Add scoped revision invalidation for story configuration, blueprint, chapter plans, generated chapters, summaries, and affected media descendants.
- Integrate generated chapters with the existing normal chapter entity and user editing flow without automatically starting TTS.
- Expand the Story UI with configuration, blueprint, characters, chapter plans, chapter generation, review/edit, retry, and explicit send-to-TTS actions.
- Add OMP configuration and setup documentation using the current documented SDK authentication/model configuration mechanism.
- Add fake-boundary tests and one real OMP-backed smoke path; do not add adaptation, scraping, RAG, embeddings, vector storage, or future visual AI stages.

## Capabilities

### New Capabilities

- `story-creative-state`: Revisioned story configuration, blueprint, characters, story threads, chapter plans, summaries, and generated chapter metadata.
- `story-ai-generation`: Structured blueprint, plan, chapter, summary generation, prompt versions, bounded context compilation, validation, and generation metadata.
- `omp-integration`: OMP SDK execution boundary, Bun host/local protocol, configuration, authentication visibility, cancellation, timeout, and observability.
- `story-engine-ui`: Reviewable Story tab and explicit generation controls integrated with persisted workflow status.

### Modified Capabilities

- `project-and-chapter-management`: Associate idea-generation configuration with projects and make AI-generated chapters ordinary revisioned chapters while preserving manual authoring and V1 media behavior.
- `durable-workflow-jobs`: Materialize Story AI workflow steps in the existing execution, attempt, lease, retry, cancellation, and invalidation system.

## Impact

- Affects `apps/api`, `apps/web`, `apps/worker`, `packages/shared`, `packages/database`, and `packages/workflow`; adds a small Bun OMP host and typed protocol package or module.
- Adds database migrations for story configuration and creative state plus AI generation metadata.
- Adds an OMP SDK dependency only in the isolated Bun host; it must not leak OMP types into Node application contracts.
- Existing projects and the current manual TTS/subtitle/render pipeline remain usable and are not redesigned.
- Real AI generation requires Bun 1.3.14 or newer, the current OMP SDK package, an authenticated configured model/provider, and network or local model availability according to that provider.
- Mode B adaptation and all advanced story/video capabilities remain out of scope.
