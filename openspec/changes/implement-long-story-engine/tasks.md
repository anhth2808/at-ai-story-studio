## 1. Contracts and configuration

- [x] 1.1 Extend `packages/shared/src/story.ts` with long-story settings, arc/window, CharacterState, StateDelta, fact/event, continuity, batch, usage, and lineage schemas; verify shared schema tests reject unknown references and preserve existing settings defaults
- [x] 1.2 Extend shared operation, continuity, batch, and safe-error DTOs in `packages/shared/src/index.ts` and story exports; verify existing Story/TTS/media type contracts still typecheck
- [x] 1.3 Extend the versioned OMP protocol schemas for long-story operations, nullable usage, and stable error categories; verify protocol parsing tests accept old and new terminal events and reject malformed events
- [x] 1.4 Add validated long-story generation settings for planning window, context budget, continuity checks, retry limits, batch limits, and optional budget; verify legacy projects parse with backward-compatible defaults

## 2. Database and repository foundation

- [x] 2.1 Add the next additive SQLite migration for arcs, plan windows, StoryState revisions/deltas, dynamic character state, facts, events, chapter continuity lineage, batches, batch items, usage, and continuity checks; verify migration succeeds against a copy of the current database without resetting existing rows
- [x] 2.2 Register the new migration and Drizzle table definitions in `packages/database/src/db.ts` and `packages/database/src/schema.ts`; verify fresh and migrated databases expose foreign keys, current pointers, uniqueness constraints, and query indexes
- [x] 2.3 Extend `StoryRepository` with selective reads and transactional writes for arcs, plan windows, StoryState checkpoints, CharacterState, threads, facts, events, chapter lineage, continuity checks, and usage; verify repository tests cover current-pointer and source-revision lineage
- [x] 2.4 Add `StoryBatchRepository` operations for creation, item status, progress counters, active-range checks, retry, skip, cancel, and reconciliation; verify concurrent duplicate requests cannot create two active records for one project-local chapter
- [x] 2.5 Add safe migration backfill and lazy StoryState bootstrap for existing projects without valid deltas; verify existing manual chapters, generated chapters, summaries, and media assets remain unchanged after migration

## 3. Canonical state and continuity reducer

- [x] 3.1 Implement a pure deterministic StoryState reducer for character updates, thread transitions, new threads, facts, events, arc progress, gap markers, and bounded rolling-summary compaction; verify reducer tests cover ordering, terminal thread precedence, deduplication, and unknown-reference rejection
- [x] 3.2 Integrate chapter finalization so chapter content, summary, StateDelta, canonical records, checkpoint, lineage, usage, and generation metadata commit atomically before workflow completion; verify an injected reducer failure leaves the prior checkpoint current and the chapter step non-complete
- [x] 3.3 Extend thread persistence from `OPEN`/`RESOLVED` to typed lifecycle/status records while preserving existing thread revisions; verify progress, resolve, abandon, and malformed transition behavior
- [x] 3.4 Add continuity lineage and `CONTINUITY_STALE` propagation for old generated chapter regeneration and manual edits; verify later content remains stored and later media is not invalidated by stale-only changes
- [x] 3.5 Implement explicit continuity rebuild from the last valid checkpoint and reviewable manual-chapter analysis acceptance; verify missing or unsafe deltas stop the rebuild and do not silently recompute future chapters

## 4. Bounded GenerationContext V2 and prompts

- [x] 4.1 Implement deterministic relevance candidate selection for plan characters, recent participants, active threads, expected resolution ranges, important facts, and recent events; verify selection reasons and source revisions are stable across repeated builds
- [x] 4.2 Implement budget-aware context compression that keeps required sections and drops optional candidates by priority; verify chapter 10, 50, 100, and 200 contexts stay within the configured bound without including full prior prose
- [x] 4.3 Add versioned arc-planning, chapter-window, chapter-generation-v2, state-analysis, and continuity-check prompt templates; verify fingerprints change on source revision or prompt version changes and preserve stable identifiers
- [x] 4.4 Add context diagnostics to generation metadata and API-safe results; verify omitted sections, selected counts, recent-summary counts, and truncation reasons are bounded and full prompts are not logged
- [x] 4.5 Add deterministic cost/budget guard checks around known estimates; verify configured limits reject over-limit batches/operations while unknown provider usage does not block basic generation

## 5. OMP boundary and operation execution

- [x] 5.1 Extend the application-owned `AiAgent` request/result contract and `OmpAgent` mapping for long-story operations, nullable usage, and classified failures; verify adapter tests preserve correlation, timeout, cancellation, and malformed-protocol behavior
- [x] 5.2 Extend `apps/omp-agent/src/index.ts` operation validation, prompt execution, usage extraction, and terminal event mapping using the documented SDK; verify the host remains tool/MCP/LSP isolated and disposes sessions on success, failure, timeout, and cancellation
- [x] 5.3 Keep provider/model provenance and available token/cost fields bounded and secret-free; verify a fake result with usage persists values and a result without usage persists nulls

## 6. Hierarchical planning

- [x] 6.1 Add `generateArcs` with validated ordered gap-free coverage for stories over 20 chapters; verify a 100-chapter fixture produces reviewable arc ranges and rejects overlaps or gaps
- [x] 6.2 Add bounded chapter-plan window generation linked to arc and blueprint revisions; verify windows in the configured 10-25 range generate independently and <=20 chapter projects retain the existing all-at-once path
- [x] 6.3 Add plan-window and arc manual-edit invalidation with prior revision preservation; verify only affected windows and chapter descendants become stale or invalidated
- [x] 6.4 Update Story Engine step execution and prompt fingerprints for arc/window planning; verify deferred planning jobs refresh fingerprints after prerequisites complete

## 7. Sequential batch workflow

- [x] 7.1 Add next-N, explicit-range, and until-end batch scheduling with target/plan/guardrail validation; verify the API creates one persisted batch and per-chapter workflow items before worker execution
- [x] 7.2 Materialize ascending chapter steps with predecessor dependencies, deferred input fingerprints, and project-local active-generation protection; verify duplicate individual/batch requests reuse or conflict instead of running the same chapter twice
- [x] 7.3 Update worker execution and batch reconciliation for per-chapter completed/failed/skipped counters, pause-on-failure, and resume after lease recovery; verify chapter 47 failure keeps 48 pending and retry does not rerun 1-46
- [x] 7.4 Implement explicit skip records and downstream gap markers without counting skipped chapters as generated; verify skipped chapter 47 preserves its failure reason and allows only the documented successor progression
- [x] 7.5 Make chapter finalization idempotent across a worker crash between domain commit and workflow completion; verify recovery reuses a matching completed fingerprint and does not invoke the AI boundary twice
- [x] 7.6 Add batch cancellation propagation and terminal status handling; verify cancellation preserves completed chapters and prevents later chapters from becoming complete

## 8. API and selective reads

- [x] 8.1 Add validated routes for arcs, plan windows, batches, batch retry/skip/cancel, continuity rebuild, manual chapter analysis, continuity checks, and usage/context diagnostics; verify invalid ranges, missing prerequisites, and cross-project identifiers return safe errors without creating work
- [x] 8.2 Extend story status responses with target/arc/plan/chapter/warning counts and current blocking chapter while adding pagination or range parameters for plans, summaries, chapters, batch items, and usage; verify a 200-chapter response does not load all prose or media assets
- [x] 8.3 Preserve existing Story settings, blueprint, plan, chapter, summary, TTS, subtitle, and render routes; verify current Story Engine and media API tests remain green

## 9. Story workspace

- [x] 9.1 Add Vietnamese long-story dashboard counts, batch controls, persisted progress, failure pause, retry, skip, cancel, and reload states in `apps/web/src/main.tsx`; verify browser interaction submits durable work and restores state after refresh
- [x] 9.2 Add paginated/filterable chapter table columns for plan, generation, continuity, summary, and audio status; verify FAILED, PENDING, CONTINUITY_STALE, and WARN filters show safe actions without loading every chapter body
- [x] 9.3 Add lightweight arc review/edit cards, continuity warning details, keep/rebuild/regenerate choices, and manual Analyze existing chapter flow; verify acceptance is explicit and future chapters are not silently overwritten
- [x] 9.4 Add bounded usage/context diagnostics and Vietnamese unavailable-value messaging; verify credentials, full prompts, and full novel text never appear in the UI response
- [x] 9.5 Preserve the existing review-first chapter editor and explicit TTS handoff; verify generated chapter completion does not enqueue TTS, subtitles, background work, or render work

## 10. Verification and documentation

- [x] 10.1 Add unit coverage for schemas, relevance ranking, context budgets, reducer invariants, thread lifecycle, stale propagation, and prompt fingerprints; verify each test fails for an unknown reference, unbounded context, or incorrect reducer order
- [x] 10.2 Add a deterministic 20-chapter integration scenario with sequential generation, character/thread/fact/event updates, checkpoints, and independent retry; verify completed chapters are not regenerated and media remains explicit
- [x] 10.3 Add a deterministic 200-chapter scale simulation covering plans, chapters, restart at 73, failure at 121, retry, continuation to 200, duplicate protection, and batch counters; verify no job loss and no full-history context growth
- [x] 10.4 Record context measurements for chapters 10, 50, 100, and 200 and assert bounded size; verify the test output reports estimated tokens, selected records, and omitted sections for each checkpoint
- [x] 10.5 Add old-chapter regeneration, manual-edit, transaction-finalization, usage-present, usage-missing, skip, cancellation, and migration safety tests; verify later chapters become continuity-stale without unnecessary media deletion
- [x] 10.6 Run the real OMP-backed sequential smoke path for at least three chapters, extending to ten when configured, and hand one reviewed chapter to existing TTS; verify real provenance, restart/resume behavior, and no automatic media enqueue, or document unavailable provider prerequisites
- [x] 10.7 Add `docs/implementation/long-story.md`, `story-state.md`, `batch-generation.md`, `continuity.md`, and `ai-usage.md`; update architecture, workflow, known-limitations, and setup docs with context policy, reducer, planning windows, resume, stale behavior, usage limits, and real/fake verification results
- [x] 10.8 Add only durable long-story rules discovered during implementation to `AGENTS.md`; verify unrelated guidance remains unchanged
- [x] 10.9 Run the relevant package tests, typecheck/build, migration smoke, and browser Story workflow verification; verify existing Story AI and TTS/media suites remain green and record the final readiness gate
