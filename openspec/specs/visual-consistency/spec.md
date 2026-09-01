# Visual consistency Specification

## Purpose
Provide persistent, provider-neutral visual identity for project characters, locations, recurring objects, and style, then resolve those identities with scene-specific state into reproducible visual prompt packages. This capability stops at structured prompt data and does not generate image or video pixels.

## Requirements

### Requirement: Canonical visual profiles
The system SHALL provide project-scoped, revisioned visual profiles for characters, locations, and recurring objects. A profile SHALL retain a stable identity, current revision, lifecycle status, bounded structured appearance data, a deterministic prompt fragment or equivalent derivation, optional profile-specific negative traits, and creation/update provenance.

#### Scenario: Create a character profile
- **WHEN** a user creates or accepts a visual profile for a known project character
- **THEN** the profile SHALL reference that character, become the current revision for the identity, and remain available after restart

#### Scenario: Keep profile identities project-scoped
- **WHEN** a scene or request references a profile from another project
- **THEN** the request SHALL fail safely and SHALL not expose or reuse the foreign profile

#### Scenario: Keep objects lightweight
- **WHEN** a user defines a recurring object such as a jade pendant
- **THEN** the system SHALL store one reusable visual identity without requiring inventory, ownership, embedding, or graph-management features

### Requirement: Editable profile revisions and status
Visual profiles and the project Style Bible SHALL support simple `DRAFT`, `APPROVED`, and `STALE` lifecycle semantics where applicable. Manual edits SHALL create a new current revision, preserve the previous revision for provenance, and SHALL not be silently overwritten by later AI generation. Approved profile identity fields SHALL be canonical inputs to future prompt packages.

#### Scenario: Approve an AI candidate
- **WHEN** a generated candidate is accepted by the user
- **THEN** it SHALL become `APPROVED` and future resolution SHALL use its canonical fields until an explicit new revision is created

#### Scenario: Edit an approved profile
- **WHEN** a user changes an approved character's clothing identity
- **THEN** the system SHALL create the next revision, preserve the prior revision, mark dependent prompt packages stale, and leave story and media data unchanged

#### Scenario: Regenerate an existing approved profile
- **WHEN** a user requests creative regeneration for an approved profile
- **THEN** the system SHALL create a reviewable candidate or new revision and SHALL not replace the approved current profile without explicit acceptance

### Requirement: Structured profile generation
The system SHALL allow an authorized generation operation to produce structured candidate data for a character, location, or recurring object from bounded existing story data and the current Style Bible. The candidate SHALL be runtime-validated before persistence, SHALL be associated with generation provenance, and SHALL default to a reviewable draft. Invalid, incomplete, or unbounded output SHALL not become current profile data.

#### Scenario: Generate a character candidate
- **WHEN** a user requests a profile for an existing character with available story definition and state
- **THEN** the operation SHALL return a validated draft candidate containing useful prompt fields and SHALL leave any approved profile unchanged

#### Scenario: Generate a location candidate
- **WHEN** a user requests a profile for an existing project location using bounded story context
- **THEN** the operation SHALL return a validated location candidate without creating uncontrolled duplicate location identities

#### Scenario: Reject invalid structured output
- **WHEN** the generation boundary returns malformed JSON, unknown fields, or values outside profile bounds
- **THEN** the operation SHALL fail safely, preserve the prior current revision, and SHALL retain retryable diagnostics without persisting the invalid candidate

### Requirement: Canonical identity and scene-specific state
The system SHALL keep canonical profile appearance separate from temporary Scene-specific visual state. Character scene state MAY describe clothing changes, injuries, expression, pose, action, position, held objects, or explicit appearance changes; location scene state MAY describe time, weather, damage, lighting, or other temporary conditions. Resolving state SHALL never write it back to a canonical profile implicitly.

#### Scenario: Resolve temporary character state
- **WHEN** a scene marks a canonical character as angry, rain-soaked, and holding a broken sword
- **THEN** the prompt package SHALL contain the canonical identity plus those temporary conditions, while the canonical profile remains unchanged

#### Scenario: Explicit appearance change
- **WHEN** a scene or reviewed StoryState explicitly records a new scar or armor change
- **THEN** the resolver MAY include the change as an explicit override and SHALL expose the conflict or source rather than silently mutating the profile

### Requirement: Visual variants
The system SHALL allow a character to have lightweight named visual variants, such as `BASE` or `BATTLE_DAMAGED`, with bounded descriptions and prompt overrides. A scene MAY select one variant deterministically; variant selection SHALL preserve the base canonical identity and SHALL not require a separate asset or image-generation workflow. The model SHALL leave an equivalent future seam for location variants without requiring a full variant matrix.

#### Scenario: Select a battle variant
- **WHEN** a scene selects a character's `BATTLE_DAMAGED` variant
- **THEN** the resolved character SHALL contain base identity, variant overrides, and scene-specific state in that order

#### Scenario: Unknown variant
- **WHEN** a scene names a variant that does not exist for the resolved identity
- **THEN** the package SHALL expose an `UNRESOLVED_REFERENCE` warning and SHALL not invent variant attributes

### Requirement: Explicit recurring-object resolution
Scene important-object references SHALL support explicit resolution to a canonical recurring object when identity is known. Name normalization MAY assist lookup, but ambiguous names SHALL remain unresolved until the user chooses a profile. The system SHALL not create independent visual identities for spelling or casing variants that clearly resolve to one object.

#### Scenario: Reuse one recurring object
- **WHEN** scenes refer to `Broken Sword`, `broken sword`, and a configured object key for the same item
- **THEN** resolved packages SHALL carry the same object identity and profile revision

#### Scenario: Preserve ambiguity
- **WHEN** two objects are plausible matches for a scene reference
- **THEN** the package SHALL retain the unresolved reference and warning instead of silently merging the objects

### Requirement: Project Style Bible
The system SHALL provide one current, revisioned, provider-neutral Style Bible per project. It SHALL support bounded fields for name, medium, overall style, realism level, cinematic language, color palette, lighting, texture, environment and character rendering, camera and composition language, mood keywords, positive suffix, negative prompt, and aspect ratio. It SHALL not require provider-specific sampler, seed, node, model, or execution settings.

#### Scenario: Save a style bible
- **WHEN** a user saves a valid cinematic or illustrated style
- **THEN** the system SHALL persist a new current revision and use that revision in subsequent prompt packages

#### Scenario: Apply an editable preset
- **WHEN** a user selects a provider-neutral preset such as `ANIME` or `STORYBOOK`
- **THEN** the system SHALL initialize editable Style Bible fields and SHALL not lock the user to provider-specific settings

#### Scenario: Reject invalid style data
- **WHEN** a style update violates field bounds or aspect-ratio format
- **THEN** the system SHALL reject it and retain the previous current Style Bible revision

### Requirement: Reference slots
Visual profiles SHALL expose optional reference-asset slots for character, location, and object references. Slots MAY be empty. If a manual reference image is supported, it SHALL reuse the existing managed asset rules and SHALL not require generated reference images or an image provider.

#### Scenario: Profile without references
- **WHEN** a profile has no reference image
- **THEN** it SHALL remain valid and usable for deterministic prompt construction

#### Scenario: Manual reference asset
- **WHEN** a user attaches a valid managed reference image to a profile
- **THEN** the profile package/API SHALL expose the asset reference without copying it into a second storage system

### Requirement: Deterministic Visual Prompt Package
For each current Scene, the system SHALL be able to build and persist a Visual Prompt Package containing the scene revision, current Style Bible revision, resolved characters and variants, scene character states, resolved location and environment state, resolved recurring objects, camera, lighting, composition, mood, full prompt, negative prompt, consistency result, input fingerprint, and prompt-template version. The structured package SHALL remain separate from optional refined prompt text.

#### Scenario: Build a package from an existing scene
- **WHEN** a current Scene references available profiles and Style Bible data
- **THEN** the package SHALL resolve those dependencies without changing the Scene structure, chapter content, or media outputs

#### Scenario: Rebuild after a prompt edit
- **WHEN** a user requests prompt rebuild after changing a visual profile
- **THEN** the system SHALL reuse the current Scene structure and create a new package from current dependencies without regenerating the Scene plan

#### Scenario: Missing canonical profile
- **WHEN** a Scene references a character, location, or object with no usable profile
- **THEN** the package SHALL be persisted with a visible warning or safe missing status and SHALL not fabricate canonical appearance

### Requirement: Predictable prompt and negative-prompt assembly
Prompt assembly SHALL use a stable ordering: scene subject/action, resolved characters, resolved location, resolved recurring objects, scene camera/composition, lighting/mood, Style Bible language, and positive suffix. Negative prompt resolution SHALL combine project/style negatives, profile negatives, and scene negatives with bounded deduplication while retaining generic provider-neutral text. Style camera language SHALL not replace the Scene's selected shot.

#### Scenario: Preserve scene action
- **WHEN** a Scene contains a meaningful action and a detailed canonical profile
- **THEN** the full prompt SHALL include the action before identity/style support text so the action remains visible

#### Scenario: Avoid duplicate negatives
- **WHEN** the same negative trait appears in style and profile inputs
- **THEN** the resolved negative prompt SHALL contain it at most once while preserving distinct constraints

### Requirement: Prompt fingerprints and staleness
Every Visual Prompt Package SHALL expose a fingerprint derived from the exact Scene revision, Style Bible revision, character/profile and variant revisions, location/profile revision, object/profile revisions, scene-state inputs, and prompt-template version. A package SHALL be `CURRENT`, `STALE`, or `FAILED`; a stale package SHALL be rebuildable explicitly. Any dependency change SHALL produce a different fingerprint.

#### Scenario: Same inputs
- **WHEN** the same Scene and visual dependency revisions are packaged twice with the same template
- **THEN** both packages SHALL have the same fingerprint and deterministic structured content

#### Scenario: Change one profile
- **WHEN** one referenced character profile revision changes
- **THEN** the dependent package fingerprint SHALL change and its status SHALL become `STALE`

#### Scenario: Change the template
- **WHEN** the prompt assembly template version changes
- **THEN** existing packages SHALL be detectable as stale even when domain data is unchanged

### Requirement: Deterministic consistency checks
The system SHALL run lightweight deterministic checks over resolved package inputs and classify results as `PASS`, `WARN`, or `FAIL`. Checks SHALL cover missing profiles, unresolved references, appearance conflicts, location mismatches, object conflicts, style conflicts, and stale dependencies. The result SHALL include bounded issue type, message, and affected reference data suitable for UI display.

#### Scenario: Missing character profile warning
- **WHEN** a Scene references a known character without a current visual profile
- **THEN** the package check SHALL report `WARN` or `FAIL` with `MISSING_PROFILE` and the character name

#### Scenario: Explicit canonical conflict
- **WHEN** scene state says long red hair while an approved profile says short black hair without an explicit appearance-change source
- **THEN** the check SHALL report `CHARACTER_APPEARANCE_CONFLICT` without rewriting either input

#### Scenario: Location mismatch
- **WHEN** a canonical location describes an interior hall and a scene state claims an open forest without an explicit transition
- **THEN** the check SHALL report a bounded `LOCATION_CONFLICT` warning for review

### Requirement: Scoped visual invalidation
Changing a character, location, recurring-object, or Style Bible visual revision SHALL stale only current Visual Prompt Packages that directly depend on that revision. Scene narrative structure, source ranges, chapters, StoryState, TTS, subtitles, backgrounds, and renders SHALL remain untouched. Rebuilding SHALL be explicit unless the user requests a batch operation.

#### Scenario: Change one character profile
- **WHEN** Li Wei's visual profile changes
- **THEN** only packages referencing Li Wei SHALL become stale; packages for unrelated characters and scenes SHALL remain current

#### Scenario: Change one location profile
- **WHEN** Black Cloud Sect's visual profile changes
- **THEN** only packages referencing that location SHALL become stale

#### Scenario: Change Style Bible
- **WHEN** a project's style changes from anime to cinematic realistic
- **THEN** all project Visual Prompt Packages SHALL become stale while story structure and audio/media statuses remain valid

### Requirement: Selective access and durable visual data
Visual Bible and Visual Prompt Package reads SHALL support project/entity filters and pagination. List responses SHALL return bounded metadata and statuses rather than all scenes, profiles, references, and prompt payloads at once. Current and historical revisions SHALL survive API/worker restart and remain distinguishable.

#### Scenario: Browse a large Visual Bible
- **WHEN** a project has hundreds of scenes and many profile revisions
- **THEN** the API/UI SHALL fetch paginated profile/package summaries and shall not materialize every scene package in one response

#### Scenario: Reload after restart
- **WHEN** the API or worker restarts after profiles and packages were persisted
- **THEN** later reads SHALL show the same current revisions, fingerprints, statuses, warnings, and provenance

### Requirement: No image generation
Visual consistency operations SHALL not call, enqueue, or imply ComfyUI, Stable Diffusion, Flux, Midjourney, DALL-E, Gemini image generation, image-to-video, ControlNet, IP-Adapter, FaceID, LoRA training, or automatic reference-image generation. Structured Visual Prompt Packages SHALL be suitable inputs for a future image provider but SHALL be the terminal output of this milestone.

#### Scenario: Complete visual consistency work
- **WHEN** a profile or prompt package operation succeeds
- **THEN** only validated profile/package metadata and optional existing reference assets SHALL be committed, with no generated pixels or image-provider job

### Requirement: Provider-neutral image handoff
A CURRENT Visual Prompt Package SHALL be the exclusive narrative and visual-context input for an image-generation operation. The package SHALL expose its exact identity, status, positive prompt, negative prompt, reference-asset identifiers, and input fingerprint without embedding ComfyUI node IDs, checkpoint names, samplers, schedulers, guidance, seeds, or other provider execution settings. Visual Consistency operations themselves SHALL remain separate from provider submission.

#### Scenario: Hand a package to image generation
- **WHEN** a user explicitly schedules image generation for a Scene with a CURRENT package
- **THEN** the image layer SHALL consume the persisted package and SHALL NOT ask the Visual Consistency service to reconstruct Story context

#### Scenario: Reference conditioning is unavailable
- **WHEN** the package contains reference assets but the selected image workflow is text-only
- **THEN** the package and provider request SHALL retain the references while the result SHALL disclose that they were not consumed

### Requirement: Visual changes stale dependent images
Changing a character, location, recurring-object, Style Bible, Scene, object resolution, or prompt refinement input SHALL continue to stale the dependent Visual Prompt Package and SHALL also make images generated from that package visually stale. Historical image Assets SHALL be retained and their generation success SHALL remain distinct from freshness.

#### Scenario: Change a character profile after image generation
- **WHEN** an approved Character Visual Profile revision changes after a Scene image completed
- **THEN** the dependent package and image SHALL become visually stale without deleting the image, changing its review status, or invalidating unrelated images

#### Scenario: Rebuild a stale package
- **WHEN** a user rebuilds a package after a dependency change
- **THEN** the old image SHALL remain historical and a new image SHALL require an explicit generate/regenerate action
