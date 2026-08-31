## Why

The current Story Engine can generate a small blueprint, one all-at-once chapter plan, and isolated chapters, but it has no durable narrative checkpoint or batch coordinator for a 20-200 chapter story. Later chapters therefore cannot reliably resume after failure, preserve evolving character/thread state, or explain which future chapters became unsafe after an old chapter changes. This milestone is needed now to make the existing OMP-backed text workflow reliable at long-story scale without expanding the working TTS, subtitle, or render pipeline.

## What Changes

- Add a compact, revisioned StoryState owned by the application, including dynamic character state, active story threads, important facts, recent events, rolling progress summary, and current arc/phase.
- Add lightweight StoryArc records and hierarchical planning for stories over 20 chapters, with configurable planning windows instead of one giant detailed-plan response.
- Extend chapter generation to use a deterministic, explainable GenerationContext V2 that selects relevant characters, state, threads, facts, events, summaries, and future arc direction within a configurable budget; never concatenate the complete prior story.
- Replace prose-only chapter acceptance with validated structured chapter metadata and StateDelta proposals, then apply them through a deterministic StoryState reducer before marking a chapter complete.
- Add durable checkpoints/revisions and conservative continuity semantics: regenerating an old chapter creates a new revision and marks later AI-generated chapters `CONTINUITY_STALE` without deleting their content or media.
- Add sequential persisted batch generation for next-N, range, and until-end requests, with per-chapter retryability, duplicate scheduling protection, restart recovery, failure pause, and explicit skip records.
- Add stable input fingerprints covering story revisions, state checkpoints, prompt/schema versions, and generation settings so completed valid chapters are reused and changed inputs create new revisions.
- Add optional continuity checks, structured warnings/issues, manual chapter analysis, and explicit continuity rebuild actions without an autonomous regeneration loop.
- Add nullable AI usage/cost persistence and optional project/batch guardrails; unavailable provider usage remains unavailable rather than being fabricated.
- Extend the Story API and Story workspace with long-story progress, arc/plan coverage, batch controls, filtered chapter statuses, continuity-stale/warning visibility, and retry/rebuild/analyze actions.
- Keep all intelligent operations behind the existing thin OMP boundary and preserve review-first chapter editing plus explicit TTS handoff. Do not add image/video generation, vector search, embeddings, RAG, graph storage, or multi-chapter rendering.
- Add migration-safe persistence, deterministic fake-agent scale tests through 200 chapters, restart/failure/regeneration/transaction tests, context-size measurements, and a bounded real OMP sequential smoke test where configuration permits.

## Capabilities

### New Capabilities

- `long-story-continuity`: Compact StoryState, dynamic character state, story arcs, typed threads/facts/events, bounded relevance-selected context, state reduction, checkpoints, continuity checks, stale propagation, and manual continuity analysis/rebuild.
- `story-generation-batches`: Persisted sequential chapter batches with range/next/until-end controls, per-chapter progress, resume, failure pause, explicit skip, duplicate protection, and batch-level status.
- `ai-usage-and-budgets`: Provider-independent nullable AI usage records and optional project/batch generation guardrails that never fabricate unavailable cost data.

### Modified Capabilities

- `story-creative-state`: Extend story settings/planning and chapter metadata with arc/window planning, StoryState lineage, dynamic state, continuity status, and scoped stale behavior.
- `story-ai-generation`: Add GenerationContext V2, structured StateDelta/chapter results, reducer-owned persistence, arc/window/analyze/continuity operations, bounded context diagnostics, and classified failures.
- `durable-workflow-jobs`: Coordinate sequential batch chapters with durable checkpoints, pause-on-failure, explicit skip, idempotent scheduling, and transactional chapter finalization while preserving existing leases/retries/recovery.
- `story-engine-ui`: Add long-story dashboard, batch controls, arc/plan coverage, chapter status table/filtering, continuity warnings/stale actions, and usage/progress visibility.
- `project-and-chapter-management`: Preserve ordinary chapter/media behavior while exposing continuity-stale state and explicit rebuild/analyze choices after manual edits or old-chapter regeneration.
- `omp-integration`: Route the additional long-story operations through the existing isolated OMP protocol and retain bounded provenance/usage/error mapping without leaking SDK types.

## Impact

Affected areas are `packages/shared` schemas and DTOs, `packages/database` Drizzle schema/repositories/migrations, `packages/workflow` Story Engine/context/prompts/reducer/batch orchestration and tests, `apps/api` Story routes, `apps/web` Story workspace, `apps/worker` durable execution, `apps/omp-agent` operation contracts, and `docs/implementation` long-story documentation. Existing projects must migrate in place; existing manual chapters and TTS/subtitle/render workflows remain usable and are not automatically regenerated. No new direct provider client or distributed queue is introduced. Real OMP verification depends on the documented Bun SDK/runtime and configured model, while all 200-chapter mechanics are proven with a deterministic fake agent.