# Scene Engine Specification

## Purpose
Provide a durable, reviewable visual planning layer that converts a generated or manually edited chapter into ordered, source-traceable scenes without generating image or video pixels.

## Requirements

### Requirement: Resolve canonical visual identity separately
The Scene Engine SHALL resolve current character, location, recurring-object, and Style Bible profiles when building visual output, while retaining Scene narrative structure and Scene-specific visual state as separate inputs. It SHALL not treat Scene records as the canonical source for recurring appearance.

#### Scenario: Build a consistent scene package
- **WHEN** a current Scene references known visual profiles
- **THEN** the resolved output SHALL include canonical profile revisions plus scene-specific state without rewriting scene structure or StoryState

### Requirement: Rebuild prompts without replanning scenes
The Scene Engine SHALL rebuild a Visual Prompt Package from the current Scene revision and current visual dependencies without regenerating scene boundaries, source ranges, narrative purpose, or chapter content. Prompt rebuild SHALL be independently requestable and persist its dependency provenance.

#### Scenario: Refresh after a style change
- **WHEN** a Style Bible revision makes a scene prompt stale
- **THEN** rebuilding SHALL create a current package from the unchanged Scene revision and new style revision

### Requirement: Preserve scene prompt dependency evidence
Scene visual output SHALL identify every resolved profile revision, variant revision, Style Bible revision, scene revision, and prompt-template version used to assemble the result. Missing or ambiguous visual references SHALL remain visible as warnings rather than being silently invented.

#### Scenario: Missing profile during scene resolution
- **WHEN** a known scene character has no current visual profile
- **THEN** the Scene Engine SHALL retain the scene and expose a missing-profile warning in the package/check result

### Requirement: Structured chapter scene planning
The system SHALL allow a user to request scene planning for one existing chapter and SHALL return an ordered collection of validated Scene records. The planning result SHALL describe narrative beats rather than splitting mechanically by paragraph or word count, and a successful request SHALL not start image, video, TTS, subtitle, or render generation.

#### Scenario: Plan an AI-generated chapter
- **WHEN** a user requests Generate Scenes for a current generated chapter
- **THEN** the system SHALL analyze the chapter with bounded story context and persist an ordered scene plan whose scenes cover the chapter's meaningful visual beats

#### Scenario: Plan a manually edited chapter
- **WHEN** a user requests Generate Scenes for a current manual chapter
- **THEN** the system SHALL use the persisted chapter revision as source, apply the same validation and persistence rules, and SHALL not require AI-generated chapter lineage

#### Scenario: Reject missing chapter
- **WHEN** a scene request names a chapter that does not exist in the project
- **THEN** the system SHALL return a safe not-found or prerequisite error and SHALL not create scene records or image work

### Requirement: Reviewable scene data
Each current Scene SHALL expose the project and chapter identity, stable scene identity, narrative order, title, summary, controlled purpose, validated source range, location information, time and mood, referenced characters, important objects, visual description, camera data, composition data, lighting/color mood, image prompt, optional generic negative prompt, continuity notes, revision, provenance, and lifecycle status. Visual description SHALL remain distinct from image prompt.

#### Scenario: Inspect a scene plan
- **WHEN** a scene plan has completed
- **THEN** a scene detail read SHALL expose enough structured information to review narrative purpose and future visual generation without requiring the complete novel

#### Scenario: Enforce controlled values
- **WHEN** an OMP result supplies an unsupported purpose or camera framing value
- **THEN** the system SHALL reject the result as structured validation failure and SHALL preserve the prior current scene plan

### Requirement: Narrative source traceability
Every Scene SHALL retain `sourceStartOffset` and `sourceEndOffset` into the exact chapter text revision used for generation, using the runtime's UTF-16 string offset convention. Ranges SHALL be non-negative, ordered, and within the source string length, and the detail response SHALL be able to return a bounded source excerpt derived from that range.

#### Scenario: Validate source ranges
- **WHEN** a scene result contains a negative offset, an end before its start, or an end outside the chapter content
- **THEN** the operation SHALL fail validation and SHALL not promote any scene from that result as current

#### Scenario: Show source excerpt
- **WHEN** a user opens a scene with a valid source range
- **THEN** the UI/API SHALL show the associated bounded chapter excerpt and the exact chapter revision used for traceability

### Requirement: Configurable scene density
The system SHALL accept LOW, MEDIUM, or HIGH scene density and SHALL optionally accept a bounded target scene-count range. Density SHALL influence the requested visual granularity, but the system SHALL preserve narrative boundaries and SHALL not force an exact count when doing so would produce an incoherent plan.

#### Scenario: Request medium density
- **WHEN** a user submits MEDIUM density for a chapter
- **THEN** the scene-planning operation SHALL request a balanced number of scenes and SHALL return the actual count with no fabricated exact-count guarantee

#### Scenario: Reject unsafe density input
- **WHEN** a request supplies an unknown density or an invalid target range
- **THEN** the system SHALL reject the request without changing the current scene plan

### Requirement: Bounded scene generation context
Scene planning SHALL use only bounded relevant context: the current chapter title/content/revision, available chapter plan and summary, current arc when applicable, relevant blueprint characters, relevant CharacterState snapshots, active threads, important facts, and current project visual style. It SHALL not require the complete novel or unrelated chapter prose, and the selected context/provenance SHALL be inspectable as bounded diagnostics.

#### Scenario: Plan a late long-story chapter
- **WHEN** a 100-chapter project requests scenes for chapter 87
- **THEN** the operation SHALL use the chapter and relevant continuity records without serializing all prior chapter prose into the scene request

#### Scenario: Missing optional context
- **WHEN** a manual chapter has no plan, summary, arc, or StoryState checkpoint
- **THEN** the operation SHALL use the documented bounded fallback context or return an actionable prerequisite error, and SHALL not invent canonical state

### Requirement: Scene character references and visual snapshots
A SceneCharacter SHALL reference a canonical project Character ID whenever a supplied character resolves to one, and SHALL retain bounded scene-specific role, action, emotion, pose, clothing/injury, held-object, and display-name snapshot data. An unknown named character SHALL never silently create a canonical Character; it SHALL be represented as an explicit unresolved review candidate or cause a safe validation failure according to the operation contract. Scene planning SHALL not mutate canonical Character or StoryState records.

#### Scenario: Resolve a known character
- **WHEN** OMP identifies a character matching a current blueprint character
- **THEN** the persisted scene character SHALL contain that Character ID plus its scene-specific visual snapshot

#### Scenario: Avoid duplicate character creation
- **WHEN** OMP names a character that does not match a canonical project character
- **THEN** the system SHALL not create a duplicate Character record and SHALL expose the unresolved reference for review or reject the output safely

### Requirement: Reusable location resolution
The system SHALL support lightweight project Locations with bounded descriptive fields and SHALL resolve scene location names using documented normalization. Exact normalized matches SHALL reuse the existing Location; ambiguous matches SHALL remain unresolved for review; genuinely new names MAY create a draft Location candidate. Location resolution SHALL not silently merge distinct places.

#### Scenario: Reuse a normalized location
- **WHEN** scenes refer to `Black Cloud Sect`, `black cloud sect`, and `The Black Cloud Sect`
- **THEN** the chosen normalization policy SHALL reuse one unambiguous project Location rather than creating duplicate locations

#### Scenario: Preserve an ambiguous location
- **WHEN** two existing locations normalize to a potentially ambiguous match
- **THEN** the system SHALL not merge them silently and SHALL expose a draft/unresolved location candidate for user review

### Requirement: Project visual style settings
The system SHALL allow a project to store a revisioned visual-style configuration containing bounded style name, description, medium, realism, color palette, cinematic style, aspect ratio, and optional prompt suffix fields. Scene generation and prompt generation SHALL use the current style revision, and provider-specific image settings SHALL not be required.

#### Scenario: Save and use visual style
- **WHEN** a user saves a valid `Cinematic Xianxia` style and generates scenes
- **THEN** the scene provenance and image prompt SHALL reflect that style revision without adding an image provider configuration

#### Scenario: Reject malformed style
- **WHEN** a style update violates field bounds or aspect-ratio format
- **THEN** the system SHALL reject it and retain the previous current style revision

### Requirement: Future-ready visual prompts
Each current Scene SHALL persist a domain visual description separately from an execution-oriented image prompt. The image prompt SHALL incorporate the scene subject/action, resolved character snapshots, location, time, mood, composition/camera, lighting, and current visual style. Negative prompts MAY be empty and SHALL remain generic rather than provider-specific token spam.

#### Scenario: Review prompt separation
- **WHEN** a user edits the visual description but not the image prompt
- **THEN** the system SHALL preserve both fields distinctly and SHALL expose that the image prompt may require refresh

#### Scenario: Refresh a stale prompt
- **WHEN** a style, location visual description, or character visual profile changes
- **THEN** the system SHALL mark the dependent image prompt stale while retaining valid scene structure until an explicit prompt regeneration succeeds

### Requirement: Controlled camera and composition data
Scene camera data SHALL use a controlled framing vocabulary that includes EXTREME_WIDE, WIDE, FULL, MEDIUM, CLOSE_UP, EXTREME_CLOSE_UP, OVER_THE_SHOULDER, and POV, with optional bounded angle and movement intent. Composition SHALL support bounded subject focus, foreground, midground, background, and character-position information.

#### Scenario: Persist camera composition
- **WHEN** a valid scene result includes a WIDE framing and layered composition
- **THEN** the scene detail SHALL expose those values independently for review and future image generation

### Requirement: Continuity-aware scene planning
Scene planning SHALL use relevant current StoryState and prior scene summaries/visual snapshots when available to reduce contradictions within the chapter. It SHALL record continuity notes or review warnings for detected uncertainty but SHALL not update canonical StoryState or invent facts.

#### Scenario: Preserve an object across scenes
- **WHEN** an earlier scene establishes a character holding a broken sword and the chapter does not remove it
- **THEN** later scene plans SHALL either preserve that visual state or expose a continuity warning for user review

### Requirement: Revision and independent regeneration
A scene plan and each current Scene SHALL have stable identities with simple revision semantics. Manual scene edits SHALL create a current revision without silently overwriting history. Regenerating one scene SHALL use its source range and bounded neighboring context, create only that scene's next revision, and leave other scenes and chapter content unchanged.

#### Scenario: Regenerate one scene
- **WHEN** a user regenerates Scene 2 in a three-scene chapter
- **THEN** Scene 1 and Scene 3 SHALL remain unchanged, Scene 2 SHALL expose a new current revision, and the chapter text SHALL not change

#### Scenario: Edit a scene manually
- **WHEN** a user edits the title, summary, purpose, location, mood, visual description, camera, or image prompt
- **THEN** the system SHALL persist the edit as a reviewable current revision and SHALL not overwrite prior generated evidence

### Requirement: Scoped scene invalidation
Changing chapter content SHALL mark only scenes derived from that chapter revision invalidated or stale and SHALL preserve historical scene revisions, chapter content, StoryState, media, and unrelated chapter scenes. Changing visual style, a referenced location description, or a future character visual profile SHALL stale only dependent image prompts where scene structure remains valid.

#### Scenario: Edit one chapter
- **WHEN** chapter 5 content changes
- **THEN** chapter 5 scenes SHALL become stale or invalidated, while chapter 4 and chapter 6 scenes and all existing media remain available

#### Scenario: Change visual style
- **WHEN** the project style changes from anime to realistic cinematic
- **THEN** scene boundaries/source ranges and narrative fields SHALL remain valid, while dependent image prompts SHALL be marked stale

### Requirement: Durable scene workflow and retry
Scene planning, scene prompt regeneration, and single-scene creative regeneration SHALL use persisted workflow state with durable statuses, attempts, input fingerprints, cancellation, retry, and restart recovery. A technical retry SHALL retry the same operation against unchanged inputs; a creative regeneration SHALL intentionally create a new scene revision. Scene work SHALL be chapter-scoped and SHALL not create a second job system.

#### Scenario: Resume after worker restart
- **WHEN** the worker restarts after a scene operation was persisted but before completion
- **THEN** the next worker SHALL recover the step according to the existing lease/retry policy and SHALL not lose completed scene records

#### Scenario: Retry technical failure
- **WHEN** OMP returns a retryable infrastructure failure during scene planning
- **THEN** the workflow SHALL retain the prior current plan and allow retry without creating a creative revision from partial output

### Requirement: Selective scene API and review UI
The system SHALL expose clean operations to generate scenes, list scenes by chapter/project with pagination, retrieve one scene with a bounded source excerpt, edit a scene, regenerate one scene, and read/update visual-style settings. The Scenes UI SHALL expose chapter actions, density/style controls, scene purpose/location/characters/mood/camera/visual/prompt fields, source excerpts, edit actions, and independent regeneration while preserving existing Story, TTS, subtitle, and render actions.

#### Scenario: Browse a large project
- **WHEN** a user opens Scenes for a project with 100 chapters
- **THEN** the API/UI SHALL load paginated scene/chapter metadata and SHALL not return all chapter prose and all scene details in one dashboard response

#### Scenario: Review generated scenes
- **WHEN** a chapter has a completed scene plan
- **THEN** the user SHALL be able to open the scene list, inspect source excerpts, edit one scene, or regenerate one scene without regenerating the chapter

### Requirement: No pixel generation in Scene Engine
Scene operations SHALL stop at validated visual planning data. They SHALL not call or enqueue ComfyUI, Stable Diffusion, Flux, Midjourney, image-generation APIs, video-generation APIs, image-to-video, animation, parallax, or provider-specific image jobs.

#### Scenario: Complete scene planning
- **WHEN** a scene plan succeeds
- **THEN** the persisted result SHALL contain structured visual planning fields only and SHALL leave future image-generation assets and jobs absent
