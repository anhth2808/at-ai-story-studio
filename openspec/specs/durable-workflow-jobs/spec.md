# Durable workflow jobs Specification

## Purpose

Provide persisted, dependency-aware execution state that survives process restarts and allows long-running narration and rendering work to be retried at the smallest practical unit.

## Requirements

### Requirement: Persisted workflow state
The system SHALL persist workflow executions, steps, dependencies, attempts, progress, errors, cancellation requests, and timestamps in the local database. Supported statuses SHALL include `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `INVALIDATED`, and `CANCELLED`.

#### Scenario: Create work
- **WHEN** an API operation requests narration, subtitle, background preparation, or rendering
- **THEN** the system SHALL persist the corresponding execution/step state before work begins and SHALL return a durable work identifier

#### Scenario: Persist progress
- **WHEN** a worker makes progress on a running step
- **THEN** current progress, safe message, attempt, and update time SHALL be persisted and visible to later status reads

### Requirement: Dependency-aware execution
A pending hierarchical render step SHALL be claimable only when all required current dependencies are complete and fingerprint-compatible. The workflow SHALL support SceneTiming, MotionPlan, `RENDER_SCENE_CLIP`, `RENDER_CHAPTER_VIDEO`, and `RENDER_PROJECT_VIDEO` work while retaining existing statuses, leases, attempts, progress, cancellation, and safe errors. A blocked Chapter or Project step SHALL expose its incomplete, stale, or failed prerequisites.

#### Scenario: Chapter waits for Scene Clips
- **WHEN** one required Scene Clip is pending or failed
- **THEN** the Chapter Video step SHALL remain blocked and SHALL not invoke FFmpeg with a missing visual input

#### Scenario: Project waits for Chapters
- **WHEN** a selected Chapter Video is stale or absent
- **THEN** the Project Video step SHALL remain blocked or schedule that dependency only under explicit auto-build behavior

#### Scenario: Do not render missing inputs
- **WHEN** narration, background, or subtitle prerequisites are not current
- **THEN** the render step SHALL not execute and SHALL report the named prerequisite state

### Requirement: Atomic job claiming
The worker SHALL claim at most one eligible pending step at a time using a conditional durable transition that prevents duplicate execution under normal operation. Claiming SHALL persist the active attempt and lease before external work starts.

#### Scenario: Two workers race
- **WHEN** two worker processes attempt to claim the same eligible step
- **THEN** exactly one claim SHALL succeed and the other SHALL execute nothing for that step

### Requirement: Retry at unit scope
A failed step SHALL be explicitly retryable when its inputs remain valid. Retrying SHALL create a new attempt and SHALL reuse completed valid child units instead of rerunning them.

#### Scenario: Retry one failed TTS segment
- **WHEN** TTS segments 1 and 2 are completed and segment 3 is failed, then the user retries TTS
- **THEN** segments 1 and 2 SHALL not execute again and only segment 3 (plus required downstream merge work) SHALL execute

### Requirement: Cancellation
Cancellation requests SHALL be persisted. A worker SHALL observe cancellation before starting work, between units, and during cancellable external processes, then transition the active work to `CANCELLED` without promoting partial outputs to current assets.

#### Scenario: Cancel a running render
- **WHEN** a user cancels an active render
- **THEN** the worker SHALL stop the process within the configured termination window, retain diagnostics as non-current staging/history, and expose `CANCELLED`

### Requirement: Restart recovery
After an API, worker, or computer restart, completed timing, MotionPlan, Scene Clip, and Chapter Video outputs with matching current fingerprints SHALL remain reusable. Expired running render leases SHALL follow the existing recovery policy, and a recovered step SHALL not blindly re-run a completed lower-level unit.

#### Scenario: Resume after worker loss
- **WHEN** the worker stops after completing part of a Chapter or Project render
- **THEN** a restarted worker SHALL recover the remaining pending work and preserve all completed valid output Assets
#### Scenario: Worker dies during a step
- **WHEN** a worker stops while a step is running and its lease expires
- **THEN** a subsequent worker SHALL mark the prior attempt as worker-lost and deterministically make the step retryable or terminal, while leaving completed sibling steps untouched

### Requirement: Safe errors
Failed work SHALL persist a stable error category/code, safe user message, retryability, and bounded technical diagnostics. Secrets and full source prose SHALL not be emitted in routine logs or client responses.

#### Scenario: External tool fails
- **WHEN** FFmpeg, ffprobe, or TTS exits unsuccessfully or times out
- **THEN** the step SHALL become visibly failed with actionable safe details and the process result/diagnostic SHALL remain bounded

### Requirement: Story AI workflow steps
The workflow system SHALL support independently persisted steps for `GENERATE_STORY_BLUEPRINT`, `GENERATE_CHAPTER_PLANS`, `GENERATE_CHAPTER`, and `GENERATE_CHAPTER_SUMMARY`, with dependency links, input fingerprints, attempts, leases, progress, safe errors, cancellation, and restart recovery using the existing workflow status model.

#### Scenario: Generate a story in stages
- **WHEN** a user requests blueprint, plan, and chapter generation
- **THEN** the system SHALL persist the stages and their dependencies so a failed chapter step can be retried without regenerating valid blueprint, plan, or sibling chapter steps

#### Scenario: Chapter waits for prerequisites
- **WHEN** a chapter step has no current validated blueprint or matching plan item
- **THEN** the chapter step SHALL remain blocked/pending with the named prerequisite rather than calling the AI boundary

#### Scenario: Summary failure is isolated
- **WHEN** chapter content succeeds but its summary step fails
- **THEN** chapter content SHALL remain reviewable, summary SHALL be retryable independently, and TTS/subtitle/render work SHALL not be started by the summary failure or recovery

### Requirement: Story AI input fingerprints and invalidation
Story AI steps SHALL fingerprint all relevant story revisions, selected context records, prompt/template versions, generation settings, and configured model identity. A change SHALL invalidate only steps and media descendants whose fingerprints depend on that change.

#### Scenario: Change one plan item
- **WHEN** a user edits the plan input for chapter 4
- **THEN** the system SHALL invalidate chapter 4 and its summary/media descendants while retaining current steps for unrelated chapters

#### Scenario: Change provider model
- **WHEN** a user changes the configured model before retrying a failed operation
- **THEN** the retry SHALL record the new model in its fingerprint and provenance without rewriting unrelated completed story outputs

### Requirement: Story AI progress and diagnostics
Story AI steps SHALL persist safe progress messages, operation stage, attempt number, provider/model identifiers when available, bounded diagnostic details, retryability, and cancellation state. Prompts, source prose, credentials, and raw provider payloads SHALL not be written to routine progress or client-safe errors.

#### Scenario: Observe a running chapter
- **WHEN** a chapter generation step is running
- **THEN** a later status read SHALL show its durable stage, progress or indeterminate state, attempt, and safe message even after the original request ends

#### Scenario: Recover a lost OMP host
- **WHEN** an OMP host or worker disappears before committing a result
- **THEN** the active attempt SHALL be closed as lost and the step SHALL become retryable or terminal according to policy without promoting partial output

### Requirement: Persist visual consistency work
The workflow system SHALL support independently persisted steps for generating character, location, and recurring-object visual-profile candidates, building visual prompt packages for one scene, and building missing or stale packages for selected chapters. Each step SHALL use the existing workflow statuses, attempts, progress, cancellation, leases, errors, and input fingerprints.

#### Scenario: Schedule a scene prompt build
- **WHEN** a user requests a prompt build for a chapter or selected chapters
- **THEN** the system SHALL persist one bounded step per selected chapter/scene scope and return durable work identifiers without loading all project scenes into one response

### Requirement: Resume visual work safely
A visual step SHALL commit validated profile/package data and provenance before the worker marks it completed. Technical retries SHALL reuse unchanged inputs and existing completed output; creative profile regeneration SHALL create a reviewable candidate/revision rather than silently changing approved identity.

#### Scenario: Recover after worker restart
- **WHEN** a worker restarts after a visual profile or package commit but before step completion
- **THEN** recovery SHALL detect the committed matching fingerprint and avoid duplicate OMP generation

#### Scenario: Retry one failed package
- **WHEN** one scene package fails while other packages are current
- **THEN** retrying SHALL rerun only the failed scope and SHALL leave unrelated package and story/media state unchanged

### Requirement: Scope visual dependencies
Visual profile and Style Bible changes SHALL invalidate only dependent visual prompt steps/packages. Visual workflow steps SHALL not create or trigger TTS, subtitle, background, render, or image-provider work.

#### Scenario: Change a character profile
- **WHEN** one character visual revision changes
- **THEN** only steps/packages that reference that character SHALL become stale or pending rebuild

### Requirement: Persisted scene workflow steps
The workflow system SHALL support independently persisted steps for chapter scene planning, single-scene regeneration, and visual-prompt refresh using the existing status, dependency, attempt, lease, progress, cancellation, and input-fingerprint model. Scene steps SHALL complete only after validated scene data is committed.

#### Scenario: Schedule scene planning
- **WHEN** a user requests scene planning for an existing chapter
- **THEN** the system SHALL persist a durable step and return an identifier that remains observable after the request ends

#### Scenario: Do not start pixel work
- **WHEN** a scene step completes
- **THEN** no image or video provider job SHALL be materialized as a dependency or downstream job

### Requirement: Independent scene retry and regeneration
A technical failure SHALL be retryable against the same current inputs without creating a creative revision. An explicit creative regeneration SHALL create the next current scene revision and SHALL not rerun or invalidate neighboring scene steps.

#### Scenario: Retry failed planning
- **WHEN** a scene-planning attempt fails with a retryable OMP or infrastructure error
- **THEN** the prior current scene plan SHALL remain intact and only the failed step SHALL be eligible for retry

#### Scenario: Regenerate one scene
- **WHEN** a user explicitly regenerates scene 4
- **THEN** only scene 4's workflow step and revision SHALL change, while scenes 1-3 and 5 onward remain unchanged

### Requirement: Scene restart and batch behavior
Scene work SHALL survive API/worker restarts through the existing lease recovery and completed-step reuse rules. Batch requests SHALL support selected chapters or chapters without current scene plans, materialize work chapter-by-chapter, and SHALL not analyze all project chapters unless explicitly selected.

#### Scenario: Recover after restart
- **WHEN** the worker stops during scene planning and a later worker starts
- **THEN** the step SHALL be recovered according to persisted retry policy and committed scene records SHALL not be lost or duplicated

#### Scenario: Generate selected chapters
- **WHEN** a user selects chapters 3 and 8 for scene generation
- **THEN** the system SHALL schedule only those chapter operations and SHALL report per-chapter outcomes

### Requirement: Persist Scene image workflow steps
The workflow system SHALL support independently persisted `GENERATE_SCENE_IMAGE` work for one Scene and bounded selected/missing/stale batches using the existing workflow execution, step, job, attempt, lease, progress, error, cancellation, retry, dependency, and input-fingerprint model. It SHALL NOT create a second queue or one giant provider workflow containing multiple novel Scenes.

#### Scenario: Schedule one Scene image
- **WHEN** a user requests generation for one eligible Scene
- **THEN** the API SHALL persist one image step/job before the worker contacts the provider

#### Scenario: Schedule a Chapter batch
- **WHEN** a user requests missing images for one Chapter
- **THEN** the workflow SHALL materialize independently retryable eligible Scene steps and SHALL skip matching successful current work

### Requirement: Checkpoint remote image work before completion
A Scene image step SHALL retain a stable provider prompt ID and enough provider checkpoint state to correlate, poll, cancel where supported, and recover submitted work. Provider submission SHALL not mark the step completed. The step SHALL complete only after output validation and conditional generation/Asset persistence.

#### Scenario: Worker restarts after submission
- **WHEN** a worker loses its lease after ComfyUI accepted a prompt
- **THEN** recovery SHALL use the persisted provider prompt ID to inspect the existing remote job before any resubmission

### Requirement: Retry Scene image failures independently
A retryable technical image failure SHALL retry or resume the same logical generation, concrete seed, provider configuration, workflow version, and fingerprint. A creative regeneration SHALL materialize a separate generation revision and workflow step. Completed unrelated Scene image steps SHALL not rerun.

#### Scenario: Retry one failed image
- **WHEN** Scene 8 fails in a multi-Scene batch and the user retries it
- **THEN** only Scene 8's logical generation SHALL receive a new attempt and completed Scene outputs SHALL remain untouched

### Requirement: Guard image completion against stale workers and inputs
The workflow SHALL condition image publication on the active attempt lease, unchanged step fingerprint, CURRENT source package, and current output-affecting configuration. A stale worker or stale input SHALL not move an output Asset or generation revision into the current role. A validated stale output MAY remain historical for audit.

#### Scenario: Visual input changes during execution
- **WHEN** the source package becomes stale while an image step is RUNNING
- **THEN** the step SHALL not publish its result as current even if the provider later succeeds

### Requirement: Image timeout and cancellation use existing control state
Image steps SHALL enforce the configured generation timeout and observe persisted cancellation. Local waiting SHALL stop on cancellation. Remote queued/running work SHALL be cancelled only through provider-supported targeted operations; unsupported or uncertain remote cancellation SHALL be reported explicitly.

#### Scenario: Cancel a queued provider prompt
- **WHEN** cancellation is requested and ComfyUI confirms the matching prompt is pending
- **THEN** the worker SHALL request deletion of that prompt and transition the local step to CANCELLED without publishing partial output

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

### Requirement: Preserve existing workflow boundaries
Hierarchical media rendering SHALL reuse the existing single database-backed queue and one-worker claim boundary. It SHALL not introduce Redis, RabbitMQ, a second queue, or implicit Story/Scene/image/TTS generation. Scene image generation SHALL remain explicit and completed accepted images SHALL be the only default render inputs.

#### Scenario: Render without AI providers
- **WHEN** Story, Scene, or image providers are idle or unavailable
- **THEN** persisted render steps SHALL still execute from already accepted media inputs without creating provider jobs
### Requirement: Safe render errors
Render failures SHALL persist a stable error code/message and bounded diagnostics naming the scope, missing dependency, FFmpeg/ffprobe failure, cancellation, stale input, or output validation problem. Raw shell commands, credentials, and full source prose SHALL not be exposed in routine status responses.

#### Scenario: FFmpeg failure
- **WHEN** FFmpeg exits unsuccessfully for a Scene Clip
- **THEN** the Scene job SHALL be failed with bounded diagnostics, the Chapter SHALL wait or fail on that dependency, and no partial Asset SHALL become current
### Requirement: Scoped render invalidation
The workflow invalidator SHALL support direct dependency invalidation from Scene image/MotionPlan/Timing to Scene Clip, Chapter Video, and Project Video, and from Chapter audio/subtitle to Chapter Video and Project Video. It SHALL not invalidate unrelated Scene or Chapter render steps.

#### Scenario: Change one Chapter
- **WHEN** Chapter 47's narration or subtitle changes
- **THEN** only Chapter 47's timing/Chapter Video descendants and Project assemblies containing Chapter 47 SHALL become stale; Chapters 1-46 SHALL not be reset
### Requirement: Render progress and cancellation
Hierarchical render jobs SHALL persist stage-specific progress, current render time when available, expected duration, attempts, safe stderr/diagnostic context, and cancellation state. Cancellation SHALL propagate through the existing `AbortSignal` and process runner, and partial outputs SHALL not satisfy dependent steps.

#### Scenario: Cancel a running render
- **WHEN** a running FFmpeg step is cancelled
- **THEN** the process SHALL terminate through the safe runner, the partial file SHALL remain unpublished, and dependent work SHALL remain non-complete
### Requirement: Retry at smallest render unit
A failed Scene Clip SHALL be explicitly retryable without rerunning successful sibling Scene Clips. A failed Chapter Video SHALL be retryable from valid Scene Clips. A Project assembly retry SHALL reuse valid current Chapter Videos. Technical retries SHALL retain unchanged direct-input fingerprints and shall not create duplicate matching work.

#### Scenario: Retry one failed Scene
- **WHEN** Scene Clip 127 fails
- **THEN** retry SHALL target only Scene Clip 127, leave valid Scene Clips 1-126 and later siblings reusable, and unblock dependent Chapter work after success
### Requirement: Persist hierarchical render work
The workflow SHALL materialize independently identifiable steps/jobs for building Scene timing, generating default MotionPlans, rendering Scene Clips, rendering Chapter Videos, and assembling Project Videos. Each step SHALL retain its scope, input fingerprint, render settings, progress, expected duration where known, and output linkage through existing durable records or an equivalent persisted projection. One render request SHALL not require one unbounded FFmpeg job for the full Story.

#### Scenario: Schedule a full Story
- **WHEN** a user explicitly schedules full-story Scene rendering
- **THEN** the system SHALL persist lower-level Scene/Chapter dependencies and a final Project step in dependency order and SHALL retain each unit's status independently
