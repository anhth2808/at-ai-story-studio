# image-quality-workflow Specification

## Purpose
Define the user-controlled workflow for generating bounded Scene image candidates, reviewing quality, selecting a current image, and regenerating with deterministic feedback while preserving identity and canonical Story data.

## Requirements

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
Completing a candidate set SHALL not replace an already accepted current image. Under an automatic quality policy, a candidate MAY become current only after all required critics pass, deterministic ranking selects it, required references remain current, and the profile's human-approval rule is satisfied. A failed, unavailable, stale, rejected, or lower-ranked candidate SHALL not become current.

#### Scenario: AUTO selects a passing candidate
- **WHEN** an AUTO candidate set completes with one clear passing ranked winner and no required human gate
- **THEN** that candidate MAY become current with persisted critic and ranking evidence while all alternatives remain immutable history

#### Scenario: Generate beside an accepted current image
- **WHEN** a Scene or Shot already has an accepted current image and a new candidate completes
- **THEN** the accepted image SHALL remain current and the new candidate SHALL remain immutable non-current history until it passes the configured selection policy

#### Scenario: Complete a four-candidate set on an empty Scene
- **WHEN** the existing manual candidate API completes four candidates for a Scene with no current image and human approval is required
- **THEN** all four SHALL remain non-current until a user accepts one

#### Scenario: Preserve legacy first-image behavior
- **WHEN** one candidate completes for a Scene without a Shot plan or current image and both human approval and required automatic quality gating are disabled
- **THEN** that candidate MAY become current without changing its `UNREVIEWED` manual review status

### Requirement: Quality review is structured and durable
Each completed candidate SHALL support automatic critic evaluations and one current manual quality review. The shared score taxonomy SHALL cover `IDENTITY`, `FACE_CONSISTENCY`, `HAIR`, `CLOTHING_STAGE`, `VISIBLE_CHARACTER_COUNT`, `PROMPT_ADHERENCE`, `COMPOSITION`, `CAMERA_FRAMING`, `POSE_ACTION`, `LOCATION`, `IMPORTANT_OBJECTS`, `ANATOMY`, `HANDS`, `STYLE`, `ARTIFACTS`, and `OVERALL` as applicable. Issue tags SHALL extend the existing vocabulary for missing/extra Characters, anatomy defects, and stage mismatch without replacing existing tags. Automatic and manual evaluations SHALL retain evaluator identity, version, evidence lineage, timestamps, and separate status.

#### Scenario: Automatic and manual results differ
- **WHEN** a critic passes a candidate but a reviewer rejects it for a visible defect
- **THEN** both results SHALL remain durable, human rejection SHALL prevent current acceptance under manual-review policy, and neither record SHALL overwrite the other

#### Scenario: Save a structured rejection
- **WHEN** a user rejects a candidate with bounded scores, issue tags, and notes
- **THEN** the complete manual review SHALL remain durable and separate from every automatic evaluation

#### Scenario: Reject invalid review data
- **WHEN** a review contains a score outside 1-5, duplicate or unknown issue tags, or overlong notes
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
The system SHALL build bounded regeneration guidance deterministically from critic/manual issues, notes, original Shot package, structured camera/composition/action/Location/object intent, and unchanged exact reference bindings. Automatic regeneration MAY occur only within the ProductionProfile image regeneration limit and resource caps. Technical retry SHALL preserve the same intended candidate. Exhausted semantic failures SHALL become manual-review-required or blocked rather than loop or pass silently.

#### Scenario: Automatic regeneration exhausts
- **WHEN** all candidates fail and the configured regeneration limit is reached
- **THEN** no further candidate job SHALL be created and downstream video SHALL remain blocked pending policy resolution

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
Project and ProductionProfile settings SHALL distinguish required automatic image quality gates from required human image approval. MANUAL_REVIEW SHALL run critics and pause for human approval. BALANCED SHALL auto-accept a clear passing result and escalate uncertainty or exhaustion. AUTO SHALL run critics, ranking, retries, and auto-acceptance and SHALL escalate only exhausted retries, hard prerequisites, required-provider unavailability, or configured uncertainty. Changing human approval alone SHALL not change generation fingerprints.

#### Scenario: AUTO still runs critics
- **WHEN** an AUTO production Shot image completes
- **THEN** automatic image evaluation SHALL run before the image can become an eligible video keyframe

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
