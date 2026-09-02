## Context

See `proposal.md` for motivation and the delta specifications for the observable contract. The repository already has a Node/TypeScript modular monolith with Fastify, React/Vite, SQLite in WAL mode, a single lease-based worker, revisioned Story settings/blueprint/plans/summaries/threads, and the working chapter-to-TTS/subtitle/render pipeline. `StoryEngine` currently accepts one blueprint, one all-at-once plan, and one chapter envelope at a time. `story-context.ts` bounds serialized sections but currently admits prior summaries as one collection and has no persistent state checkpoint, arc/window model, batch coordinator, or continuity lineage. The isolated Bun host already owns the OMP SDK and communicates with Node through a typed NDJSON protocol.

The design must preserve ordinary chapter editing, existing workflow statuses, retry/recovery, and explicit media handoff. The long-story layer is text and continuity intelligence only. SQLite remains the source of truth; an OMP session is never a project-state store.

## Goals / Non-Goals

**Goals:**

- Add a compact canonical continuity memory that can be reduced and rebuilt deterministically.
- Make 20-200 chapter generation sequential, durable, resumable, independently retryable, and observable.
- Keep chapter prompts bounded by a configurable budget with explainable selection diagnostics.
- Preserve stable blueprint characters while storing dynamic state and typed thread/fact/event history.
- Add hierarchical arc and planning-window support without breaking the existing <=20 chapter path.
- Extend the current OMP boundary with typed long-story operations, safe usage propagation, and bounded error categories.
- Make old-chapter regeneration and manual edits conservative: preserve content/media history, mark future continuity stale, and require explicit user action for rebuild or re-analysis.
- Prove scale with deterministic fake-agent simulations and a small real OMP sequential smoke path when credentials and a model are available.

**Non-Goals:**

- No vector database, embeddings, semantic retrieval, RAG framework, graph database, or full world-bible engine.
- No images, video, scene graphs, shot planning, image-to-video, WhisperX, F5-TTS, ComfyUI, publishing, or multi-chapter render work.
- No direct provider SDK in Node, second queue/broker, distributed lock service, or multi-agent swarm.
- No autonomous continuity-failure regeneration loop.
- No automatic TTS, subtitles, background generation, or rendering after story generation.
- No silent recomputation of future chapters after a manual edit or old-chapter regeneration.

## Decisions

### 1. Keep the existing small-story path and add a long-story path

Use the current `story_settings_revisions`, `story_blueprint_revisions`, `story_plan_revisions`, and `story_plan_items` for stories with 20 or fewer target chapters. For larger stories, retain those records for global settings and blueprint compatibility, then add revisioned arc and plan-window records rather than changing the meaning of the existing project-wide current-plan pointer.

A long-story plan window contains a bounded inclusive range, its arc source, stable plan-item IDs, source blueprint revision, optional prior-window boundary summary, and generation metadata. The API returns window coverage and paginated items; it does not synthesize a 200-item response for every dashboard request. A plan window can be regenerated independently, but a chapter generation fingerprint always names the exact window revision and plan-item revision it consumed.

This avoids a destructive schema reinterpretation of the current plan tables. It also lets existing three-chapter projects continue to use the current prompts and API behavior while `targetChapterCount > 20` opts into `ARC_PLANNING`, `CHAPTER_PLAN_WINDOW`, and `CHAPTER_GENERATION_V2`.

### 2. Use compact snapshots plus per-chapter deltas for StoryState

Add additive persistence with these logical records:

- `story_state_revisions`: immutable compact snapshot, project, revision, checkpoint chapter number, source chapter ID/revision, previous state revision, current marker, status, and timestamps.
- `story_state_deltas`: immutable normalized StateDelta proposal, project, source chapter ID/revision, source generation/analysis ID, target state revision, validation status, and timestamps.
- `story_character_states`: current project-local dynamic state keyed by stable blueprint character ID. Keep query-critical scalar fields relational (`location`, `current_goal`, `power_level`, `last_updated_chapter`) and bounded arrays/maps such as injuries, possessions, relationships, and knowledge as validated JSON columns. The latest snapshot remains the rebuild source of truth.
- `story_important_facts`: stable fact ID, bounded fact text, importance, introduced and last-confirmed chapter, status, and source state revision.
- `story_events`: event ID, chapter number, bounded summary/type, importance, and validated character/thread ID arrays.

The full snapshot is intentionally compact and is written once per accepted chapter, not after every prompt or UI operation. At 200 chapters this is a bounded number of small records and makes rollback/rebuild straightforward. A snapshot payload has explicit field limits enforced by Zod before SQL writes. `storyProgressSummary` is deterministically compacted from the prior summary, the new chapter summary, arc milestones, and high-importance facts to a fixed character budget; it is never the canonical source for facts.

The current pointer advances only in the same SQLite transaction as chapter acceptance. A failed reducer, reference check, or snapshot write leaves the previous pointer current. A chapter completion checkpoint therefore consists of the chapter row/revision, summary row, normalized delta, current dynamic state, fact/event/thread revisions, snapshot, usage record, and generation record update. The workflow step is marked complete only after that transaction returns successfully.

### 3. Extend, do not replace, the existing thread model

Keep `story_threads` and `story_thread_revisions` as the stable project-local identity and audit chain. Extend the validated payload and, where useful for filtering, add relational columns for title, type, status, importance, introduced/last-touched/expected-resolution/resolved chapter. Existing `OPEN` and `RESOLVED` rows are migrated to the expanded status vocabulary without deleting history. New and updated threads are always validated against the blueprint characters and current chapter.

Thread transitions are proposals in StateDelta. The reducer accepts only known IDs for updates, creates a new thread only when the delta explicitly supplies a bounded new-thread record, and rejects an update that attempts to create an unknown character or silently re-key a thread. Existing current thread revisions remain inspectable.

### 4. Model arc revisions and planning windows as separate durable artifacts

Add `story_arc_revisions` with project, stable arc ID, ordinal index, chapter range, title, goal, conflict, important character/thread IDs, planned outcome, status, source blueprint revision, input fingerprint, metadata, current marker, and timestamps. Add `story_plan_window_revisions` and `story_plan_window_items` with the same current-pointer and stable-item pattern as the existing plan tables.

`generateArcs` uses the blueprint and settings to return only high-level arcs. The application validates ordered, gap-free coverage of chapters 1 through the target. `generateChapterPlanWindow` accepts one arc/window and only the compact previous-window boundary needed to maintain handoff continuity. The default window is 20 chapters and is constrained to the configured 10-25 range. A project can request a smaller valid window, but the application rejects an unbounded window.

Manual arc edits create a new revision. The dependency service marks affected plan windows and chapter-generation work stale or invalidated according to source linkage; it preserves prior arc and chapter records.

### 5. Build GenerationContext V2 with candidate ranking before serialization

Implement a pure context compiler that consumes repositories and returns both the serialized sections and diagnostics. It must not load chapter prose for normal chapter generation. Candidate selection is deterministic:

1. Reserve the current plan item and blueprint essentials.
2. Select the current arc and its planned outcome.
3. Select characters explicitly named by the plan, present in the immediately relevant summaries/events, or referenced by selected active threads. Attach their stable definitions and current CharacterState.
4. Include the previous accepted summary, then a small recent-summary window.
5. Rank threads by explicit plan reference, high importance, expected resolution proximity, participant overlap, and last-touched recency. Include active `OPEN` and `PROGRESSING` threads first; include terminal threads only when the plan explicitly references them.
6. Select facts and events linked to selected characters/threads, then high-importance recent records.
7. Add visible skipped-chapter/gap markers and explicit user instructions.
8. Apply budget priority in this order: plan item, blueprint essentials, previous summary, critical threads, current CharacterState, current arc, recent summaries, relevant facts/events, lower-ranked optional records.

Every candidate carries a stable source identifier, source revision, selection reason, token estimate, and omission reason. Serialization uses stable key ordering for fingerprints. If required content alone cannot fit the configured budget, the operation returns `CONTEXT_ERROR` rather than slicing arbitrary JSON. Optional content is dropped by whole candidate/section in the stated order. The compiler reports `estimatedTokens`, budget, selected character/thread counts, recent summaries included, omitted sections, truncation/compression, and source revision IDs.

The existing `compileGenerationContext` remains available for the <=20 compatibility path and summary generation. V2 is selected by target size or an explicit long-story operation. Summary generation may receive the target chapter prose under its existing bounded size limit; chapter generation never receives all prior prose.

### 6. Use a pure reducer and explicit finalization boundary

Define application-owned schemas for `ChapterResult`, `StoryStateDelta`, dynamic character updates, thread updates/new threads, facts, events, location changes, arc progress, and continuity checks. The OMP adapter returns transport text and nullable provenance; the Story Engine parses and validates the operation result before calling the reducer.

The reducer takes a prior immutable snapshot and a validated delta and returns a new snapshot plus normalized records. Its deterministic order is:

1. Validate all character, thread, arc, and chapter references against the current blueprint and source checkpoint.
2. Apply character updates keyed by stable character ID.
3. Apply new and existing thread changes, with terminal transitions taking precedence over progress for the same thread in one delta.
4. Upsert deduplicated important facts and append bounded events with source chapter lineage.
5. Advance arc progress and the current chapter pointer.
6. Compact the rolling summary deterministically and trim recent events to the configured bound.

`finalizeGeneratedChapter` wraps chapter revision write, summary/delta persistence, reducer output, thread/fact/event updates, continuity lineage, usage, and generation-record completion in one better-sqlite3 transaction. A workflow step is not completed by the Story Engine itself; the worker calls the existing workflow completion transition only after finalization succeeds. If the process exits after finalization but before workflow completion, recovery sees the matching chapter/state fingerprint and completes the step idempotently without another AI call.

### 7. Store continuity lineage separately from workflow/media status

Add `continuity_status` and source-state lineage to the chapter/story lineage surface, or an equivalent indexed `story_chapter_lineage` table, rather than overloading the existing workflow status. Use at least `CURRENT`, `CONTINUITY_STALE`, and `NOT_ANALYZED`; store continuity-check PASS/WARN/FAIL separately so a warning does not look like a failed workflow.

On accepted regeneration of chapter N:

- create the next chapter revision and its accepted summary/delta;
- set the current StoryState pointer to the new checkpoint after N, leaving prior checkpoints available;
- mark later AI-generated chapters whose stored source state revision is at or after the changed lineage as `CONTINUITY_STALE`;
- preserve later chapter content, generation records, and media assets;
- invalidate only chapter N's direct summary/media descendants when its content changed, using the existing invalidation path;
- pause or invalidate pending future batch work until the user explicitly chooses rebuild/regeneration.

On a manual edit, keep the existing summary and direct-media invalidation. If the edited chapter has no accepted structured delta, retain the last valid checkpoint before it, mark that chapter and affected later AI chapters for continuity review, and expose an analysis/rebuild gap. Do not silently infer or apply state.

A user choice to keep stale chapters changes only the review disposition and leaves the stale marker visible. A rebuild starts from the last valid checkpoint before the requested chapter and applies only deltas whose source chapter revision and source state revision still match. The first missing or unsafe delta stops the rebuild and leaves that suffix stale. An analyzed manual chapter is persisted as a proposal first; explicit acceptance creates the next current checkpoint.

### 8. Represent batches as orchestration over existing workflow steps

Add `story_generation_batches` and `story_generation_batch_items`. The batch row stores project, inclusive start/end, request mode, status (`PENDING`, `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED`), totals, counters, timestamps, and safe error. Each item stores chapter number, stable plan-item ID/window revision, workflow step ID, outcome (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, `CANCELLED`), input fingerprint once prepared, failure/skip reason, and timestamps.

At batch creation, validate range, target, plan coverage, guardrails, and overlap. Materialize the selected per-chapter `GENERATE_CHAPTER` steps in ascending order and link each step to its predecessor with a required dependency. The initial fingerprint for future steps is a deferred batch marker; when a worker claims a chapter, it builds V2 context from the then-current StoryState and updates the running step fingerprint before invoking OMP. Thus state changes from chapter 21 cannot be hidden by fingerprints calculated at batch creation.

The batch item and workflow step are reconciled after each terminal transition. A failure pauses the batch and leaves later dependencies pending. Retry resets only the failed item/step after current-input validation. Explicit skip records `SKIPPED` in the batch item, keeps the failure reason, marks the skipped workflow step cancelled, and changes only the immediate successor dependency to non-required so the chain can continue with a visible gap marker. It is never counted as generated content. Cancellation stops future claims and propagates to the active step.

The existing atomic workflow claim/lease remains the concurrency boundary. Scheduling also performs a SQLite transaction check for an active chapter lock keyed by project and plan item; duplicate individual or batch requests reuse the existing pending/running work or return a conflict. Failed historical work can be retried after the lock is released. The batch API rejects overlapping active ranges unless every overlap is already completed with a matching fingerprint.

### 9. Extend the OMP protocol without leaking SDK types

Extend the application operation enum and Bun host allowlist with `ARC_PLANNING`, `CHAPTER_PLAN_WINDOW`, `CHAPTER_GENERATION_V2`, `STATE_ANALYSIS`, `CONTINUITY_CHECK`, and, if used as a separate operation, `SUMMARY_COMPACTION`. Keep the existing four operations working for compatibility. Add versioned prompt/schema identifiers and structured contracts for each new result.

`AiAgent` remains application-owned. The Node side sends only the bounded system/user prompts, operation, model, deadline, fingerprint, and schema version over NDJSON. The Bun host continues to create one in-memory isolated session, disables tools/MCP/LSP/extensions, subscribes before prompting, emits one terminal result, and disposes in `finally`. It must never write SQLite or project files.

Inspect the current SDK event payload for usage fields at implementation time. If `agent_end` or the provider result exposes input/output tokens or cost, map bounded values into the protocol and `AiAgentResult`; if not, send null. Never derive exact cost from prompt length and never fail a valid generation because usage is unavailable. Map host/provider/protocol/timeout/cancel/context/structured-output failures to stable application categories. A valid continuity-check FAIL is a structured result, not a provider retry.

### 10. Keep generation metadata and budget controls additive

Extend settings validation with long-story configuration using defaults that preserve existing projects: planning window, context budget, continuity-check enabled flag, maximum chapters per batch, maximum estimated tokens per operation, maximum retries, optional budget, and budget currency. Store only safe model/provider references and numeric usage data.

Add `ai_usage` keyed to project, generation record, operation, entity, and attempt. Keep the existing generation metadata shape compatible, adding nullable currency/finish information only where useful. Usage writes are part of the same finalization transaction for a successful result; failed attempts still receive a bounded usage row when the boundary supplied one. Budget checks use known estimates and aggregate known usage. Unknown cost/token values never block basic generation and remain null in UI/API responses.

### 11. Add thin API surfaces and selective reads

Keep Fastify routes as validation and service calls. Add routes for:

- arc generation/list/edit;
- plan-window generation and paginated plan-window reads;
- batch creation, status, retry, skip, and cancel;
- continuity rebuild and manual chapter analysis;
- optional continuity-check scheduling and result reads;
- bounded usage/context diagnostics.

Extend the story snapshot with counts and the current blocking chapter, but avoid returning all summaries/jobs/prose for a 200-chapter project. Add `limit`/`offset` or chapter-number range parameters for plans, chapters, summaries, batch items, and usage. Existing snapshot fields remain compatible for small projects; long-story dashboard calls use selective endpoints.

The web Story workspace adds the minimal dashboard, arc cards, batch buttons, filterable chapter table, stale/warning actions, and usage diagnostics. It keeps the current review-first editor and explicit narration action. All new visible copy is Vietnamese; machine enum values remain in API data.

### 12. Use one additive migration and preserve old installations

Create the next numbered migration after `0003_story_continuity_outputs.sql` and register it in `migrateDatabase`. Add tables, indexes, chapter lineage/status columns, settings-compatible payload support, and any trigger updates without dropping existing story/media tables. Backfill only safe structural defaults: existing threads remain available with expanded default fields, existing chapters retain manual/generated origin and receive a non-stale continuity status, and no media asset is deleted.

Initialize StoryState lazily for existing projects from the latest valid generated chapter checkpoint or from an empty pre-chapter state. Do not run an OMP call during migration. If a current generated chapter lacks a valid delta, expose a rebuild/analyze prerequisite instead of inventing state.

Rollback is application-level: deploy the prior application against the additive schema while retaining new tables/columns. Do not reset or recreate the database. A future destructive migration is outside this change.

## Risks / Trade-offs

- [Context omissions can reduce narrative quality] -> Use deterministic relevance ranking, retain canonical facts/state separately, record omission diagnostics, and test sentinel facts at chapters 10/50/100/200.
- [A 200-row batch can create many workflow records] -> Keep rows narrow, index project/chapter/status lookups, materialize only the requested range, and paginate dashboard reads.
- [A worker can die after domain commit but before workflow completion] -> Make finalization fingerprinted and idempotent; on recovery reconcile an existing matching checkpoint before invoking OMP again.
- [Skipped chapters can create false continuity] -> Persist a distinct batch-item skip outcome and inject an explicit gap marker into every downstream context; never count skip as generated content.
- [Manual edits have no trustworthy delta] -> Keep the last valid checkpoint current, mark the suffix stale, and require explicit analysis or rebuild acceptance.
- [OMP SDK usage events may differ by provider/version] -> Inspect documented/current event payloads, map only fields actually exposed, and preserve null usage without blocking generation.
- [Strict state validation can pause a batch] -> Classify malformed output separately from transient provider failure, allow bounded repair/retry, and expose the exact safe prerequisite/error.
- [Existing migration data may lack long-story lineage] -> Use additive defaults and lazy initialization; never fabricate historical state or delete media.
- [UI data can grow with story length] -> Return aggregate counts and paginated metadata, not all chapter prose, summaries, jobs, or assets in one request.
- [Separate continuity status can be confused with media invalidation] -> Keep explicit status fields and UI labels, preserve media on stale-only transitions, and test old-chapter regeneration separately from direct chapter edits.

## Migration Plan

1. Ship shared schemas/DTOs and repository support in a backward-compatible form.
2. Add and register the additive SQLite migration; run it automatically through the existing startup migration path and verify an existing database without resetting it.
3. Deploy workflow/Story Engine changes that continue supporting the current small-story operations and opt into long-story operations by target size or explicit request.
4. Deploy API/UI routes and dashboard reads after the worker understands every new step type.
5. Run fake-agent migrations and 20/200 chapter simulations, restart/failure/regeneration/transaction tests, existing Story tests, and TTS/media regression checks.
6. Run the real OMP sequential smoke path only when Bun, authentication, and a configured model are ready; record null usage when the provider does not expose it.

The migration is additive and the prior application can continue to read existing tables. Rollback of application code does not remove new state; rollback of a partially executed generation uses the prior current StoryState checkpoint and leaves staged/non-current records for diagnosis. No database reset is permitted.

## Open Questions

None. The default planning window is 20 chapters, continuity checks are opt-in, batch execution is sequential, state snapshots are checkpointed after accepted chapters, and stale future chapters are preserved until the user chooses a continuity action.