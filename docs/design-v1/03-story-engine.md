# Story Engine

## Responsibilities

The Story Engine transforms user intent into reviewable structured story state and then into chapter revisions. It owns prompts/templates as versioned resources later, but not provider selection, retries, queueing, or media.

## AI execution boundary

The Story Engine depends on a thin application-owned `AiAgent` contract. Its primary implementation is `OmpAgent`, which delegates LLM and agent execution to OMP SDK:

```text
Story feature
  -> AiAgent
    -> OmpAgent
      -> OMP SDK
        -> configured model/provider
```

Story features own deterministic input compilation, feature instructions, Zod output schemas, and acceptance rules. They do not import OMP SDK session, model, event, tool, authentication, or error types. `OmpAgent` owns SDK configuration, session lifecycle, model selection, deadline and cancellation translation, safe observability, and error normalization.

The persisted worker remains authoritative for attempt state, retries, dependencies, invalidation, input fingerprints, assets, and result commits. OMP session history is not project or workflow state. Each state-changing structured result is validated with the feature's Zod schema before it enters the application or domain layer; invalid, incomplete, or truncated output fails the attempt.

These intelligent story capabilities remain later work. They do not expand the current FIRST WORKING VIDEO milestone. OMP does not replace TTS, ASR/WhisperX, FFmpeg/ffprobe, ComfyUI, image/video APIs, filesystem, database, or job execution.

## Generate Story mode

1. Normalize idea, language, genre, chapter target, and writing instructions.
2. Generate a schema-validated blueprint: premise, world, themes, arc, ending, voice.
3. Generate characters with stable roles and relationship constraints.
4. Generate story events and chapter plans in batches, validating unique numbers and event coverage.
5. Generate chapters from bounded `GenerationContext` snapshots.
6. Summarize each accepted chapter and accept/review proposed event transitions.

For large plan counts, generate an act/arc outline first and chapter-plan batches second. Validate boundary continuity between batches; do not request 100 detailed plans in one response.

## Adapt Story mode

### Analysis stage

Analyze the imported source into a structured `SourceStoryAnalysis`: themes, genre signals, role archetypes, high-level conflict/arc, emotional beats, pacing, setting functions, ending function, and sensitive/immutable user constraints. Store the original as a source asset.

### Transformation stage

Build an `AdaptationBrief` that explicitly changes:

- setting/time/world rules;
- character identities, relationships, motivations, and roles where possible;
- causal chain and scene sequence;
- central obstacles, reveals, resolution mechanics;
- narrative voice and prose strategy.

It may preserve abstract themes or dramatic functions selected by the user. The adaptation blueprint must be approved before chapters are generated.

### Source isolation

Chapter generation consumes `SourceStoryAnalysis` + accepted adaptation blueprint, not source prose. This discourages phrase-level rewriting and bounds context. An optional later evaluator can flag suspicious phrase/sequence similarity, but V1 makes no legal originality guarantee.

## Bounded chapter context

`GenerateChapter(27)` calls a deterministic context compiler before invoking `AiAgent`:

```text
fixed generation policy
+ accepted blueprint digest
+ current chapter plan
+ relevant character cards
+ recent accepted summaries (normally chapters 25-26)
+ older summary only when referenced by plan/event
+ active/unresolved important events
+ user writing instructions
+ feature-owned output schema/constraints
```

### Selection algorithm

1. Reserve output tokens and provider safety margin; input gets the remaining budget.
2. Always include current blueprint digest and chapter plan.
3. Include character revisions named by the plan, event participants, and POV.
4. Include previous chapter summary; include a small configurable recent-summary window while budget allows.
5. Rank unresolved events by explicit plan reference, participant overlap, scheduled range, importance, then recency.
6. Include older summaries only when they introduced a selected event or are explicitly pinned.
7. Trim optional prose examples first, then lower-ranked events; never trim the current plan or required character facts.
8. Record each included/excluded candidate, reason, revision, token estimate, and builder version in `GenerationContext`.

No embeddings/vector database is required. Selection is relational and explainable. A future retriever can implement the same context-item contract.

## Post-generation processing

- Require the OMP-backed AI boundary to return a terminal result and validate all state-changing structured output with the feature-owned Zod schema.
- Treat invalid JSON, schema mismatch, missing terminal output, truncation, content-policy refusal, deadline expiry, or cancellation as normalized failed attempts rather than accepted partial state.
- Apply only mechanical text cleaning after the chapter is accepted; do not let cleaning change meaning.
- Generate a concise factual summary: starting state, key actions, revelations, ending state.
- Ask for event transition proposals keyed by known event IDs. Reject unknown IDs; user or deterministic rules accept state changes.
- Extract continuity warnings separately; warnings do not mutate facts.
- Store the effective OMP/model/provider configuration identity, prompt-template version, context hash, finish reason, usage/cost data when available, and safe trace metadata.

## Regeneration and edits

- Regenerate creates a new chapter revision; prior revisions remain inspectable.
- User edit creates a new revision marked `UserEdited` and invalidates direct media descendants.
- Accepted later chapters remain current after an earlier manual edit, matching V1's precise invalidation rule. The UI may show a non-blocking “continuity review recommended from chapter N” indicator; it does not auto-invalidate chapters 6+.
- Regenerating a blueprint or chapter plan invalidates only generated story descendants linked to changed revisions; user-edited chapters require explicit replacement approval.

## Quality gates appropriate for V1

- JSON/schema validity and repair attempt.
- language matches project;
- chapter word count within configurable tolerance;
- no unknown character/event IDs in structured updates;
- no duplicate chapter number/title contract violation;
- current-plan beats addressed checklist (advisory, not semantic proof);
- provider safety/finish truncation surfaced as failure, not accepted partial text.

Avoid an autonomous evaluator/regeneration loop in V1. User review is the quality authority.

## Decision: structured summaries and events, not full memory

- **Alternatives:** send all prose; vector database; knowledge graph/agent memory.
- **Why:** summaries/events solve the immediate continuity and context-cost problem with explainable selection.
- **Trade-offs:** subtle prose facts may be omitted; summaries depend on model quality.
- **Future impact:** add extracted facts, world bible, embeddings, and scene graph as new context item sources without changing chapter generation's input contract.
