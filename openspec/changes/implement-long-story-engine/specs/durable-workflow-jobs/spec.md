## ADDED Requirements

### Requirement: Persisted sequential story batches
The workflow system SHALL support a batch record for an inclusive chapter range or next-N/until-end request, including project, range, total, completed, failed, skipped, status, timestamps, and references to per-chapter workflow steps. Batch progress SHALL be recoverable solely from SQLite state.

#### Scenario: Materialize a chapter batch
- **WHEN** a user requests chapters 21-30
- **THEN** the system SHALL persist a batch and independently persisted chapter work before the worker begins execution

#### Scenario: Resume persisted progress
- **WHEN** the worker restarts after chapters 21-25 complete
- **THEN** the next worker SHALL observe those completions and SHALL resume at chapter 26 without recreating or rerunning completed steps

### Requirement: Ordered batch dependency execution
Within a story-generation batch, a chapter step SHALL depend on the immediately preceding required chapter checkpoint by default. A dependent step SHALL remain pending or blocked when its predecessor fails, is cancelled, or is missing a current StoryState checkpoint.

#### Scenario: Stop after a failed chapter
- **WHEN** chapter 47 fails in a batch
- **THEN** chapter 48 and later dependent steps SHALL not execute, and the batch SHALL expose a paused or failed state with the predecessor error

#### Scenario: Advance after checkpoint commit
- **WHEN** a chapter's content, summary, state delta, StoryState, and metadata commit atomically
- **THEN** only then SHALL the next chapter step become claimable

### Requirement: Explicit skip records
The workflow system SHALL support an explicit user-authorized skip for a failed required chapter. The skip SHALL be persisted as a distinct outcome with chapter and batch lineage, and later context SHALL receive a visible gap marker rather than treating the chapter as successfully generated.

#### Scenario: Skip chapter 47
- **WHEN** a user confirms skipping failed chapter 47
- **THEN** the batch SHALL record the skip, retain the failure diagnostics, and apply the configured downstream policy without silently fabricating chapter state

### Requirement: Story generation claim protection
Existing atomic workflow claiming SHALL cover individual story chapter steps and batch coordination so that concurrent users or workers cannot run the same project-local chapter simultaneously. A matching valid completed fingerprint SHALL be idempotently reused.

#### Scenario: Concurrent chapter claims
- **WHEN** two workers claim the same eligible chapter step
- **THEN** one claim SHALL succeed and the other SHALL execute no AI operation for that chapter

#### Scenario: Retry without duplicate work
- **WHEN** a failed chapter is retried after its prior attempt ended
- **THEN** the new attempt SHALL have durable lineage and SHALL not overlap the prior active attempt or rerun completed preceding chapters

### Requirement: Transactional story completion checkpoint
A story chapter step SHALL transition to `COMPLETED` only after chapter content, summary, validated state delta, current StoryState checkpoint, and generation metadata are persisted consistently. A failure during finalization SHALL leave the step incomplete and SHALL retain the prior current checkpoint.

#### Scenario: State reducer failure
- **WHEN** chapter content persistence succeeds but state reduction throws
- **THEN** the transaction SHALL roll back or leave the chapter step non-complete, preserve the prior StoryState, and expose a bounded retryable or terminal error

### Requirement: Batch cancellation
The durable workflow SHALL support cancellation of a pending or running story batch. Cancellation SHALL stop future chapter scheduling, propagate to the active step, preserve completed chapters, and remain distinct from failure.

#### Scenario: Cancel after partial progress
- **WHEN** a user cancels a batch after chapter 37 completes
- **THEN** completed chapter steps SHALL remain complete, active work SHALL be cancelled or recovered, and later steps SHALL not be marked complete