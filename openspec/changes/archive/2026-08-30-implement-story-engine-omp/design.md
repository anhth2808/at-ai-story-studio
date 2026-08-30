## Context

See `proposal.md` for motivation and scope. The repository currently has a Node.js/TypeScript modular monolith with Fastify API, React/Vite web app, SQLite/Drizzle persistence, one database-backed worker, and a V1 chapter-to-TTS/subtitle/background/render pipeline. The existing `chapters` table and editor are the authoritative editable text path; media assets and workflow state are already revision/fingerprint based.

There is no executable Story Blueprint, ChapterPlan, GenerationContext, AI boundary, or OMP integration in the current tree. The existing project specification still describes ordinary chapter operations as manual-only. This change must add explicit Story Engine operations without making ordinary CRUD call an agent and without automatically starting media work.

The current official OMP SDK documentation states that `@oh-my-pi/pi-coding-agent` is a Bun SDK requiring Bun 1.3.14 or newer, not a Node.js SDK. The documented SDK surface includes `createAgentSession`, `session.prompt`, event subscription, `SessionManager.inMemory`, explicit model/auth registry wiring, isolated settings, tool restriction, `session.abort`, and `session.dispose`. The Node application therefore cannot import the SDK directly without violating the runtime boundary.

## Goals / Non-Goals

**Goals:**

- Add durable, revisioned story state above the V1 media factory.
- Keep generation review-first: generated text becomes editable chapter content, and TTS requires an explicit user action.
- Give the worker one thin `AiAgent` contract and one OMP-backed implementation without leaking OMP or provider types into domain code.
- Validate every model result at the boundary before current-state promotion.
- Bound chapter context using summaries, facts, threads, and selected characters so long stories do not require full-history prompts.
- Reuse existing workflow leases, retries, cancellation, restart recovery, fingerprints, and safe-error mechanisms.
- Make the 50/100/200 chapter architecture testable and record a clear `READY_FOR_LONG_STORY` gate.

**Non-Goals:**

- No adaptation/import/scraping workflow, source downloading, copyright circumvention, or Mode B implementation.
- No image/video generation, scene graph, shot planning, embeddings, vector database, RAG service, character-memory retrieval, WhisperX, F5-TTS, GPT-SoVITS, ComfyUI, image-to-video, publishing, authentication, or generic workflow designer.
- No second provider hierarchy or direct OpenAI/Gemini/provider SDKs in the Node application.
- No automatic retries that discard manual edits, no silent chapter replacement, and no automatic TTS/subtitle/render enqueue.
- No migration of V1 media files into SQLite and no change to FFmpeg/media process ownership.

## Decisions

### 1. Add a Story Engine bounded context above the existing chapter/media path

Story Engine owns story configuration, blueprint, character, thread, chapter-plan, summary, context, prompt, validation, and generation metadata. The existing media workflow continues to own text cleaning, TTS segments, subtitles, backgrounds, rendering, assets, and media retries.

An accepted generated chapter is written into the existing `chapters` aggregate as a normal revision with origin/source lineage. A separate `AIChapter` entity is intentionally not introduced. This keeps the editor, narration input, chapter ownership, ordering, and existing dependent invalidation behavior in one place.

The Story Engine application layer exposes explicit operations:

- `generateBlueprint(projectId, settingsRevision)`
- `generateChapterPlans(projectId, blueprintRevision)`
- `generateChapter(projectId, planItemId, instructions)`
- `generateChapterSummary(projectId, chapterRevision)`

These operations create durable workflow executions; they do not run synchronously inside HTTP handlers.

### 2. Use immutable revision rows with current pointers and stable IDs

Add story-specific revision tables rather than putting all story state into the `projects` row or one mutable JSON blob. The exact Drizzle table names may follow repository naming conventions, but the logical records are:

- Story settings revisions: project, mode, validated settings payload, revision, fingerprint, current marker.
- Blueprint revisions: project, settings source revision, validated blueprint payload, character records or a validated character collection, revision, fingerprint, current marker, generation metadata.
- Chapter-plan revisions and plan items: project, blueprint source revision, ordered stable plan-item identifiers, required planning fields, revision, fingerprint, current marker.
- Story threads and thread revisions: stable project-local thread ID, compact state, status, related characters, introducing/resolving chapter references, source revision, current marker.
- Chapter-summary revisions: chapter ID, source chapter revision, compact summary/facts/character-state/thread-transition payload, current marker, generation metadata.
- Generation records/metadata: operation, target, input fingerprint, provider/model/prompt versions, timing/usage fields, attempt linkage, status, and bounded safe diagnostics.

Existing `chapters` gains nullable story source fields such as origin, source plan-item ID, and source generation/revision lineage. Existing V1 rows are treated as `MANUAL` with no story source. Story payloads are stored as validated JSON where the shape is intentionally extensible; stable IDs and query-critical ownership/order/current pointers remain relational. Every JSON write passes the feature-owned runtime schema first.

Revision creation and current-pointer changes happen transactionally. Prior revisions remain available for lineage and diagnostics. Manual edits create a new chapter revision and never mutate a generated revision in place.

### 3. Define one AI boundary and one OMP adapter

The workflow package owns a narrow `AiAgent` contract expressed only in application-owned request/response schemas. A request contains operation, validated input/context payload, prompt/template version, output schema identifier, model reference, input fingerprint, deadline, and correlation ID. A response contains validated transport data, provider/model provenance, usage when available, duration, and bounded diagnostics. The domain does not receive an OMP session, event union, provider response, or SDK error object.

`OmpAgent` is the only Node-side adapter for the configured OMP execution path. It maps `AiAgent` requests to a typed local protocol and maps protocol failures to stable application categories. No feature calls the OMP SDK or a provider SDK directly.

The Bun host is a small isolated application entrypoint. It is the only code that imports `@oh-my-pi/pi-coding-agent`. It creates a bounded session using the documented SDK APIs, selects an explicit configured model when present or a safe discovered default, subscribes to text/error events, awaits `session.prompt`, and always calls `session.dispose` in `finally`. It uses an in-memory or otherwise request-scoped session; story generation does not reuse conversational history across jobs.

The SDK host disables MCP/LSP and provides no custom tools for story generation. Tool allowlists are restrictive rather than relying on prompt instructions. The host treats all project text and notes as untrusted data. The final assistant text must be a single parseable structured payload; no free-form response is accepted as success. OMP-specific streamed events are reduced to bounded progress/error protocol events and never become feature contracts.

### 4. Use a versioned local NDJSON protocol between Node and Bun

Because the main application and worker are Node-based while the official SDK is Bun-only, the worker launches the Bun host through the existing safe external-process abstraction with executable arguments passed separately. The protocol is newline-delimited JSON with a version field and correlation ID. The request carries operation, model reference, prompt/system/user payloads, schema ID, deadline, and input fingerprint. The host emits bounded progress events and one terminal result or error event.

The Node side enforces output-size limits, parses each line with a protocol schema, rejects unknown/malformed terminal messages, captures bounded stderr, and applies the existing timeout/AbortSignal/process-termination behavior. Credentials are never command-line arguments. A per-operation host process is preferred for the first implementation: it gives clear resource ownership, prevents session cross-talk, and makes cancellation/restart recovery deterministic. A persistent host is not needed until measured startup cost proves material.

The protocol is application-owned and versioned independently of OMP SDK internals. A future OMP SDK upgrade changes only the Bun host and protocol adapter tests if the application contract remains stable. The implementation must run a small SDK spike before pinning the package version or depending on any API not present in the current official documentation.

### 5. Keep prompts and schemas feature-owned and versioned

Story prompt templates live with the Story Engine, not in routes or the OMP host. Each operation has a stable prompt/template version and a pure renderer. The prompt separates system instructions, structured operation contract, trusted generated context, and user-provided story data. User data is explicitly marked as data; instructions in it cannot authorize tools, change schemas, reveal credentials, or change workflow behavior.

Feature-owned Zod schemas validate settings, blueprint, characters, plan items, chapter envelopes, summaries, thread transitions, generation metadata, local protocol envelopes, and API input. Prompt output is parsed and schema-validated before database writes. The schema policy rejects malformed required fields and does not persist raw provider payloads or executable text as domain state.

Chapter generation uses one structured envelope containing content, summary, events, character changes, thread transitions, used/introduced character IDs, unresolved threads, continuity warnings, and metadata. The initial summary is committed with the generated chapter only after the complete envelope validates. `GENERATE_CHAPTER_SUMMARY` remains a separate explicit operation for summary regeneration and recovery, so a summary step can be retried without rerunning chapter content.

### 6. Compile bounded deterministic context without embeddings

A `GenerationContext` builder runs in the Story Engine application layer before the AI request. For a chapter it selects, in deterministic order:

1. current settings and blueprint revision identifiers;
2. the plan item being generated;
3. characters explicitly referenced by that plan item, plus only required relationship records;
4. the immediate previous chapter summary;
5. a configured small window of recent summaries;
6. open threads linked to the plan item or latest relevant events;
7. latest relevant facts and character-state changes;
8. explicit user generation instructions and the chapter-specific constraints.

The builder never sends all previous chapter prose as default context and never requires embeddings or vector search. It applies a default 5,000-token-equivalent budget, deterministic truncation/priority rules, a context hash, and an omitted-context diagnostic. Summary generation is the exception that necessarily receives the target chapter's current prose, subject to its own size limit.

Context selection uses current pointers and stable IDs, then records all selected revision IDs in the input fingerprint. A missing or stale prerequisite is either resolved through the documented summary fallback or returned as an actionable blocked/failed state; it is never silently treated as current.

### 7. Extend the existing durable workflow instead of introducing a new job system

Add workflow step types:

- `GENERATE_STORY_BLUEPRINT` targets the project and has settings as input.
- `GENERATE_CHAPTER_PLANS` targets the project and depends on a current validated blueprint.
- `GENERATE_CHAPTER` targets a stable plan item and depends on the blueprint and plan revisions.
- `GENERATE_CHAPTER_SUMMARY` targets a chapter revision and depends on the current chapter content.

The worker claims these steps using existing leases and attempts. The Story Engine executor builds context, calls `AiAgent`, validates the result, and commits domain state transactionally. Completion of one chapter does not enqueue sibling chapters or any media step. A summary regeneration does not rerun chapter generation. Existing retry, cancellation, safe error, and restart recovery paths are reused; OMP host loss is classified as worker/host loss, never as success.

Input fingerprints include all referenced story revision IDs, selected context revision IDs, settings, model identity, prompt version, and operation schema version. The invalidation service compares dependency edges and marks only affected story steps and media descendants invalidated. A new idea/settings revision invalidates dependent blueprint, plan, chapter, summary, and media outputs. A blueprint revision invalidates dependent plans and chapters. A plan item revision invalidates only that item and its descendants. A manual chapter edit invalidates its summary and existing narration/subtitle/render descendants while retaining the plan.

### 8. Keep HTTP thin and make the Story UI review-first

Add validated API routes for story snapshot/settings, blueprint and plan reads, explicit generation requests, generation status/retry/cancel, summary regeneration, and readiness/configuration diagnostics. Routes call application services and return client-safe DTOs; they do not render prompts, call OMP, or mutate workflow rows directly.

The web Story tab contains settings, blueprint/character review, plan rows, per-chapter generation controls, summaries/threads/warnings, provenance, and current/stale/failed state. It polls or refreshes persisted workflow state after mutations and has explicit loading, empty, error, retry, and cancellation states. New user-facing copy is Vietnamese; machine values and code remain English. A reviewed current chapter uses the existing editor. The only story-to-media control is an explicit narration action.

### 9. Configuration and secret handling

Story settings persist model reference, generation defaults, context budget, and prompt/schema version policy, but never API keys or access tokens. OMP authentication follows the supported OMP credential/configuration mechanism or an approved local secret store. A readiness operation returns provider/model availability, selected model, Bun/host health, and setup guidance without credential contents.

Logs and persisted workflow diagnostics apply existing redaction and bounded-size rules. Prompts and full chapter prose are not routine logs. The Bun host receives only the request data required for the operation and exits after completion/cancellation.

### 10. Verification gate for long-story readiness

The implementation is not declared ready for long stories until all of the following are observed:

- fake-agent tests prove schema rejection, deterministic context bounds, revision lineage, scoped invalidation, independent retry, cancellation, and restart recovery;
- the real OMP-backed smoke path generates a small three-chapter idea-to-story project, stores a blueprint and plans, generates chapters 1 and 2, survives a worker restart, then generates chapter 3;
- one generated chapter is explicitly handed to the existing TTS workflow and produces the normal downstream result without automatic media enqueue from Story Engine;
- the 50/100/200 chapter context checks show bounded prompt size and no full-history assembly;
- OMP credentials/models are configured through supported setup and no secret appears in database, client response, or logs.

Only then may verification record `READY_FOR_LONG_STORY = YES`; otherwise it must record `NO` with the failing gate and safe diagnostics.

## Risks / Trade-offs

- **Bun/SDK drift:** The SDK is Bun-only and its public surface can change. Pin the tested package/Bun versions, keep imports in the Bun host, and run an SDK spike before implementation. If the documented API cannot produce a reliable structured result, stop at the boundary rather than faking success.
- **Process startup cost:** A process per operation is slower than an embedded Node call, but it gives the required runtime isolation and simple cancellation. Measure it during smoke verification before considering a persistent host.
- **Structured output variability:** Models may emit markdown or incomplete fields. Strict parse/validation can cause retries, but accepting malformed output would corrupt revision lineage and waste expensive downstream work; strict failure is safer.
- **Summary consistency:** Chapter generation returns summary data while summary regeneration is a separate step. The initial envelope is committed atomically; later summary edits carry source chapter revision fingerprints and become stale when prose changes.
- **Manual edits versus later generation:** Fingerprinted source revisions and explicit replacement confirmation prevent silent overwrite, at the cost of more visible stale states for users.
- **Long-story context quality:** Compact summaries and thread selection reduce cost and context overflow but can omit nuance. The builder records selected and omitted records so users can diagnose continuity warnings; full-history prompts are deliberately rejected.
- **Credential discovery:** OMP may discover settings outside the application. The readiness endpoint and setup documentation must state exactly which local OMP auth/configuration is used, while the application stores only safe references.
- **Schema/migration growth:** Revision tables add persistence complexity. Keeping story payloads validated and JSON-based while retaining relational project/order/current pointers avoids premature normalization without losing deterministic lineage.
