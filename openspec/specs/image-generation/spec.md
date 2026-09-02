## Purpose

Define the observable contract for generating, validating, storing, reviewing, retrying, and regenerating real Scene images from persisted Visual Prompt Packages through controlled image providers.

## Requirements

### Requirement: Visual Prompt Package is the provider input
The system SHALL create image-generation requests from one persisted `CURRENT` Visual Prompt Package and SHALL carry its project, Scene, package identity, effective positive prompt, negative prompt, fingerprint, requested dimensions, concrete seed, bounded generation settings, reference-asset identifiers, and an explicit conditioning block that defaults to text-only and otherwise binds specific character identifiers to specific approved reference assets. An image provider SHALL NOT independently query or reconstruct Story Blueprint, chapter prose, characters, locations, StoryState, or other narrative context, and SHALL NOT resolve conditioning references by prompt name order alone.

#### Scenario: Generate from a current package
- **WHEN** a user requests an image for a Scene with a CURRENT Visual Prompt Package
- **THEN** the provider request SHALL contain the package prompt data and fingerprint without loading independent Story context

#### Scenario: Reject a stale package
- **WHEN** a user requests an image for a STALE Visual Prompt Package without an explicit override
- **THEN** the system SHALL reject scheduling with an actionable stale-input error and require the package to be rebuilt

#### Scenario: Request carries explicit conditioning mapping
- **WHEN** a conditioned generation is scheduled from a package whose characters have approved references
- **THEN** the request SHALL bind each conditioned character identifier to exactly one reference asset identifier and content hash, persisted with the generation

### Requirement: Narrow provider-neutral contract
The system SHALL expose a bounded image-provider contract for generation, status/result retrieval, classified errors, timeout, and cancellation where supported. Provider-specific workflow nodes, checkpoint files, scheduler details, conditioning node graphs, and server routes SHALL remain outside provider-neutral Scene, Style Bible, and Visual Prompt Package data. Provider-neutral data SHALL express conditioning intent (mode and character-to-reference binding) without encoding node-level graphs.

#### Scenario: Preserve reference assets for a future workflow
- **WHEN** a Visual Prompt Package contains project-owned reference asset identifiers and the selected workflow does not condition on them
- **THEN** the request contract SHALL retain those identifiers and the result/UI SHALL state that they did not condition this generation

#### Scenario: Conditioning intent stays provider-neutral
- **WHEN** a conditioned request is built
- **THEN** provider-neutral fields SHALL contain only mode and character-to-reference bindings while the provider adapter derives its own node graph

### Requirement: Minimal project image settings
The system SHALL persist project-owned image settings containing provider, base URL, connection and generation timeout, approved workflow template, model-component selections, width, height, steps, guidance, sampler hint, `RANDOM` or `FIXED` seed mode, conditioning mode, and a default-off `requireImageApproval` policy. It SHALL provide safe defaults without making one URL, model, or resolution the only supported value. Only output-affecting fields SHALL participate in image settings fingerprints and generation invalidation.

#### Scenario: Configure local ComfyUI
- **WHEN** a user saves a valid local ComfyUI URL, approved workflow, available model components, bounded generation settings, and approval policy
- **THEN** the settings SHALL survive restart and SHALL not place model or node values in the Style Bible

#### Scenario: Reject excessive settings
- **WHEN** settings exceed supported bounds or name an unapproved template
- **THEN** the update SHALL fail without replacing the current valid configuration

#### Scenario: Change approval policy only
- **WHEN** a user changes only `requireImageApproval`
- **THEN** existing generation fingerprints and visual freshness SHALL remain unchanged and image-generation jobs SHALL not be invalidated

### Requirement: Actionable readiness
The system SHALL expose `NOT_CONFIGURED`, `UNREACHABLE`, `READY`, `INVALID_WORKFLOW`, `INCOMPATIBLE_API`, and `ERROR` readiness states. A connection test SHALL validate server reachability, required API behavior, approved workflow nodes/inputs for every workflow the project may execute (including the conditioned workflow when conditioning is enabled or offered), output mapping, and required configured model availability without running an expensive generation, and SHALL surface an explicit conditioning readiness diagnostic.

#### Scenario: Required model is absent
- **WHEN** the server is reachable but a configured model component is not reported by ComfyUI
- **THEN** readiness SHALL return a non-ready workflow/model diagnostic and generation SHALL fail before submission

#### Scenario: Server is offline
- **WHEN** the configured server cannot be reached within the connection timeout
- **THEN** readiness SHALL return `UNREACHABLE` with a safe actionable message rather than an opaque network exception

#### Scenario: Conditioned workflow cannot run
- **WHEN** conditioning is enabled but the server lacks the conditioned workflow's required nodes
- **THEN** readiness SHALL report a non-ready conditioning diagnostic with missing-node detail instead of a generic READY

### Requirement: Controlled ComfyUI template execution
The ComfyUI integration SHALL execute only application-approved API-format workflow templates: the text-to-image template and the reference-conditioned template added by reference conditioning. Prompt, negative prompt, seed, width, height, steps, guidance, sampler, configured model components, reference-image inputs, and output node mappings SHALL be validated before submission against the selected template. Arbitrary workflow JSON or executable/custom-node code SHALL NOT be accepted from API clients.

#### Scenario: Expected node is missing
- **WHEN** an expected mapped node or input is removed from an approved workflow
- **THEN** generation SHALL fail with `WORKFLOW_INVALID` before the workflow is submitted

#### Scenario: Map deterministic inputs
- **WHEN** a known package, settings, and conditioning fixture is mapped
- **THEN** every supported prompt, seed, resolution, step, guidance, sampler, model, and reference-image field SHALL appear at the configured template node/input

### Requirement: Real ComfyUI lifecycle completion
The ComfyUI provider SHALL persist or deterministically assign a provider prompt ID, submit the mapped workflow, observe or poll the matching prompt through terminal success/failure, load its history, and retrieve output through the provider output route. Successful submission alone SHALL NOT complete generation.

#### Scenario: Submission accepted but generation fails
- **WHEN** ComfyUI accepts a prompt and later reports execution failure
- **THEN** the generation SHALL be `FAILED` with `GENERATION_FAILED` and SHALL publish no current image

#### Scenario: Generation succeeds without an output image
- **WHEN** history reports terminal success but the mapped output node has no image
- **THEN** the generation SHALL fail with `OUTPUT_MISSING`

### Requirement: Seed and resolution are reproducible
Every generated revision SHALL persist `requestedSeed` and `actualSeed` plus actual width and height. `RANDOM` mode SHALL resolve to a concrete seed before provider submission. `FIXED` and same-seed regeneration SHALL reuse the requested seed. Dimensions MAY be normalized by the approved provider workflow but actual output dimensions SHALL be recorded.

#### Scenario: Generate using random seed
- **WHEN** seed mode is RANDOM
- **THEN** a concrete valid seed SHALL be persisted before submission and returned as the actual seed for reproducibility

#### Scenario: Regenerate with same seed
- **WHEN** a user selects same-seed regeneration
- **THEN** a new revision SHALL use the previous actual seed while preserving the previous image

### Requirement: Immutable Scene image revisions
The system SHALL persist every generated Scene image attempt with a stable application generation ID, project ID, Scene ID, Visual Prompt Package ID, provider, generation status, requested/actual seed, requested/actual dimensions, provider prompt ID, input fingerprint, workflow/version, attempt information, error classification, timestamps, duration, result asset ID when present, optional regeneration feedback, and optional candidate-set identifier and candidate index. A candidate set SHALL persist its common Scene revision, package, effective mode, reference dependency, settings, workflow, and instruction provenance, while every candidate SHALL retain the complete request snapshot required for independent retry and restart recovery. Prior completed revisions and candidate sets SHALL NOT be overwritten.

#### Scenario: Regenerate with a new seed
- **WHEN** a Scene with one completed image is regenerated with a new seed
- **THEN** a second generation revision SHALL be created and the first generation and asset SHALL remain available

#### Scenario: Persist candidate membership
- **WHEN** four generations are scheduled as one candidate set
- **THEN** each generation SHALL reference the same immutable candidate-set identifier with a unique candidate index and its own concrete seed

### Requirement: Generation, freshness, review, and current are separate
A Scene image SHALL expose generation status independently from visual freshness (`CURRENT` or `STALE`), review status (`UNREVIEWED`, `ACCEPTED`, or `REJECTED`), structured quality review, candidate-set membership, and explicit current selection. The system SHALL NOT infer current selection solely from the newest timestamp. Accepting a completed candidate SHALL atomically set it `ACCEPTED` and current. Completing a multi-candidate set SHALL never auto-select a candidate, and completing any generation SHALL never replace an accepted current image. A single generation MAY preserve the existing first-image auto-selection only when no current image exists and project approval is not required.

#### Scenario: Reject the current image
- **WHEN** a user marks a current image `REJECTED`
- **THEN** the review status SHALL change without deleting its asset or generation history and the system SHALL NOT choose a replacement automatically

#### Scenario: Select an older revision
- **WHEN** a user explicitly selects an older valid Scene image revision
- **THEN** that revision SHALL become current and all other revisions for that Scene role SHALL become non-current atomically

#### Scenario: Accept a candidate
- **WHEN** a user accepts a completed non-current candidate
- **THEN** its review status, generation current flag, and Asset current flag SHALL change atomically while every other Scene image remains historical

#### Scenario: Preserve accepted current during generation
- **WHEN** a new image completes while the Scene has an accepted current image
- **THEN** the new image SHALL remain non-current regardless of freshness and the accepted image SHALL remain current

### Requirement: Safe managed image assets
A completed provider or manual Scene image SHALL be copied or streamed into a generated application-managed path, registered as a `SCENE_IMAGE` Asset, and addressed by generated application identifiers. Provider filenames, provider subfolders, upload filenames, and URL query values SHALL NOT be trusted as workspace paths.

#### Scenario: Provider returns traversal values
- **WHEN** an output record contains a filename or subfolder with traversal or absolute-path syntax
- **THEN** retrieval MAY use encoded provider parameters but the stored destination SHALL remain an independently generated managed path

### Requirement: Validate image content before publication
Before an image generation completes or becomes current, the system SHALL verify a non-empty file, supported PNG/JPEG/WEBP content, readable dimensions, and reasonable agreement with requested dimensions. Unsupported, corrupt, empty, or unreadable output SHALL remain unpublished and SHALL fail with a useful output error.

#### Scenario: Provider returns corrupt bytes
- **WHEN** ComfyUI reports success but the downloaded bytes are not a readable supported image
- **THEN** the generation SHALL fail with `OUTPUT_INVALID`, no current Asset SHALL be published, and any prior current image SHALL remain current

### Requirement: Retry and regenerate are distinct
A technical retry SHALL create another attempt for the same logical generation, candidate membership, input fingerprint, workflow settings, concrete seed, reference mapping, and provider prompt identity. Creative regeneration SHALL create a new logical generation revision in a new candidate set with an explicit same-seed or new-seed choice and optional bounded instructions. Feedback regeneration SHALL additionally persist the source candidate, structured source review, and deterministically assembled guidance. Unrelated completed Scene images SHALL remain untouched.

#### Scenario: Retry a timeout
- **WHEN** an image attempt times out and the user retries it without changing inputs
- **THEN** the same generation record SHALL gain a new attempt or resume checkpoint and SHALL retain the same intended seed and fingerprint

#### Scenario: Add regeneration feedback
- **WHEN** a user regenerates a rejected candidate with structured review feedback
- **THEN** the guidance MAY affect only that new provider prompt and fingerprint and SHALL NOT mutate canonical character, location, object, Scene, Story, Visual Prompt Package, or Style Bible data

### Requirement: Stale results never become current
The image-generation fingerprint SHALL include the Visual Prompt Package fingerprint, provider, approved workflow/template version, conditioning mode and mapping, reference asset identifiers with content hashes, output-affecting settings, model components, and concrete seed. Completion SHALL compare the original fingerprint and package freshness against current inputs before publishing. A stale completed output MAY be retained as historical evidence but SHALL NOT silently become current.

#### Scenario: Profile changes during generation
- **WHEN** a Character Visual Profile change makes the source package stale while ComfyUI is running
- **THEN** the returned image MAY be validated and stored for history, SHALL be visually stale, and SHALL NOT replace the Scene's current image

#### Scenario: Reference changes during conditioned generation
- **WHEN** the bound reference asset changes for the conditioned character while the provider job runs
- **THEN** the completed output SHALL NOT become current for the updated reference state and SHALL remain historical output

### Requirement: Manual Scene image override
The system SHALL allow a user to upload a supported Scene image, validate and store it under the same managed Asset rules, preserve provider generation history, and explicitly select the manual image as current. Manual images SHALL participate in downstream Scene-image dependency selection without requiring a ComfyUI generation.

#### Scenario: Upload manual replacement
- **WHEN** a user uploads a valid image for a Scene and selects it as current
- **THEN** the manual Asset SHALL become current while all generated revisions remain available in history

### Requirement: Bounded batch generation and backpressure
The system SHALL support one-Scene candidate generation, selected-Scene candidate generation, Chapter missing-image generation, and missing-or-stale generation. A request SHALL contain at most four candidates per Scene and SHALL satisfy a fixed bounded total-job limit before any work is created. It SHALL materialize independently retryable Scene candidate steps, skip matching successful or pending work where applicable, avoid duplicates, and SHALL NOT schedule every project Scene or multiply Scene counts by candidate counts without explicit user action. Local image generation SHALL initially execute with effective concurrency one.

#### Scenario: Batch fails at one Scene
- **WHEN** a bounded selected-Scene batch fails technically at one candidate
- **THEN** completed candidates SHALL remain completed, the failed candidate SHALL be independently retryable, and later eligible work SHALL continue according to the existing batch policy without duplicating prior success

#### Scenario: Reject excessive candidate batch
- **WHEN** the number of selected Scenes multiplied by candidates per Scene exceeds the total-job guardrail
- **THEN** the request SHALL fail atomically before any candidate set, workflow step, or job is created

### Requirement: Timeout, cancellation, and restart recovery are honest
Generation SHALL use a configurable timeout and persisted provider prompt ID. After worker restart, the system SHALL query the known provider prompt ID and resume waiting or import a completed result when it is still known. It SHALL not blindly submit a duplicate. Cancellation SHALL stop local waiting and SHALL cancel/dequeue the matching remote prompt only when the detected ComfyUI API supports targeted cancellation; otherwise the UI SHALL state that remote execution may continue.

#### Scenario: Restart while provider job is running
- **WHEN** the worker restarts after submission and the persisted prompt ID is still queued, running, or completed in ComfyUI
- **THEN** the recovered attempt SHALL resume that prompt instead of creating a second expensive generation

#### Scenario: Provider state is unknown after restart
- **WHEN** a persisted prompt ID is absent from queue and history and safe resubmission cannot be established
- **THEN** the generation SHALL fail with a recoverable explicit outcome-unknown error rather than silently duplicating work

### Requirement: Classified safe errors and observability
Image generation SHALL classify at least `PROVIDER_UNAVAILABLE`, `WORKFLOW_INVALID`, `MODEL_MISSING`, `SUBMISSION_FAILED`, `GENERATION_FAILED`, `OUTPUT_MISSING`, `OUTPUT_INVALID`, `DOWNLOAD_FAILED`, `TIMEOUT`, `CANCELLED`, `STALE_INPUT`, and reference-upload/reference-validation failures where evidence permits. Persisted diagnostics SHALL include generation, Scene, provider, provider prompt, workflow version, conditioning mode, seed, duration, dimensions, status, and safe bounded error context without secrets or giant workflow payloads. Local provider monetary cost SHALL remain unknown rather than invented.

#### Scenario: Observe provider progress
- **WHEN** ComfyUI reports queued, running, progress, success, or failure evidence
- **THEN** the application SHALL persist useful normalized status/progress without copying the whole ComfyUI UI or raw workflow into routine logs

#### Scenario: Reference upload fails
- **WHEN** the provider cannot transfer a bound reference image for a conditioned generation
- **THEN** the failure SHALL be classified as a retryable reference error and SHALL NOT silently resubmit the generation as text-only

### Requirement: Image APIs remain metadata-first
Scene image list and history APIs SHALL return bounded metadata and safe asset URLs, not base64 or binary payloads. Actual image bytes SHALL use the existing streaming Asset route or an equivalent safe streamed response.

#### Scenario: List image history
- **WHEN** a Scene has many image revisions
- **THEN** the list response SHALL remain bounded and SHALL not load image files into API JSON or SQLite

### Requirement: Real-image milestone verification
This capability SHALL not be considered complete until a real self-hosted ComfyUI generation from a CURRENT persisted Visual Prompt Package has produced, downloaded, validated, persisted, and previewed an image Asset; restart has preserved its linkage/current selection; and the same Scene has been regenerated into a second preserved real revision with a new seed.

#### Scenario: Complete live smoke verification
- **WHEN** implementation verification is performed against configured ComfyUI
- **THEN** evidence SHALL identify the tested server/model/workflow, two real generation records, two real Asset paths, dimensions, seeds, persisted current selection after restart, and manual visual observations

### Requirement: First milestone excludes advanced conditioning and video
The image workflow SHALL NOT require LoRA training, DreamBooth, ControlNet pose/depth, OpenPose pipelines, regional prompting frameworks, automatic segmentation or masking, automatic best-image selection, vision-based regeneration loops, AI video, image-to-video, animation, lip sync, multi-character TTS, or a generic workflow/node editor. Identity techniques beyond the one approved reference-conditioning path SHALL NOT be installed speculatively.

#### Scenario: Generate without identity conditioning
- **WHEN** a Scene image is generated from prompt text without reference conditioning
- **THEN** the UI and documentation SHALL NOT claim pixel-perfect recurring character identity
