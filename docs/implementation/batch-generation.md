# Batch generation

Long-story batches orchestrate existing database-backed workflow steps. SQLite is the source of truth and the initial worker model is one worker with transactional claim and lease recovery.

## Scheduling

A batch request is validated against the current settings, blueprint, arc/window coverage, chapter range, manual conflicts, active chapter locks, and `maxChaptersPerBatch`. The request must be contiguous and inside the configured target. The service creates one workflow step and batch item per chapter in ascending order.

Each chapter depends on its immediate predecessor through a required dependency. Future fingerprints are deferred: the worker compiles context from the StoryState that exists when the chapter is claimed, then updates the running step fingerprint before invoking OMP. State changes in chapter 21 therefore cannot be hidden by a fingerprint calculated when the batch was created.

## Outcomes and recovery

Batch items have independent outcomes: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, or `CANCELLED`. A failed item pauses the batch and leaves the later dependency chain pending. Retrying resets only the failed item and its workflow step after current-input checks. Completed chapters and successful expensive work are not regenerated.

The worker lease is recovered after restart. If finalization completed before the process died, the generation record, chapter lineage, state revision, and delta match the running step; recovery reconciles that checkpoint and completes the workflow without another OMP call. Otherwise the step is reclaimed normally.

## Skip and cancel

Skip is explicit. It records `SKIPPED` and the reason, cancels the skipped workflow step, makes only the immediate successor dependency optional, and adds a visible gap marker to downstream context. A skipped chapter is never counted as generated content.

Cancel marks the batch terminal, cancels pending items, and requests cancellation for the active workflow step. It does not delete accepted chapters, state checkpoints, media, or usage history.

## API and UI

Use the batch endpoints for status, item reads, retry, skip, and cancel. The Story workspace shows batch progress, failed and skipped outcomes, stale continuity counts, and per-chapter actions. A batch never triggers TTS, subtitles, backgrounds, or rendering; narration remains an explicit reviewed handoff.
