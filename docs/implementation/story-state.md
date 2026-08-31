# StoryState

`StoryState` is the application-owned canonical continuity snapshot. It is not an OMP session and it is not reconstructed from the model's prose output.

## Stable and dynamic data

The blueprint owns stable character identity and definitions: IDs, names, roles, appearance, personality, relationships, backstory, voice, and character arcs. `StoryState.characterStates` stores mutable per-character facts keyed by those stable IDs: location, current goal, power level, injuries, possessions, relationships, knowledge, and the last updated chapter.

StoryState also carries:

- a bounded rolling progress summary;
- typed open, progressing, and resolved threads;
- deduplicated important facts;
- recent typed events with character and thread references;
- current arc and phase;
- explicit skipped-chapter gap markers;
- source chapter and revision lineage.

Every field is bounded and validated with Zod before persistence. Unknown character, thread, arc, or chapter references are rejected.

## Revisions and deltas

`story_state_revisions` stores immutable compact snapshots. `story_state_deltas` stores the accepted structured change proposal that produced a checkpoint. `story_chapter_lineage` links a chapter revision to its source state revision and generation or analysis record. The current marker is separate from revision history, so prior checkpoints remain inspectable.

The reducer is pure. It validates references, applies character updates, applies thread transitions, upserts facts, appends bounded events, advances arc/chapter progress, and compacts the rolling summary in deterministic order. Terminal thread transitions take precedence over progress for the same thread in one delta.

## Atomic finalization

A generated V2 chapter is finalized in one better-sqlite3 transaction containing:

- the chapter revision and generated provenance;
- the accepted chapter summary;
- the validated StateDelta;
- the new StoryState snapshot and current pointer;
- normalized character, thread, fact, event, arc, and lineage records;
- nullable AI usage data when supplied;
- generation-record completion.

The workflow step is completed only after the transaction returns. If validation or any SQL write fails, the previous current checkpoint remains current and no partial chapter checkpoint is accepted. If the process exits after finalization but before workflow completion, recovery finds the matching completed generation and reuses it without another model call.

## Manual edits and historical regeneration

Editing chapter text clears generated source lineage for that chapter and preserves the chapter/media revision history. The last valid checkpoint remains the source of truth until the user explicitly accepts a manual state analysis or rebuild. Later generated chapters are marked `CONTINUITY_STALE`; their text and media are preserved.

Regenerating an older generated chapter creates a new chapter revision and checkpoint while preserving later content and media. Future generated lineage is marked stale and pending future batch work is paused. The application never silently rewrites the suffix.
