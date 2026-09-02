## Purpose

Define the user-controlled workflow for generating bounded Scene image candidates, reviewing quality, selecting a current image, and regenerating with deterministic feedback while preserving identity and canonical Story data.

## ADDED Requirements

### Requirement: Advanced control adoption is evidence-gated
The system SHALL evaluate composition and pose control techniques against the actual configured ComfyUI version, model family, approved workflow, installed nodes, installed models, and available GPU before adding a provider control path. When no compatible technique has demonstrated practical value, the system SHALL record `ADVANCED_CONTROL_TECHNIQUE = NONE`, SHALL keep `TEXT_ONLY` and `REFERENCE_CONDITIONED` generation usable, and SHALL NOT create a control plan, control Asset type, provider workflow, or exposed control settings for an unimplemented technique.

#### Scenario: Current stack has no supported control model
- **WHEN** the configured FLUX.2 Klein stack has native ControlNet nodes but no installed compatible control model or required preprocessor
- **THEN** basic image readiness SHALL remain usable and advanced control SHALL be reported unavailable with a bounded reason instead of installing or simulating a control path

#### Scenario: Future technique is considered
- **WHEN** a future control technique becomes compatible with the actual stack
- **THEN** it SHALL remain disabled until a real benchmark shows improved targeted composition or pose without significant identity regression

### Requirement: Candidate sets are bounded and persisted
The system SHALL let a user request 1-4 candidates for one Scene and an explicit bounded set of Scenes. One persisted candidate set SHALL group the candidates created from the same Scene revision, Visual Prompt Package, effective generation mode, reference dependencies, settings, workflow version, and generation instructions. Every candidate SHALL remain an independently retryable Scene image generation with its own concrete seed, Asset, status, review, and immutable history.

#### Scenario: Generate four candidates
- **WHEN** a user requests four candidates for one eligible Scene
- **THEN** the system SHALL create one candidate set and four normal persisted image jobs whose candidates have four persisted concrete seeds and four independent result Assets after successful completion

#### Scenario: Default candidate request
- **WHEN** a user generates without choosing a candidate count
- **THEN** the system SHALL request one candidate and SHALL NOT silently expand GPU work

#### Scenario: Candidate request exceeds the limit
- **WHEN** one request would exceed four candidates per Scene or the bounded total-job limit for the selected-Scene batch
- **THEN** scheduling SHALL fail before creating any candidate set or job and SHALL return an actionable limit error

### Requirement: Candidate seeds support useful comparison
Candidates in one set SHALL use different concrete seeds by default, resolved and persisted before job creation. Creative regeneration SHALL support new-seed generation and same-seed generation with changed bounded feedback or future controls. Technical retry SHALL preserve the original candidate, seed, provider prompt identity, and fingerprint.

#### Scenario: New-seed candidate set
- **WHEN** a candidate set contains four candidates under RANDOM seed behavior
- **THEN** all four concrete seeds SHALL be distinct within the set

#### Scenario: Same-seed feedback regeneration
- **WHEN** a user regenerates a rejected candidate with the same-seed option and review feedback
- **THEN** the new candidate SHALL preserve the source seed while its persisted fingerprint changes with the feedback guidance

### Requirement: Candidate generation protects current selection
Completing a multi-candidate set SHALL NOT automatically make any candidate current. Completing any new candidate SHALL NOT replace an already `ACCEPTED` current image. A single completed candidate MAY become current only when the Scene has no current image and the project's approval policy is disabled. Candidate completion SHALL otherwise retain the prior current image until explicit acceptance or selection.

#### Scenario: Generate beside an accepted current image
- **WHEN** a Scene already has an accepted current image and a new candidate completes
- **THEN** the accepted image SHALL remain current and the new candidate SHALL remain unreviewed history

#### Scenario: Complete a four-candidate set on an empty Scene
- **WHEN** four candidates complete for a Scene with no current image
- **THEN** all four SHALL remain non-current until a user accepts one

#### Scenario: Preserve legacy first-image behavior
- **WHEN** one candidate completes for a Scene with no current image and `requireImageApproval` is disabled
- **THEN** that candidate MAY become current without changing its `UNREVIEWED` review status

### Requirement: Quality review is structured and durable
Each completed candidate SHALL support one current manual quality review containing review status, optional 1-5 scores for `IDENTITY`, `PROMPT_ADHERENCE`, `COMPOSITION`, `POSE_ACTION`, `LOCATION`, `IMPORTANT_OBJECTS`, `STYLE`, `ARTIFACTS`, and `OVERALL`, a bounded unique list of issue tags, bounded optional notes, and update timestamps. Supported issue tags SHALL include `WRONG_FACE`, `WRONG_HAIR`, `WRONG_CLOTHING`, `WRONG_POSE`, `WRONG_COMPOSITION`, `WRONG_CAMERA`, `WRONG_LOCATION`, `MISSING_OBJECT`, `EXTRA_OBJECT`, `DUPLICATE_OBJECT`, `BAD_HANDS`, `BAD_TEXT`, `STYLE_DRIFT`, `REFERENCE_POSE_BLEED`, and `OTHER`.

#### Scenario: Save a structured rejection
- **WHEN** a user rejects a candidate with composition score 2, issues `WRONG_COMPOSITION` and `REFERENCE_POSE_BLEED`, and notes
- **THEN** the complete review SHALL be returned by subsequent reads and SHALL survive API and worker restart

#### Scenario: Reject invalid review data
- **WHEN** a review contains a score outside 1-5, duplicate issue tags, an unknown issue tag, or overlong notes
- **THEN** the update SHALL fail without replacing the last valid review

### Requirement: Accept and reject preserve history safely
Accepting a completed valid candidate SHALL atomically set its review status to `ACCEPTED`, make its generation and Asset current for the Scene, and make every other generation and Asset for that Scene non-current without deleting or rewriting history. Rejecting a candidate SHALL set `REJECTED`, preserve its Asset and candidate-set membership, and SHALL NOT select another image automatically.

#### Scenario: Accept candidate three
- **WHEN** a user accepts Candidate 3 in a four-candidate set
- **THEN** Candidate 3 SHALL become accepted and current atomically while Candidates 1, 2, and 4 remain available as history

#### Scenario: Reject a candidate
- **WHEN** a user rejects a completed candidate
- **THEN** its image, seed, generation metadata, review, and candidate-set membership SHALL remain queryable and no regeneration SHALL start automatically

### Requirement: Feedback regeneration is deterministic and Scene-scoped
The system SHALL build bounded regeneration guidance deterministically from a rejected candidate's structured issues, notes, original Visual Prompt Package, and existing structured Scene camera, composition, character action/pose, location, and important objects. The new candidate SHALL persist the source generation identifier, source review snapshot, assembled guidance, chosen seed behavior, and unchanged character-reference mapping. Feedback SHALL affect only the new generation request and SHALL NOT mutate canonical Story, Scene, Visual Prompt Package, Character Visual Profile, location profile, object profile, or Style Bible data.

#### Scenario: Reinforce composition and missing object
- **WHEN** a rejected candidate has `WRONG_COMPOSITION` and `MISSING_OBJECT`
- **THEN** regeneration guidance SHALL reinforce the persisted Scene composition and important-object intent in a deterministic order without calling an LLM

#### Scenario: Regenerate reference pose bleed
- **WHEN** a reference-conditioned candidate has `REFERENCE_POSE_BLEED`
- **THEN** feedback SHALL reinforce Scene framing, composition, pose, and action while retaining the exact explicit character-to-reference mapping from the new current package

#### Scenario: No automatic regeneration loop
- **WHEN** a feedback-regenerated candidate completes with a warning or failing review
- **THEN** the system SHALL wait for another explicit user action and SHALL NOT score or regenerate it automatically

### Requirement: Image approval policy is optional and non-generative
Project image settings SHALL expose `requireImageApproval`, defaulting to `false`. When enabled, downstream visual production SHALL consider a Scene image ready only when the current image is completed, fresh where applicable, and `ACCEPTED`. Changing this policy SHALL NOT change generation fingerprints, mark image Assets stale, invalidate Story/TTS data, or schedule image work.

#### Scenario: Approval gate is enabled
- **WHEN** `requireImageApproval` is enabled and the Scene's current image is unreviewed
- **THEN** downstream image readiness SHALL report approval missing even though the image generation completed

#### Scenario: Approval policy changes
- **WHEN** a user toggles only `requireImageApproval`
- **THEN** existing image freshness and fingerprints SHALL remain unchanged and no generation job SHALL be invalidated or scheduled

### Requirement: Candidate and review UI exposes existing Scene intent
The Scene image interface SHALL show the effective generation mode, bounded candidate count, advanced-control availability, Scene camera framing/angle, composition layers and character positions, character pose/action, location, and important objects from persisted Scene data. It SHALL present completed candidates in a responsive grid with image, seed, mode, status, review status, and accessible accept, reject, compare, and feedback-regenerate actions. It SHALL not require another AI call to reconstruct Scene intent.

#### Scenario: Review candidates on a small viewport
- **WHEN** a user opens a Scene candidate set on a narrow viewport
- **THEN** candidates and review controls SHALL remain operable without horizontal page scrolling and all form controls SHALL have visible labels and keyboard-accessible actions

#### Scenario: Compare available modes
- **WHEN** a Scene has text-only and reference-conditioned candidates
- **THEN** the user SHALL be able to compare selected candidates with mode, workflow, seed, reference provenance, scores, issues, and notes

### Requirement: Real quality benchmark gates the milestone verdict
The capability SHALL NOT be considered complete until the actual configured ComfyUI stack has been used with one recurring character across at least five representative Scenes covering close-up, wide environment, action/pose, important-object interaction, and strong composition, including the known composition-bleed failure. Evidence SHALL compare the Prompt #10 reference-conditioned baseline with bounded candidate selection and feedback regeneration when no advanced control technique is adopted, score `IDENTITY`, `COMPOSITION`, `POSE_ACTION`, `PROMPT_ADHERENCE`, `LOCATION`, `STYLE`, and `OVERALL`, record seeds and durations, compare identity before and after, and report multi-character observations when practical.

#### Scenario: Complete the five-Scene benchmark
- **WHEN** Prompt #11 verification finishes
- **THEN** the report SHALL list every compared Scene, mode, seed, scores, notes, GPU/performance observations, exact setup, known limitations, and explicit values for `ADVANCED_CONTROL_TECHNIQUE`, `CONTROLNET_REQUIRED_NOW`, `LORA_REQUIRED_NOW`, and `READY_FOR_ANIMATED_STORY`

#### Scenario: Candidate workflow does not mitigate the failure
- **WHEN** candidate selection and deterministic feedback do not meaningfully improve the targeted composition or pose failures while preserving identity
- **THEN** the final readiness verdict SHALL be `READY_FOR_ANIMATED_STORY = NO` and documentation SHALL NOT claim success
