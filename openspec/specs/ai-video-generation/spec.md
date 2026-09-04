# ai video generation Specification

## Purpose
Add provider-neutral, local image-to-video generation for selected Scenes through one approved ComfyUI workflow, with readiness diagnostics, safe presets, durable provider-job semantics, and a reviewed raw AI Motion Asset lifecycle - without touching Chapter/Project rendering.

## Requirements


### Requirement: Provider-neutral video generation boundary
The system SHALL expose a `VideoGenerationProvider` boundary with `generate(request, signal?)`, `readiness(settings, signal?)`, and `cancel(providerJobId, settings, signal?)`. The `VideoGenerationRequest` SHALL carry project/chapter/scene identity, the exact source Scene image Asset id, motion prompt, negative prompt, width, height, frame count, fps, seed, motion strength, and provider settings - and SHALL NOT carry provider node ids. The `VideoGenerationResult` SHALL carry provider name, provider job id, seed, dimensions, fps, frame count, duration, the persisted video Asset reference, and bounded metadata. Provider-specific behavior SHALL stay behind this boundary.

#### Scenario: Request stays provider-neutral
- **WHEN** a Scene AI video generation is scheduled
- **THEN** the persisted request SHALL contain no ComfyUI node ids or raw workflow JSON and SHALL be replayable against any conforming provider implementation

### Requirement: One approved native ComfyUI image-to-video workflow
The system SHALL implement exactly one approved workflow template `image-to-video-v1` targeting Wan 2.2 TI2V-5B with only native ComfyUI nodes (`UNETLoader`, `CLIPLoader`, `VAELoader`, `ModelSamplingSD3`, two `CLIPTextEncode`, `LoadImage`, `Wan22ImageToVideoLatent`, `KSampler`, `VAEDecode`, `CreateVideo`, `SaveVideo`). The graph SHALL be built in code following the existing template convention, validated against a fixed node/link specification before every submission, and versioned so mapping changes invalidate stored fingerprints. Arbitrary user-supplied workflow JSON SHALL be rejected. The mapping SHALL set the source image, motion prompt, negative prompt, seed, resolution, frame count, and model components from the request.

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
The system SHALL persist an `AiMotionPlan` per Scene revision, separate from the Visual Prompt Package, holding character action, environment motion, camera intent from a bounded vocabulary, motion intensity (`SUBTLE` default, `MEDIUM`, `STRONG`), and an optional priority hint. The compiled motion prompt SHALL emphasize what moves rather than repeating full visual identity text, and its fingerprint SHALL cover the intent fields. Construction SHALL be deterministic from Scene metadata, with optional OMP structuring through the existing OMP agent boundary. Default prompts SHALL avoid violent camera movement, large pose changes, complex hand interaction, and multi-character choreography.

#### Scenario: Motion prompt differs from image prompt
- **WHEN** a Scene has an accepted image generated from a detailed visual prompt
- **THEN** the AI video request motion prompt SHALL describe motion (subject action, environment motion, camera) and SHALL NOT duplicate the full image prompt text

### Requirement: Raw AI Motion Asset lifecycle
Each provider output SHALL be persisted as an immutable raw Asset of a dedicated type (`AI_SCENE_VIDEO`) with ffprobe validation before publication (video stream present, duration > 0, valid dimensions, sensible fps/frame count, readable file). The generation record SHALL persist the exact source image Asset id and hash, motion plan fingerprint, provider, workflow template and mapping version, model identifier, generation settings, seed, status, attempt, error, and generation duration. The raw generation fingerprint SHALL cover source image hash, motion prompt/plan fingerprint, provider, workflow template version, model, settings, and seed. Revisions SHALL accumulate; nothing is overwritten. Raw clips SHALL carry review state `UNREVIEWED`, `ACCEPTED`, or `REJECTED` with issue tags (including identity/motion/camera categories) and user notes, and only an accepted current raw clip SHALL feed production SceneClips. Audio in provider output SHALL never become narration.

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
