## Purpose

Coordinate the existing Story-to-Video domain workflows into one durable, reviewable production operation. The capability owns run coordination, not canonical Story, Chapter, Scene, Asset, timeline, or render state.

## ADDED Requirements

### Requirement: Production run is a coordination record
The system SHALL provide a ProductionRun associated with one Project, one ProductionProfile revision, and an explicit scope. The run SHALL record status, current stage, creation/start/pause/completion times, requester, run and scope fingerprints, bounded error information, and safe progress metadata. It SHALL reference canonical domain records rather than duplicating their content or media state.

Supported run statuses SHALL be `DRAFT`, `READY`, `RUNNING`, `WAITING_FOR_USER`, `PAUSED`, `FAILED`, `CANCELLED`, and `COMPLETED`. `WAITING_FOR_USER` SHALL not be represented as failure, and `COMPLETED` SHALL require a ready publication package for every production run.

#### Scenario: Create a run for an existing project
- **WHEN** a user creates a full-project run with a valid profile and project
- **THEN** the system SHALL persist a run in `DRAFT` or `READY` state with a deterministic input fingerprint and SHALL leave canonical Story and media records unchanged

#### Scenario: Invalid project is rejected
- **WHEN** a run references a missing or archived project
- **THEN** the request SHALL fail before creating executable production work

#### Scenario: Waiting is not failure
- **WHEN** an open blocking intervention requires user action
- **THEN** the run SHALL expose `WAITING_FOR_USER`, retain the blocking reason, and SHALL remain resumable rather than becoming `FAILED`

### Requirement: Production profiles define automation policy
The system SHALL provide revisioned profiles with the names `MANUAL_REVIEW`, `BALANCED`, and `AUTO`, plus editable bounded settings for approval gates, chapter batch size, image candidate count, image regeneration limit, AI-motion policy, AI priority threshold, render preset, subtitle/music behavior, quality-warning behavior, retry limit, expensive-work caps, and disk-space guardrails. Settings SHALL be validated at the boundary and SHALL not expose arbitrary provider or filter configuration as production policy.

The default profile SHALL be `BALANCED`. Its default AI-motion policy SHALL be selective rather than all-scenes generation, and Ken Burns SHALL remain the default for scenes not selected for AI motion. `AUTO` SHALL continue to stop on hard failures, missing required dependencies, invalid content, unavailable required providers, and resource failures.

#### Scenario: Manual review profile pauses at approval gates
- **WHEN** a run uses `MANUAL_REVIEW` and Story or image approval is required
- **THEN** the run SHALL pause with a typed intervention after the generated canonical candidate is available and SHALL not schedule downstream work that requires approval

#### Scenario: Balanced profile uses bounded automation
- **WHEN** a run uses `BALANCED`
- **THEN** it SHALL automate eligible planning, chapter, audio, scene, visual, prompt, and image work while retaining configured review and hard-failure gates

#### Scenario: AI motion is capped
- **WHEN** eligible high-priority scenes exceed `maxAiVideoScenes`
- **THEN** selection SHALL be deterministic by existing scene order and priority, the remaining scenes SHALL use Ken Burns, and the run SHALL record the cap decision

### Requirement: Production stages expose product-level progress
The system SHALL persist ordered ProductionStage records for the product stages `STORY`, `CHAPTERS`, `AUDIO`, `SCENES`, `VISUAL_PROFILES`, `VISUAL_PROMPTS`, `SCENE_IMAGES`, `AI_MOTION`, `TIMELINE`, `RENDER`, and `PUBLICATION_PACKAGE`. Each stage SHALL record status, attempt, input fingerprint, timestamps, summary, bounded progress counts, blocking reason, fallback/warning summary, and safe error information.

Stage statuses SHALL include `PENDING`, `READY`, `RUNNING`, `WAITING`, `COMPLETED`, `SKIPPED`, `FAILED`, and `STALE`. A stage MAY aggregate many existing workflow steps and jobs, and user status SHALL report counts such as completed/total, reusable, generated, waiting review, failed, and blocked without exposing low-level rows as the primary view.

#### Scenario: Aggregate image jobs
- **WHEN** a Scene Images stage contains 100 existing image jobs
- **THEN** the stage SHALL expose a bounded `completed / total` summary and diagnostics links while preserving individual job status for detailed troubleshooting

#### Scenario: Stage order is explicit
- **WHEN** a full-project run is planned
- **THEN** stages SHALL follow the declared dependency order and SHALL not expose internal worker job names as the product pipeline order

### Requirement: Preflight reports hard blocks and warnings
Before a run starts, the system SHALL provide a structured ProductionPreflight result with status `READY`, `READY_WITH_WARNINGS`, or `BLOCKED`. Each issue SHALL include a stable code, severity, affected stage, safe message, and recommended action. Preflight SHALL check project and scope validity, Story readiness where generation is needed, OMP readiness where required, TTS readiness, FFmpeg/ffprobe readiness, image-provider readiness where images are required, AI-video readiness when selected by policy, model/workflow availability, disk availability where measurable, and sufficient inputs to begin.

Missing optional AI-video capability SHALL be a warning when the selected profile permits Ken Burns fallback. Missing required image generation, narration provider, render tools, invalid Story state, or absent required media SHALL block the run. Preflight SHALL not enqueue jobs, mutate canonical state, or generate content.

#### Scenario: Optional AI provider unavailable
- **WHEN** selected policy permits fallback and ComfyUI video readiness is unavailable
- **THEN** preflight SHALL return `READY_WITH_WARNINGS` with an AI-motion warning and an explicit Ken Burns fallback policy

#### Scenario: Required image provider unavailable
- **WHEN** missing Scene images are required and the image provider is unavailable
- **THEN** preflight SHALL return `BLOCKED` with a named image readiness issue and SHALL create no production or provider jobs

#### Scenario: Preflight is side-effect free
- **WHEN** a user requests preflight repeatedly
- **THEN** database state, canonical revisions, jobs, assets, and provider call counts SHALL remain unchanged

### Requirement: Production plan is a side-effect-free dry run
The system SHALL provide a ProductionPlan for a run scope without scheduling work. The plan SHALL resolve current canonical state and classify each product stage and relevant unit as `REUSE`, `BUILD`, `REVIEW`, or `BLOCKED`. It SHALL report stage counts, dependencies, current/stale/missing outputs, expected downstream rebuilds, warnings, named blockers, approximate work estimates, and known historical duration or usage data only when available.

The plan SHALL consume existing domain freshness, dependency, and render-plan decisions rather than implementing a second invalidation engine. It SHALL not load complete media bytes, assemble a full novel prompt, call an LLM or media provider, create workflow jobs, or alter current pointers.

#### Scenario: Plan partially current state
- **WHEN** a project has current Story and Chapters, some current audio, stale Scenes, missing images, and a current Chapter Video for an unaffected chapter
- **THEN** the plan SHALL classify each affected unit separately, preserve reusable counts, show review or block reasons, and identify only the dependent rebuild chain

#### Scenario: Plan repeats deterministically
- **WHEN** canonical state, profile revision, and scope are unchanged
- **THEN** repeated plans SHALL have equivalent classifications and fingerprints apart from request timestamps

#### Scenario: Unknown estimates remain unknown
- **WHEN** no historical generation duration or provider usage is available
- **THEN** the plan SHALL leave that estimate unavailable and SHALL not invent time, token, or cost values

### Requirement: Production orchestration schedules existing workflows
Starting a ready run SHALL create or reuse persisted stage state and schedule only the existing domain operations needed by the current plan. The orchestration layer SHALL inspect, schedule, reconcile, and transition; it SHALL not execute LLM, TTS, image, AI-video, or FFmpeg work directly and SHALL not create a giant long-running production job.

The default full-project dependency order SHALL be:

```text
STORY -> CHAPTERS -> AUDIO -> SCENES -> VISUAL_PROFILES -> VISUAL_PROMPTS
      -> SCENE_IMAGES -> AI_MOTION -> TIMELINE -> RENDER -> PUBLICATION_PACKAGE
```

Audio may be prepared from current Chapters while scene planning is independent when canonical dependencies permit it, but downstream stages SHALL not consume missing required inputs. The orchestrator SHALL preserve manual individual workflow entry points.

#### Scenario: Start an empty Idea project
- **WHEN** a valid Idea-only project starts a full run with controlled providers
- **THEN** the run SHALL schedule Story generation first, then reuse the existing chapter, TTS, Scene, visual, image, timeline, render, and package operations in dependency order

#### Scenario: Existing Story is current
- **WHEN** a project already has a valid current Story or manual Chapters sufficient for the selected scope
- **THEN** the Story stage SHALL be marked `REUSE` or `COMPLETED` and SHALL not regenerate Story content automatically

#### Scenario: Domain job fails
- **WHEN** an existing domain job fails
- **THEN** the owning ProductionStage SHALL surface the failure and retryability, and dependent stages SHALL remain blocked or waiting rather than being skipped

### Requirement: Stage fingerprints explain reuse
Each ProductionStage SHALL have a deterministic fingerprint over only its direct canonical inputs, relevant profile settings, selected scope, and stage algorithm version. The ProductionRun fingerprint SHALL cover project state, profile revision, scope, and requested options but SHALL not replace stage fingerprints.

Stage fingerprints SHALL be derived from canonical services. They SHALL not include timestamps, transient job IDs, unrelated chapters, candidate ordering that does not affect current output, or full media bytes. A changed direct input SHALL make only that stage and its canonical descendants stale according to existing invalidation rules.

#### Scenario: Timing-only change reuses AI motion
- **WHEN** SceneTiming changes for an AI scene
- **THEN** the AI raw generation fingerprint SHALL remain reusable, while normalized SceneClip and dependent render/package stages become buildable as required

#### Scenario: One Scene image changes
- **WHEN** one accepted Scene image changes
- **THEN** the plan SHALL rebuild only that Scene's dependent chain and affected Chapter/Project/package outputs while unrelated Scene and Chapter outputs remain reusable

### Requirement: Orchestration advances idempotently
Calling the advance operation multiple times, concurrently or after a client retry, SHALL be safe. It SHALL reuse a matching pending/running/completed stage or existing domain job, SHALL not create duplicate jobs for the same valid stage fingerprint, and SHALL serialize conflicting updates through the existing database transaction/lease model.

Only one active ProductionRun with an overlapping scope SHALL be allowed for a Project. A new non-overlapping or terminal run MAY be created according to scope policy; simultaneous overlapping runs SHALL be rejected or explicitly reported as a conflict before work is scheduled.

#### Scenario: Double-click Start
- **WHEN** two identical start requests arrive for a ready run
- **THEN** one persisted run transition SHALL win and both responses SHALL identify the same run/stage work without duplicate expensive jobs

#### Scenario: Concurrent advance
- **WHEN** two reconciliation calls inspect the same pending stage
- **THEN** at most one call SHALL materialize each matching domain job and the other SHALL reuse it

### Requirement: Restart reconciliation resumes canonical work
On API or worker restart, and on explicit reconciliation, RUNNING or WAITING production runs SHALL be inspected against current canonical state and persisted domain jobs. Completed valid outputs SHALL remain completed and reusable. Missing, stale, expired, failed, or unresolved stages SHALL be resumed, blocked, or retried according to profile and error policy. Reconciliation SHALL not start from zero or regenerate successful expensive outputs.

A run snapshot SHALL retain enough fingerprints and revision references to explain a stale transition, while decisions SHALL use live canonical state. Manually completed work created while a run is paused or waiting SHALL be detected and reused.

#### Scenario: Resume halfway through images
- **WHEN** 54 of 100 image outputs are current, the worker stops, and the application restarts
- **THEN** reconciliation SHALL preserve the 54 outputs, schedule only remaining eligible work, and SHALL not duplicate current image jobs

#### Scenario: Canonical state changed during a run
- **WHEN** a user edits a relevant Chapter or replaces a Scene image while a run is active
- **THEN** only affected stages SHALL become stale or blocked, stale in-flight results SHALL be rejected by existing domain guards, and unrelated completed work SHALL remain usable

### Requirement: Human intervention is durable and actionable
The system SHALL persist ProductionIntervention records with run/stage ownership, type, severity, status, affected entity type and ID, safe message, recommended actions, creation/resolution times, and optional resolution metadata. Types SHALL cover at least `STORY_APPROVAL_REQUIRED`, `IMAGE_REVIEW_REQUIRED`, `REFERENCE_REQUIRED`, `CONTINUITY_STALE`, `PROVIDER_CONFIGURATION_REQUIRED`, `RENDER_ASSET_MISSING`, and `QUALITY_REVIEW_REQUIRED`. Statuses SHALL include `OPEN`, `RESOLVED`, and `DISMISSED`.

Blocking interventions SHALL keep the run in `WAITING_FOR_USER`. Non-blocking warnings SHALL remain visible in the intervention inbox and final audit summary. Recommended actions SHALL link to existing Story, Visual Bible, Scene, Image, Timeline, or Render surfaces rather than embedding duplicate editors in the production dashboard.

#### Scenario: Image approval pauses a run
- **WHEN** generated Scene image candidates exist but profile policy requires image approval
- **THEN** the image stage SHALL create blocking review interventions, the run SHALL enter `WAITING_FOR_USER`, and no dependent SceneClip work SHALL use unapproved candidates

#### Scenario: User resolves review
- **WHEN** the user accepts or replaces every blocking image and resumes the run
- **THEN** reconciliation SHALL detect current accepted assets, resolve matching interventions, and continue without creating a new ProductionRun

#### Scenario: Continuity is stale
- **WHEN** an older Chapter edit marks later generated Chapters `CONTINUITY_STALE`
- **THEN** the run SHALL expose the affected suffix as a continuity intervention and SHALL not silently regenerate the suffix without the configured user/policy decision

### Requirement: Pause, resume, and cancel are safe
Pause SHALL stop future production scheduling without corrupting or deleting canonical outputs. Already-running domain jobs SHALL follow their existing cancellation semantics and MAY finish if they cannot be safely interrupted. Resume SHALL reconcile live state before scheduling more work. Cancel SHALL prevent future production scheduling, transition the run to `CANCELLED`, and retain all completed Story, audio, image, AI-video, SceneClip, ChapterVideo, ProjectVideo, and package history.

#### Scenario: Pause before next stage
- **WHEN** a user pauses a running production
- **THEN** no new stage jobs SHALL be scheduled after the pause is persisted, and existing completed outputs SHALL remain current

#### Scenario: Resume after manual work
- **WHEN** a user manually generates a missing image while a run is paused
- **THEN** resume SHALL reuse the new current asset and schedule only remaining dependent work

#### Scenario: Cancel with active work
- **WHEN** a user cancels a run with a domain provider job running
- **THEN** future scheduling SHALL stop, safe cancellation SHALL be requested through the existing job path where supported, and completed assets SHALL remain usable

### Requirement: Retry is bounded and unit-scoped
The system SHALL support retrying a failed ProductionStage and, where applicable, the underlying existing failed job at its smallest supported unit. Automatic retry SHALL apply only to classified technical retryable errors and SHALL stop at the profile limit. Invalid content, missing models, missing configuration, out-of-disk failures, and repeated non-retryable errors SHALL create a blocking intervention or terminal failure rather than an infinite loop.

Stage retry SHALL preserve completed sibling jobs and unchanged input fingerprints. A retry SHALL not creatively regenerate Story, images, or AI motion unless the user explicitly chooses the existing regeneration action.

#### Scenario: One TTS segment fails
- **WHEN** one TTS segment fails and other segments are complete
- **THEN** the Audio stage retry SHALL reuse completed segments and retry only the failed segment plus required merge/subtitle descendants

#### Scenario: Optional AI motion fails
- **WHEN** a selected AI-motion generation fails and profile policy permits fallback
- **THEN** the run SHALL record a warning with the technical error and explicit `KEN_BURNS` fallback, then continue with the normal timeline/render stages

#### Scenario: Required render fails
- **WHEN** required ProjectVideo rendering fails after earlier stages completed
- **THEN** the run SHALL become `FAILED` or wait for retry while retaining all earlier outputs and retrying only the render/package tail

### Requirement: AI motion policy and fallback are auditable
AI Motion selection SHALL reuse the canonical Scene motion source and priority. Policies SHALL include `OFF`, `SELECTED_ONLY`, `HIGH_PRIORITY_ONLY`, and `ALL_ELIGIBLE`; the default SHALL not animate every Scene. When AI motion is optional, unselected Scenes SHALL use Ken Burns and failed/rejected/unavailable AI motion SHALL fall back only when the profile explicitly allows it.

Every fallback SHALL be recorded with Scene identity, source stage, reason/error code, selected fallback, and timestamp. A fallback SHALL not mark required visual output missing when the resulting canonical SceneClip is valid.

#### Scenario: High-priority policy
- **WHEN** the profile uses `HIGH_PRIORITY_ONLY`
- **THEN** only current eligible high-priority Scenes within the cap SHALL receive AI-motion work, and all others SHALL remain Ken Burns without failed AI jobs

#### Scenario: AI output is rejected
- **WHEN** a generated AI motion asset is rejected during review
- **THEN** the run SHALL either wait for a replacement or record the explicit Ken Burns fallback according to profile policy, never silently accepting the rejected asset

### Requirement: Timeline and render consume canonical outputs
The Timeline stage SHALL reuse existing SceneTiming, MotionPlan/AiMotionPlan, SceneClip normalization, ChapterVideo, and ProjectVideo workflows. It SHALL schedule only missing or stale canonical descendants after required audio, scenes, images, and motion policy decisions are resolved. The render stage SHALL never create a ProductionRun-specific renderer and SHALL use only current fingerprint-compatible dependencies.

The final render stage SHALL perform a deterministic quality gate before package creation: current ProjectVideo exists, its Asset is READY/current, ffprobe validates readability and required streams, all selected Chapters are included, narration exists, subtitle requirements are satisfied, no required stage is stale, and no blocking intervention remains.

#### Scenario: Render waits for a missing ChapterVideo
- **WHEN** a selected ChapterVideo is missing or stale
- **THEN** the run SHALL schedule or wait for that existing Chapter render according to the plan and SHALL not assemble the ProjectVideo from stale content

#### Scenario: Final quality gate rejects incomplete output
- **WHEN** the ProjectVideo file is missing, unreadable, stale, missing required audio, or missing a required Chapter
- **THEN** the render/package boundary SHALL fail with a named issue and SHALL not mark production complete

### Requirement: Stage and run metrics are honest
The system SHALL aggregate actual available metrics for a run, including elapsed duration, OMP usage, known token/cost values, TTS duration, generated image/AI-video counts, known GPU generation time, rendered clip counts, final video duration, and storage added. It SHALL preserve null/unknown values when providers do not report them. Estimates SHALL be labeled approximate and SHALL use simple recent historical averages or medians where available.

#### Scenario: Provider omits usage
- **WHEN** an OMP or media provider returns no token or cost information
- **THEN** run metrics SHALL retain unknown values and SHALL still report successful stage completion

#### Scenario: Review run audit
- **WHEN** a completed or failed run is inspected
- **THEN** the status SHALL explain what was reused, generated, failed, retried, approved, and fell back without storing massive prompts or logs in the run record

### Requirement: Production API exposes bounded control surfaces
The system SHALL expose validated API operations for profile CRUD, run creation, preflight, plan preview, start, pause, resume, cancel, retry stage, current status, stage detail, intervention list, intervention resolve/dismiss, publication package access, and package export. Responses SHALL contain bounded DTOs, safe errors, stable identifiers, progress counts, recommendations, and Asset URLs where needed; they SHALL not expose absolute paths, credentials, raw provider graphs, raw FFmpeg filters, or full media binaries in JSON.

Route handlers SHALL remain thin and SHALL delegate ownership, validation, scheduling, and transition rules to application services. Existing individual Story, Chapter, TTS, Scene, image, AI-motion, Timeline, and render routes SHALL remain usable without a ProductionRun.

#### Scenario: Plan then start
- **WHEN** a user requests a plan and then explicitly starts the same scope
- **THEN** the plan response SHALL be observable before any job is queued, and start SHALL return the persisted run plus durable stage/job identifiers

#### Scenario: Retry failed stage
- **WHEN** a user retries a failed stage
- **THEN** the API SHALL return the same run identity, preserve successful prior stages, and expose the new attempt through status polling

### Requirement: Production UI answers what needs attention
The web application SHALL expose a dedicated Production area with profile selection, Preview Plan, Start Production, run status, current stage, stage-based progress, approximate remaining work where known, stage details, Needs Attention interventions, activity history, Pause, Resume, Cancel, Retry, and a ready package/export action. The UI SHALL link to existing editing/review surfaces for Story approval, references, images, continuity, and render details.

The UI SHALL distinguish `REUSE`, `BUILD`, `REVIEW`, `BLOCKED`, `WAITING_FOR_USER`, `FAILED`, and `COMPLETED` with visible text and accessible labels, provide loading/error/empty/retry states, and remain usable on narrow screens without color-only meaning or a second timeline/editor.

#### Scenario: Review blocked images
- **WHEN** the run is waiting for image review
- **THEN** the Production view SHALL show the number and identity of blocking scenes, a link to the existing image review surface, and a Resume action after resolution

#### Scenario: Completed package
- **WHEN** the final quality gate and package validation pass
- **THEN** the UI SHALL show `READY TO PUBLISH`, package metadata, final video playback/download, chapter markers, and local export without offering YouTube upload

### Requirement: Production scope is bounded
The initial system SHALL support `FULL_PROJECT` and inclusive `CHAPTER_RANGE` scopes. Full project SHALL be the primary default. A range SHALL include only Chapters within the requested inclusive bounds and SHALL identify its scope in fingerprints, status, ProjectVideo role, and publication package. Arbitrary user-defined DAG selection, multi-project batch production, channel farms, and scheduling queues SHALL not be supported.

#### Scenario: Run a chapter range
- **WHEN** a user starts Chapters 5 through 10
- **THEN** only those Chapters and their dependent canonical work SHALL be planned/scheduled, and the resulting package SHALL identify the range

### Requirement: Completed production is a real end-to-end outcome
A ProductionRun SHALL not be considered complete merely because coordination rows exist. For a configured full run, completion SHALL require the actual canonical path from Story or existing Chapters through required audio, scenes, visual assets, current Scene images or explicit fallback, timeline, SceneClip/ChapterVideo/ProjectVideo render, final quality gate, and a READY PublicationPackage.

#### Scenario: Three-Chapter controlled production
- **WHEN** a small three-Chapter fixture is run with controlled or real providers and all required interventions are resolved
- **THEN** the persisted run SHALL reach `COMPLETED`, the final MP4 and package references SHALL be real validated Assets, and stage status SHALL prove reuse and generated work rather than a simulated shortcut
