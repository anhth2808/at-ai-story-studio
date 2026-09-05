# ai video generation Specification

## Purpose
Add provider-neutral, local image-to-video generation for selected Scenes through one approved ComfyUI workflow, with readiness diagnostics, safe presets, durable provider-job semantics, and a reviewed raw AI Motion Asset lifecycle - without touching Chapter/Project rendering.

## Requirements

### Requirement: Provider-neutral video generation boundary
The system SHALL expose a video generation boundary whose request carries project, chapter, Scene, and Shot identity; exact source keyframe Asset ID/hash; optional continuation-source lineage; motion prompt; negative prompt; backend identity; legal dimensions/frame count/FPS; seed; and bounded provider settings without backend node IDs or raw workflow JSON. The result SHALL carry provider/backend, provider job ID, reproducibility metadata, actual dimensions/FPS/frame count/duration, persisted video Asset reference, and bounded warnings. Backend-specific behavior SHALL stay behind adapters.

#### Scenario: Request remains backend-neutral
- **WHEN** a Shot video generation is scheduled for Wan or LTX-2
- **THEN** the persisted domain request SHALL identify the backend and reproducible values but contain no ComfyUI node IDs or full graph

#### Scenario: Request stays provider-neutral
- **WHEN** a Scene or Shot AI video generation is scheduled
- **THEN** the persisted request SHALL contain no ComfyUI node IDs or raw workflow JSON and SHALL be replayable against any conforming backend implementation

### Requirement: One approved native ComfyUI image-to-video workflow
The system SHALL retain the approved native Wan 2.2 TI2V-5B workflow and SHALL add one versioned application-approved LTX-2 local workflow descriptor adapted from the inspected known-good topology. Each adapter SHALL validate required node classes, fixed links, model identities, and mapped inputs before submission. Arbitrary client-supplied workflow JSON SHALL remain rejected. Missing custom nodes required by the selected LTX workflow SHALL be reported honestly and SHALL not affect Wan readiness.

#### Scenario: Wan remains ready without LTX nodes
- **WHEN** native Wan requirements are present but LTX-specific nodes are absent
- **THEN** Wan readiness SHALL remain independently READY while LTX readiness reports its missing dependencies

#### Scenario: Validate before expensive submission
- **WHEN** a generation is submitted
- **THEN** the compiled graph SHALL be validated against the expected node ids, class types, inputs, and links before the request reaches ComfyUI, and an invalid graph SHALL fail without queueing

#### Scenario: No custom nodes required
- **WHEN** readiness probes the ComfyUI server
- **THEN** the workflow SHALL require only native core nodes, and any missing required node SHALL be reported as a named readiness blocker

### Requirement: Video readiness diagnostics
The system SHALL report AI video readiness separately from image generation readiness. Video readiness SHALL distinguish at minimum `NOT_CONFIGURED`, `COMFYUI_UNAVAILABLE`, `WORKFLOW_MISSING`, `VIDEO_MODEL_MISSING`, `DEPENDENCY_MISSING`, `INSUFFICIENT_CONFIGURATION`, `READY`, and `ERROR`, including whether each required model file is present on the server. Image readiness SHALL remain independently queryable.

#### Scenario: Image ready, video model missing
- **WHEN** Flux image models are installed but Wan video models are not
- **THEN** readiness SHALL report image generation READY and AI video VIDEO_MODEL_MISSING in separate results

### Requirement: VRAM-safe presets and OOM handling
The system SHALL offer bounded video generation presets (at least `LOW_VRAM`, `BALANCED`, `QUALITY`) defining width, height, frame count, steps, and guidance, with the default preset proven on the local RTX 3060 12GB by a real benchmark. Out-of-memory failures SHALL be classified distinctly and SHALL NOT be retried with identical settings; a retry after OOM SHALL require changed settings or explicit user action.

#### Scenario: OOM is reported, not hammered
- **WHEN** a generation fails with an out-of-memory condition
- **THEN** the job SHALL fail with an OOM-classified error persisting resolution/frames/model, and the worker SHALL not automatically resubmit the identical request

### Requirement: AiMotionPlan separate from image prompts
The system SHALL persist motion intent separately from the static Shot prompt. The compiled motion prompt SHALL assume the accepted keyframe establishes identity, clothing, initial pose, composition, Location, and object placement and SHALL emphasize changes, speed, camera movement, subtle environment motion, emotional timing, speaking behavior, and stability of face, body proportions, clothing, important objects, and background structure. Production defaults SHALL prefer STATIC, slow PUSH_IN, and justified subtle PULL_OUT; pan, orbit, and handheld SHALL require explicit Shot intent and supported bounded strength.

#### Scenario: Compile conservative motion
- **WHEN** no narrative motion is required
- **THEN** the production motion plan SHALL default to STATIC or subtle subject/environment motion rather than adding camera movement for novelty

#### Scenario: Motion prompt differs from image prompt
- **WHEN** a Scene has an accepted image generated from a detailed visual prompt
- **THEN** the AI video request motion prompt SHALL describe motion (subject action, environment motion, camera) and SHALL NOT duplicate the full image prompt text

### Requirement: Raw AI Motion Asset lifecycle
Each generated raw Shot clip SHALL remain immutable and persist exact source keyframe and continuation lineage, backend/workflow/model/settings metadata, seed, generation attempt, technical status, review status, automatic temporal QC state, critic evaluation identity, and current/freshness state. A raw clip SHALL become accepted/current only when required automatic and human gates pass. Historical rejected or stale clips SHALL remain queryable.

#### Scenario: Critic unavailable after generation
- **WHEN** a raw clip validates technically but its required temporal critic is unavailable
- **THEN** generation status MAY remain completed, quality status SHALL be unavailable, and the clip SHALL not be reported accepted unless explicit degraded policy permits and records it

#### Scenario: Corrupt output never publishes
- **WHEN** the provider returns a file that fails ffprobe validation
- **THEN** no raw Asset SHALL be published as current, the failure SHALL be recorded, and retry SHALL remain available

#### Scenario: Regenerate keeps history
- **WHEN** a user regenerates motion for a Scene that already has an accepted raw clip
- **THEN** a new revision with a new seed SHALL be created and the prior revision SHALL remain available and reviewable

### Requirement: Long-running provider job durability
AI video jobs SHALL persist their provider job id before submission and SHALL remain recoverable across worker restarts. Resubmission SHALL be idempotent: an existing provider job SHALL be reconciled through history/queue state instead of submitted twice. A configurable video generation timeout longer than the image default SHALL bound each attempt, and jobs SHALL not remain RUNNING indefinitely. Cancellation SHALL use the provider's real capability; where the server cannot cancel a running job, Studio SHALL stop local waiting and report the limitation rather than fake cancellation.

#### Scenario: Restart during generation
- **WHEN** the worker restarts while a provider job is queued or running
- **THEN** the recovered step SHALL reconcile the persisted provider job id against ComfyUI history/queue and resume polling or download instead of submitting a duplicate job

#### Scenario: Retry versus regenerate
- **WHEN** a technical failure is retried
- **THEN** the same intended output (same request snapshot including seed) SHALL be re-attempted, while regenerate SHALL produce a new revision with a new seed

### Requirement: Source image identity isolation
The provider SHALL receive only the source image, motion instructions, and generation settings. It SHALL NOT receive or query Character, Location, StoryState, or Visual Bible data; visual consistency is already resolved upstream in the accepted Scene image.

#### Scenario: Provider input is bounded
- **WHEN** a generation request is compiled
- **THEN** the submitted graph SHALL contain the image, motion prompt, negative prompt, and settings only, with no Story context reconstruction

### Requirement: Valid continuation source replaces keyframe generation
When strict continuation eligibility passes, video generation SHALL consume a managed extracted frame from the previous accepted current Shot clip and SHALL persist source clip/Shot/frame lineage. If the source cannot be extracted or is stale, missing, rejected, or wrong-revision, scheduling SHALL fail with a continuation prerequisite error and SHALL not generate an unrelated keyframe silently.

#### Scenario: Missing previous clip
- **WHEN** a continuation Shot has no eligible prior accepted video clip
- **THEN** the system SHALL report `CONTINUATION_SOURCE_MISSING` or equivalent and SHALL not submit video generation
