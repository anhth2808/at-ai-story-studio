# story-generation-batches Specification

## Purpose
Provide durable, sequential long-story chapter generation that can run without an open browser, survive restarts, pause safely on dependency failures, and resume without regenerating successful chapters.

## Requirements

### Requirement: Batch chapter generation requests
The system SHALL allow a user to request generation of the next N planned chapters, an explicit inclusive chapter range, or all remaining chapters through a persisted batch operation. Requests SHALL be validated against the configured target and available plan windows before work begins.

#### Scenario: Generate the next five chapters
- **WHEN** a user requests the next five chapters after the current completed prefix
- **THEN** the system SHALL create one durable batch with the selected range and expose its progress and per-chapter statuses

#### Scenario: Reject an invalid range
- **WHEN** a requested range is outside the target, reversed, or lacks required plans
- **THEN** the system SHALL return a safe validation or prerequisite error and SHALL not create chapter-generation work

### Requirement: Sequential batch execution
A batch SHALL generate required chapters in ascending chapter order by default. A later chapter SHALL not start until the preceding required chapter has committed its content, summary, StateDelta, StoryState checkpoint, and generation metadata.

#### Scenario: Advance after a successful chapter
- **WHEN** chapter 21 completes and its StoryState checkpoint is current
- **THEN** the batch SHALL make chapter 22 eligible without rerunning chapter 21 or starting chapter 23 first

#### Scenario: Preserve consistency over throughput
- **WHEN** multiple chapters are pending in one batch
- **THEN** the system SHALL not generate them fully in parallel unless an explicitly supported independent planning operation is being run

### Requirement: Durable batch progress and resume
Batch records SHALL persist project, inclusive range, total, completed, failed, skipped, status, timestamps, and the relationship to independently persisted chapter work. Restarting the API, worker, web application, or computer SHALL not reset batch progress.

#### Scenario: Resume after worker restart
- **WHEN** a batch has completed chapters 1-72 and the worker stops before chapter 73 commits
- **THEN** a later worker SHALL observe persisted progress, recover any expired lease, and continue from chapter 73 without regenerating chapters 1-72

#### Scenario: Reopen the dashboard
- **WHEN** the web application reloads while a batch is pending or paused
- **THEN** it SHALL display the database-backed batch status and chapter progress rather than reconstructing progress from client memory

### Requirement: Failure pause and explicit skip
By default, a failed required chapter SHALL pause its batch and SHALL prevent later dependent chapters from being treated as successfully generated. The user SHALL be able to retry the failed chapter or explicitly skip it; a skip SHALL be recorded and downstream context SHALL identify the gap.

#### Scenario: Pause on chapter failure
- **WHEN** chapter 47 fails after chapters 1-46 are complete
- **THEN** the batch SHALL become paused or failed, chapter 48 SHALL remain pending, and the UI SHALL expose retry and error details

#### Scenario: Explicitly skip a failed chapter
- **WHEN** the user confirms skipping chapter 47
- **THEN** the system SHALL persist a visible skipped outcome, advance only according to the configured skip policy, and mark the continuity gap in later generation context

### Requirement: Duplicate protection and idempotent reuse
The system SHALL prevent two users or workers from generating the same project-local chapter concurrently. A valid completed chapter with the same input fingerprint SHALL be reused, while a changed fingerprint SHALL create a new creative revision rather than silently replacing an unrelated result.

#### Scenario: Two requests target one chapter
- **WHEN** two batch or individual requests target the same pending chapter
- **THEN** only one durable generation operation SHALL become active and the other request SHALL reuse or report the existing work

#### Scenario: Resume a completed prefix
- **WHEN** a resumed batch encounters a chapter with a matching completed fingerprint and current checkpoint
- **THEN** it SHALL count that chapter as completed without invoking the AI boundary again

### Requirement: Independent chapter retry
A failed chapter in a batch SHALL remain independently retryable when its inputs are still valid. Retrying SHALL not rerun successful preceding chapters or destroy their summaries, checkpoints, media, or provenance.

#### Scenario: Retry chapter 121
- **WHEN** the 121st chapter failed in a 200-chapter simulation and chapters 1-120 are complete
- **THEN** retrying chapter 121 SHALL invoke only the failed chapter operation, then continue the batch from the next eligible chapter after its checkpoint commits

### Requirement: Batch cancellation and terminal status
A user SHALL be able to request cancellation of a pending or running batch. Cancellation SHALL stop future chapter scheduling, propagate to active cancellable work, preserve completed chapters, and expose a terminal cancelled status distinct from failure.

#### Scenario: Cancel a running batch
- **WHEN** a user cancels a batch after chapter 30 completes
- **THEN** chapters already complete SHALL remain current, active work SHALL stop within the configured termination window, and remaining chapters SHALL not be silently marked complete
