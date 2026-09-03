## MODIFIED Requirements

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
### Requirement: Persist hierarchical render work
The workflow SHALL materialize independently identifiable steps/jobs for building Scene timing, generating default MotionPlans, rendering Scene Clips, rendering Chapter Videos, and assembling Project Videos. Each step SHALL retain its scope, input fingerprint, render settings, progress, expected duration where known, and output linkage through existing durable records or an equivalent persisted projection. One render request SHALL not require one unbounded FFmpeg job for the full Story.

#### Scenario: Schedule a full Story
- **WHEN** a user explicitly schedules full-story Scene rendering
- **THEN** the system SHALL persist lower-level Scene/Chapter dependencies and a final Project step in dependency order and SHALL retain each unit's status independently

### Requirement: Retry at smallest render unit
A failed Scene Clip SHALL be explicitly retryable without rerunning successful sibling Scene Clips. A failed Chapter Video SHALL be retryable from valid Scene Clips. A Project assembly retry SHALL reuse valid current Chapter Videos. Technical retries SHALL retain unchanged direct-input fingerprints and shall not create duplicate matching work.

#### Scenario: Retry one failed Scene
- **WHEN** Scene Clip 127 fails
- **THEN** retry SHALL target only Scene Clip 127, leave valid Scene Clips 1-126 and later siblings reusable, and unblock dependent Chapter work after success

### Requirement: Restart recovery
After an API, worker, or computer restart, completed timing, MotionPlan, Scene Clip, and Chapter Video outputs with matching current fingerprints SHALL remain reusable. Expired running render leases SHALL follow the existing recovery policy, and a recovered step SHALL not blindly re-run a completed lower-level unit.

#### Scenario: Resume after worker loss
- **WHEN** the worker stops after completing part of a Chapter or Project render
- **THEN** a restarted worker SHALL recover the remaining pending work and preserve all completed valid output Assets
#### Scenario: Worker dies during a step
- **WHEN** a worker stops while a step is running and its lease expires
- **THEN** a subsequent worker SHALL mark the prior attempt as worker-lost and deterministically make the step retryable or terminal, while leaving completed sibling steps untouched

### Requirement: Render progress and cancellation
Hierarchical render jobs SHALL persist stage-specific progress, current render time when available, expected duration, attempts, safe stderr/diagnostic context, and cancellation state. Cancellation SHALL propagate through the existing `AbortSignal` and process runner, and partial outputs SHALL not satisfy dependent steps.

#### Scenario: Cancel a running render
- **WHEN** a running FFmpeg step is cancelled
- **THEN** the process SHALL terminate through the safe runner, the partial file SHALL remain unpublished, and dependent work SHALL remain non-complete

### Requirement: Scoped render invalidation
The workflow invalidator SHALL support direct dependency invalidation from Scene image/MotionPlan/Timing to Scene Clip, Chapter Video, and Project Video, and from Chapter audio/subtitle to Chapter Video and Project Video. It SHALL not invalidate unrelated Scene or Chapter render steps.

#### Scenario: Change one Chapter
- **WHEN** Chapter 47's narration or subtitle changes
- **THEN** only Chapter 47's timing/Chapter Video descendants and Project assemblies containing Chapter 47 SHALL become stale; Chapters 1-46 SHALL not be reset

### Requirement: Safe render errors
Render failures SHALL persist a stable error code/message and bounded diagnostics naming the scope, missing dependency, FFmpeg/ffprobe failure, cancellation, stale input, or output validation problem. Raw shell commands, credentials, and full source prose SHALL not be exposed in routine status responses.

#### Scenario: FFmpeg failure
- **WHEN** FFmpeg exits unsuccessfully for a Scene Clip
- **THEN** the Scene job SHALL be failed with bounded diagnostics, the Chapter SHALL wait or fail on that dependency, and no partial Asset SHALL become current

### Requirement: Preserve existing workflow boundaries
Hierarchical media rendering SHALL reuse the existing single database-backed queue and one-worker claim boundary. It SHALL not introduce Redis, RabbitMQ, a second queue, or implicit Story/Scene/image/TTS generation. Scene image generation SHALL remain explicit and completed accepted images SHALL be the only default render inputs.

#### Scenario: Render without AI providers
- **WHEN** Story, Scene, or image providers are idle or unavailable
- **THEN** persisted render steps SHALL still execute from already accepted media inputs without creating provider jobs
