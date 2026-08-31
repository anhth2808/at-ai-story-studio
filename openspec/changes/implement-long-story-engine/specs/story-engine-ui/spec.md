## ADDED Requirements

### Requirement: Long-story progress dashboard
The Story workspace SHALL display target chapter count, blueprint status, arc coverage, planned chapter coverage, generated chapter progress, continuity warning count, active batch status, and the current blocking chapter. New labels, actions, statuses, empty states, and errors SHALL remain Vietnamese while machine status values remain available for diagnostics.

#### Scenario: Review a 100-chapter project
- **WHEN** a project has 100 configured chapters, four arcs, 40 planned chapters, and 37 completed chapters
- **THEN** the dashboard SHALL show those persisted counts and SHALL identify chapter 38 as failed or blocking when applicable

#### Scenario: Reload batch progress
- **WHEN** the browser reloads during or after a worker restart
- **THEN** the dashboard SHALL restore progress and errors from the API/database rather than resetting local counters

### Requirement: Batch generation controls
The Story workspace SHALL expose actions for generating the next five, next ten, a selected inclusive range, or all remaining chapters. Each action SHALL show persisted pending, running, completed, failed, paused, skipped, cancelled, or stale state and SHALL not require the browser to remain open.

#### Scenario: Start the next batch
- **WHEN** a user selects Generate next 5 with valid plans and prerequisites
- **THEN** the UI SHALL submit one durable batch request and show its per-chapter progress and retry/cancel actions

#### Scenario: Show a failed batch
- **WHEN** a batch pauses because chapter 38 failed
- **THEN** the UI SHALL show the failed chapter, safe error, Retry action, and an explicit Skip action without implying that later chapters succeeded

### Requirement: Filterable chapter status table
The Story workspace SHALL provide a bounded chapter table showing number, plan status, generation status, continuity status, summary status, and audio status. It SHALL support filters for failed, pending, continuity-stale, and warning results and SHALL avoid requiring all chapter prose or media data in the table response.

#### Scenario: Filter stale chapters
- **WHEN** chapter 25 changes and chapters 26-50 become continuity-stale
- **THEN** selecting the continuity-stale filter SHALL list those chapters with actions to keep, rebuild, or regenerate according to authorization

#### Scenario: Inspect a warning
- **WHEN** a generated chapter has a WARN continuity result
- **THEN** the table SHALL show the warning state and allow the user to inspect structured issues without hiding the chapter

### Requirement: Reviewable arc and continuity actions
The Story workspace SHALL display lightweight arc ranges, goals, conflicts, planned outcomes, and statuses, allow authorized arc-plan edits, and expose explicit actions to rebuild continuity or analyze a manual chapter. Arc and continuity edits SHALL communicate affected stale or invalidated work before execution.

#### Scenario: Edit an arc
- **WHEN** a user changes an arc range or planned outcome
- **THEN** the UI SHALL save a new revision and show the affected plan or chapter work as stale or invalidated rather than silently changing generated text

#### Scenario: Analyze a manual chapter
- **WHEN** a manual chapter lacks a valid state delta
- **THEN** the UI SHALL offer Analyze existing chapter, display the returned summary/state proposal for review, and require explicit acceptance before it changes current StoryState

### Requirement: Usage and context diagnostics
The Story workspace SHALL show bounded usage information, context-budget diagnostics, and unavailable token/cost values honestly. It SHALL not expose credentials, complete prompts, or full chapter contents through dashboard diagnostics.

#### Scenario: Provider usage unavailable
- **WHEN** a valid operation has null token or cost metadata
- **THEN** the UI SHALL display an unavailable value and SHALL not display a fabricated estimate as actual usage