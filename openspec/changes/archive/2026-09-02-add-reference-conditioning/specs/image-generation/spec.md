## MODIFIED Requirements

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

### Requirement: Stale results never become current
The image-generation fingerprint SHALL include the Visual Prompt Package fingerprint, provider, approved workflow/template version, conditioning mode and mapping, reference asset identifiers with content hashes, output-affecting settings, model components, and concrete seed. Completion SHALL compare the original fingerprint and package freshness against current inputs before publishing. A stale completed output MAY be retained as historical evidence but SHALL NOT silently become current.

#### Scenario: Profile changes during generation
- **WHEN** a Character Visual Profile change makes the source package stale while ComfyUI is running
- **THEN** the returned image MAY be validated and stored for history, SHALL be visually stale, and SHALL NOT replace the Scene's current image

#### Scenario: Reference changes during conditioned generation
- **WHEN** the bound reference asset changes for the conditioned character while the provider job runs
- **THEN** the completed output SHALL NOT become current for the updated reference state and SHALL remain historical output

### Requirement: Classified safe errors and observability
Image generation SHALL classify at least `PROVIDER_UNAVAILABLE`, `WORKFLOW_INVALID`, `MODEL_MISSING`, `SUBMISSION_FAILED`, `GENERATION_FAILED`, `OUTPUT_MISSING`, `OUTPUT_INVALID`, `DOWNLOAD_FAILED`, `TIMEOUT`, `CANCELLED`, `STALE_INPUT`, and reference-upload/reference-validation failures where evidence permits. Persisted diagnostics SHALL include generation, Scene, provider, provider prompt, workflow version, conditioning mode, seed, duration, dimensions, status, and safe bounded error context without secrets or giant workflow payloads. Local provider monetary cost SHALL remain unknown rather than invented.

#### Scenario: Observe provider progress
- **WHEN** ComfyUI reports queued, running, progress, success, or failure evidence
- **THEN** the application SHALL persist useful normalized status/progress without copying the whole ComfyUI UI or raw workflow into routine logs

#### Scenario: Reference upload fails
- **WHEN** the provider cannot transfer a bound reference image for a conditioned generation
- **THEN** the failure SHALL be classified as a retryable reference error and SHALL NOT silently resubmit the generation as text-only

### Requirement: First milestone excludes advanced conditioning and video
The image workflow SHALL NOT require LoRA training, DreamBooth, ControlNet pose/depth, OpenPose pipelines, regional prompting frameworks, automatic segmentation or masking, automatic best-image selection, vision-based regeneration loops, AI video, image-to-video, animation, lip sync, multi-character TTS, or a generic workflow/node editor. Identity techniques beyond the one approved reference-conditioning path SHALL NOT be installed speculatively.

#### Scenario: Generate without identity conditioning
- **WHEN** a Scene image is generated from prompt text without reference conditioning
- **THEN** the UI and documentation SHALL NOT claim pixel-perfect recurring character identity
