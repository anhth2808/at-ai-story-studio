# reference-conditioning Specification

## Purpose
Govern character reference images and their use as identity conditioning input for Scene image generation: reference asset lifecycle, approval, primary selection, explicit character-to-reference conditioning mapping, workflow readiness, fingerprint/staleness behavior, comparison, and the real benchmark that validates the technique.

## Requirements

### Requirement: Character reference images are managed Assets
The system SHALL store character reference images as `CHARACTER_REFERENCE_IMAGE` Assets scoped to one project and one character, uploaded through a validated image-upload path that generates internal filenames, validates image content, computes a SHA-256 hash, and rejects unsupported, corrupt, or traversal-bearing input. Reference upload SHALL NOT create a second image-storage system and SHALL NOT trust uploaded filenames.

#### Scenario: Upload a reference image
- **WHEN** a user uploads a supported image for character `li-wei`
- **THEN** the system SHALL store it under a generated managed path, register an immutable `CHARACTER_REFERENCE_IMAGE` Asset with project, character, hash, dimensions, and approval state `CANDIDATE`, and return its asset identifier and safe preview URL

#### Scenario: Reject an invalid upload
- **WHEN** an uploaded reference file is not a decodable PNG/JPEG/WEBP image
- **THEN** the upload SHALL fail with a bounded validation error and no Asset SHALL be registered

### Requirement: Reference approval is explicit
Each character reference Asset SHALL carry an approval state `CANDIDATE`, `APPROVED`, or `REJECTED`, changed only by explicit user action. Only `APPROVED` references SHALL be attachable to a Character Visual Profile or usable as conditioning input. `REJECTED` references SHALL remain stored and addressable but SHALL be unusable for conditioning.

#### Scenario: Approve then attach
- **WHEN** a user approves a `CANDIDATE` reference and attaches it to the character's Visual Profile
- **THEN** the profile revision SHALL record the reference identifier and future conditioned scheduling MAY use it

#### Scenario: Candidate references are inert
- **WHEN** a reference is `CANDIDATE` or `REJECTED`
- **THEN** scheduling conditioned generation SHALL ignore it and SHALL NOT include it in any conditioning mapping

### Requirement: One primary reference per character profile
A Character Visual Profile SHALL treat the first entry of its ordered approved reference list as the PRIMARY reference and remaining entries as optional additional references. Setting the primary SHALL be an explicit reorder that creates a new profile revision through the existing profile reference-update contract. Reference conditioning in this milestone SHALL use only the primary reference per conditioned character.

#### Scenario: Change the primary reference
- **WHEN** a user promotes a different approved reference to primary
- **THEN** the profile SHALL gain a new revision, packages depending on that profile SHALL become stale through the existing dependency model, and no other character's data SHALL change

### Requirement: Promote a Scene image to a character reference
The system SHALL let a user promote an existing generated or manual Scene image revision into a character reference Asset for a named character. Promotion SHALL copy the image into a new reference Asset marked `APPROVED`, SHALL NOT modify or invalidate the source generation or its Asset, and SHALL NOT silently regenerate or invalidate prior images beyond the existing profile-dependency staleness.

#### Scenario: Use a Scene image as reference
- **WHEN** a user promotes Scene image revision 2 as the reference for `li-wei`
- **THEN** a new `APPROVED` `CHARACTER_REFERENCE_IMAGE` Asset SHALL reference copied bytes of that revision, the source generation SHALL remain unchanged and current if it was current, and the profile reference list SHALL gain the new asset through a normal profile revision

### Requirement: Explicit conditioning mapping
Conditioned generation SHALL carry an explicit per-character mapping (`characterId` -> reference asset id, hash, and workspace-relative path plus the profile revision) derived only from the Scene's current Visual Prompt Package and approved profile references. The mapping SHALL be persisted with the generation, and prompt name order SHALL NOT be the only identity binding. This milestone SHALL condition at most four characters per generation, consistent with the selected model's tested reference limit, and SHALL record a bounded warning when a Scene character with an approved reference is excluded.

#### Scenario: Two characters are conditioned
- **WHEN** a Scene's package resolves `li-wei` and `mei`, both with approved primary references
- **THEN** the persisted generation metadata SHALL contain both explicit mappings and each provider reference input SHALL be traceable to exactly one character id

### Requirement: Generation mode is explicit and defaults to text-only
Project image settings SHALL expose a conditioning mode `TEXT_ONLY` (default) or `REFERENCE_CONDITIONED`, and Scene-level scheduling SHALL accept an explicit per-request mode override. Existing scheduling behavior SHALL NOT change unless the user selects `REFERENCE_CONDITIONED`. Requesting conditioned generation for a Scene whose package provides no eligible approved reference SHALL fail with an actionable prerequisite error rather than silently falling back.

#### Scenario: Default behavior is unchanged
- **WHEN** a project has never enabled `REFERENCE_CONDITIONED`
- **THEN** Scene image generation SHALL behave exactly as the text-only workflow including its provenance warning for unused reference identifiers

#### Scenario: Conditioned request without references fails explicitly
- **WHEN** a user requests `REFERENCE_CONDITIONED` generation for a Scene with no eligible approved character reference
- **THEN** scheduling SHALL fail with a bounded prerequisite error naming the missing prerequisite and no job SHALL be created

### Requirement: One approved conditioned workflow
The system SHALL execute exactly one application-approved conditioned workflow template (`reference-character-v1`) built from native provider nodes: the existing text-to-image graph extended with per-reference image loading, scaling, VAE encoding, and reference-latent conditioning applied to the conditioned prompt path(s). Node identifiers, classes, required inputs, and links SHALL be validated before submission, and arbitrary workflow JSON or client-supplied graphs SHALL remain rejected. The workflow version and mapping version SHALL be persisted on every conditioned generation.

#### Scenario: Conditioned generation records provenance
- **WHEN** a conditioned generation completes
- **THEN** its persisted metadata SHALL identify workflow template `reference-character-v1`, its mapping version, the conditioning mode, and the exact per-character reference mapping used

#### Scenario: Text-only workflow remains available
- **WHEN** a user explicitly selects `TEXT_ONLY`
- **THEN** generation SHALL proceed through the unchanged text-only template even when conditioning is unavailable, unconfigured, or has failed before submission

### Requirement: Reference delivery is safe and reproducible
The provider SHALL transfer each reference image to ComfyUI through its supported upload API using generated internal filenames, SHALL use the provider-returned filename rather than echoing the local name, SHALL stream file bytes without loading whole files into memory, and SHALL classify upload failures as retryable reference errors rather than switching modes automatically.

#### Scenario: Upload failure during conditioned generation
- **WHEN** the provider rejects or cannot reach the reference upload endpoint
- **THEN** the generation SHALL fail with a classified reference error that supports the normal retry path, and the system SHALL NOT resubmit as text-only without user action

### Requirement: Conditioning-aware readiness
Readiness SHALL validate the conditioned workflow's required nodes (image input, scaling, VAE encode, reference-latent conditioning) whenever conditioned generation may be used, and SHALL expose an explicit conditioning readiness value among `CONDITIONING_READY`, `REFERENCE_NODE_MISSING`, `MODEL_MISSING`, and `INCOMPATIBLE_WORKFLOW` with bounded missing-node diagnostics. A READY overall status SHALL NOT be reported for a provider that cannot run the selected conditioning workflow.

#### Scenario: Conditioning node is missing
- **WHEN** the ComfyUI server lacks the reference-latent node class and the project selects `REFERENCE_CONDITIONED`
- **THEN** readiness SHALL report a non-ready conditioning diagnostic listing the missing node and conditioned scheduling SHALL fail before submission

#### Scenario: Text-only readiness is unaffected
- **WHEN** conditioning nodes are missing but the project remains `TEXT_ONLY`
- **THEN** text-only readiness SHALL remain READY and the conditioning diagnostic SHALL be informational

### Requirement: Conditioning fingerprint and scoped staleness
The conditioned generation fingerprint SHALL include the Visual Prompt Package fingerprint, conditioning mode, workflow template and mapping version, conditioning settings, concrete seed, and each reference asset identifier with its content hash. Changing an approved character reference SHALL invalidate only conditioned outputs that depend on that character: dependent Scene images become visually stale through the existing package-dependency model, other characters' images and all Story/TTS/render data SHALL be unaffected, and TEXT_ONLY outputs SHALL NOT be newly invalidated beyond existing package behavior. Historical images SHALL be retained, and a stale in-flight result SHALL never silently become current.

#### Scenario: Reference change stales only dependent outputs
- **WHEN** the approved primary reference of `li-wei` is replaced while `mei`-only Scenes exist
- **THEN** Scenes whose packages depend on the `li-wei` profile SHALL become stale, `mei`-only Scene images SHALL remain current, and no Story, TTS, or render state SHALL change

#### Scenario: In-flight completion after a reference change
- **WHEN** the primary reference changes while a conditioned generation is running and the generation then completes
- **THEN** the image MAY be stored as historical output but SHALL NOT replace the Scene's current image or report freshness `CURRENT` against the new inputs

### Requirement: Comparison and regeneration
The system SHALL let a user generate and view, for one Scene, bounded candidate sets containing `TEXT_ONLY` or `REFERENCE_CONDITIONED` images and compare selected candidates side by side with generation metadata, including mode, workflow, seed, references used, structured review, and candidate-set provenance. Regeneration SHALL support same-seed and new-seed conditioned generation, technical retry of a conditioned candidate SHALL reuse the same generation, fingerprint, seed, candidate membership, and reference mapping, and feedback regeneration SHALL resolve and persist a fresh explicit character-to-reference mapping from the current Visual Prompt Package without mutating Character Visual Profiles.

#### Scenario: Compare baseline and conditioned
- **WHEN** a Scene has one completed TEXT_ONLY candidate and one completed REFERENCE_CONDITIONED candidate
- **THEN** the UI SHALL present both images side by side with their persisted mode, workflow, seed, reference provenance, scores, issues, and notes without loading image binaries into metadata APIs

#### Scenario: Regenerate conditioned candidate with feedback
- **WHEN** a user regenerates a rejected reference-conditioned candidate with structured feedback
- **THEN** the new request SHALL retain explicit `CharacterId -> ReferenceAsset` bindings with current asset hashes and profile revisions while applying feedback only to the Scene generation guidance

### Requirement: Real conditioned benchmark verification
This capability SHALL NOT be considered complete until, against a real configured ComfyUI server: one recurring character with one approved reference has been generated across at least five Scenes with scene-varied composition; each Scene has controlled text-only and reference-conditioned evidence; results have been manually reviewed and scored for face identity, hair, clothing, style, prompt adherence, composition, pose/action, location, and overall quality; later candidate-selection or feedback-regeneration benchmarks have checked identity for regression against the Prompt #10 baseline; multi-character behavior has been tested or honestly documented as limited; and LoRA and ControlNet decisions have been recorded from observed evidence.

#### Scenario: Complete the benchmark
- **WHEN** the image quality milestone verification is performed
- **THEN** evidence SHALL list the real generation records and Assets for compared modes and candidates across at least five Scenes, manual identity and composition scores, observed improvements and failures, the multi-character verdict, identity before and after, and the recorded `CONTROLNET_REQUIRED_NOW` and `LORA_REQUIRED_NOW` decisions

#### Scenario: Identity regresses during composition mitigation
- **WHEN** a candidate or feedback technique improves composition or pose but materially lowers recurring-character identity against the reference-conditioned baseline
- **THEN** the technique SHALL NOT become a default and the benchmark SHALL document the regression
