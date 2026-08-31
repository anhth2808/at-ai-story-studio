# Long-story generation

The Story Engine has two planning paths:

- Stories with 20 or fewer target chapters may use the existing project-wide chapter plan.
- Stories over 20 chapters use hierarchical planning: blueprint -> arcs -> bounded plan windows -> sequential chapter generation.

The long-story path is text and continuity intelligence only. It does not enqueue TTS, subtitles, backgrounds, or rendering.

## Hierarchical planning

An arc is a durable revisioned artifact with a stable ID, ordinal position, inclusive chapter range, goal, conflict, planned outcome, and references to blueprint characters and known threads. Arc ranges must be ordered, gap-free, and cover chapters 1 through the configured target.

A plan window belongs to one current arc and contains every chapter item in its inclusive range. Window ranges must stay inside the arc, contain no gaps or duplicate stable IDs, and respect `generation.planningWindow`. The default is 20 chapters; the configured value is constrained to 10-25. A previous window contributes only a compact boundary summary to the next planning prompt.

The application rejects all-at-once chapter plans for stories over 20 chapters. This prevents a legacy full-plan record from silently bypassing arcs and windows. Existing small-story plan records remain compatible.

## Generation lifecycle

1. Save validated story settings and generate a blueprint.
2. For a long story, generate and review the ordered arcs.
3. Generate plan windows as needed. A window can be regenerated without rewriting other windows.
4. Create a batch for a contiguous chapter range. The batch materializes one durable workflow step per chapter in ascending order.
5. When a worker claims a chapter, it compiles bounded GenerationContext V2 from the current StoryState and updates the running fingerprint before calling OMP.
6. Accept the structured chapter envelope only after schema validation, reducer validation, and one SQLite finalization transaction succeed.
7. Choose a separate narration action when the chapter text is ready. Story generation never starts media work automatically.

## API surfaces

The Fastify API exposes settings, blueprint, arcs, plan windows, batches, StoryState, continuity checks, usage summaries, and bounded context diagnostics under `/api/projects/:projectId/story`. Batch items, chapters, summaries, usage, and context diagnostics have selective reads or pagination parameters. The snapshot is intended for dashboard aggregates, not a 200-chapter prose dump.

## Operational bounds

- Target chapters: 1-200.
- Planning window: 10-25, default 20.
- Context budget: 500-10,000 estimated tokens, default 5,000.
- Batch size: controlled by `maxChaptersPerBatch`.
- Generated output and state records are revisioned. Previous revisions remain available for diagnosis and rebuild.

No vector database, embeddings, RAG retrieval, graph database, or full-prose prompt assembly is used. Relevance is deterministic and explainable through context diagnostics.
