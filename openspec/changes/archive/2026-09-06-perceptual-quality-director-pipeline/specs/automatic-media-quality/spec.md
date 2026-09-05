## Purpose

Define automatic, auditable image and temporal quality evaluation that ranks bounded candidate sets, protects accepted media inputs, and escalates or retries without confusing critic availability with a quality pass.

## ADDED Requirements

### Requirement: Automatic image critic
The system SHALL expose a provider-neutral automatic image critic that evaluates each completed current-input candidate against exact Shot intent and references. Evaluation SHALL cover identity, face consistency, hair, clothing/stage, intended visible Character count, prompt adherence, composition, camera/framing, pose/action, Location consistency, important objects, extra or missing objects, obvious anatomy defects, hands when relevant, style drift, and reference-pose bleed. It SHALL extend the existing image issue and score vocabulary rather than create an unrelated taxonomy.

#### Scenario: Evaluate a candidate
- **WHEN** a candidate image completes for a quality-gated Shot
- **THEN** a durable critic evaluation SHALL record critic identity/version, input Asset hashes, bounded scores, issue tags, verdict, confidence, safe explanation, and timestamps

### Requirement: Explainable deterministic image ranking
For a multi-candidate set, the system SHALL persist every candidate's critic result and rank candidates deterministically using versioned score, hard-failure, and tie-break rules. Selection metadata SHALL identify the chosen candidate and explain the score components and tie break. A failed or unavailable critic result SHALL NOT outrank a passing evaluated candidate.

#### Scenario: Rank tied candidates
- **WHEN** two candidates receive the same weighted score and hard-failure status
- **THEN** the versioned deterministic tie-break rule SHALL select the same candidate for the same persisted inputs and record the reason

### Requirement: Bounded image regeneration
When all candidates fail the configured image threshold, the system SHALL derive deterministic bounded regeneration guidance from persisted issue tags and Shot intent and MAY schedule another candidate attempt only within the profile limit and resource caps. Exhaustion SHALL produce intervention, block, or explicit degraded-review state according to policy; it SHALL never silently convert failed quality to pass.

#### Scenario: Exhaust image attempts
- **WHEN** every candidate and every allowed regeneration attempt fails the threshold
- **THEN** the Shot SHALL become manual-review-required or blocked according to profile policy and SHALL not expose a quality-passed current keyframe

### Requirement: Eligible keyframe gate
Quality- or review-gated video generation SHALL consume only a current accepted keyframe for the exact Shot and Scene revision with resolved required references and a passing or explicitly policy-approved quality state. Stale, rejected, wrong-revision, unresolved-reference, failed-QC, or non-current images SHALL be rejected before video submission.

#### Scenario: Reject stale keyframe
- **WHEN** a Character reference changes after a Shot image passes review
- **THEN** the stale image SHALL remain historical but SHALL not feed a new video generation

### Requirement: Automatic temporal critic
The system SHALL expose a provider-neutral temporal critic that samples at least first, middle, and last frames and MAY also sample 25% and 75% frames. It SHALL evaluate identity drift, extra or missing primary people, fabricated faces, face and body distortion, extra limbs, clothing drift, important-object mutation, background morphing, severe flicker, camera behavior, motion strength, and temporal instability against Shot intent and source keyframe.

#### Scenario: Evaluate a generated clip
- **WHEN** a quality-gated video clip completes provider validation
- **THEN** the system SHALL extract bounded managed frame evidence and persist a temporal evaluation tied to the exact clip hash, source keyframe hash, Shot intent, critic version, issue tags, verdict, confidence, and safe explanation

### Requirement: Distinguish primary people from background extras
Temporal evaluation SHALL compare intended visible Characters and primary subjects with sampled frames. A new unjustified primary person or disappeared required primary person SHALL be a quality issue. Background extras SHALL not automatically fail unless they violate Shot intent or become unintended primary subjects.

#### Scenario: Background crowd remains allowed
- **WHEN** a Shot intentionally contains a crowd and the generated clip preserves its named primary Character while incidental extras vary
- **THEN** the critic SHALL not reject solely for non-primary crowd variation

#### Scenario: Primary person materializes
- **WHEN** a new composition-dominant person appears after the first frame without Shot justification
- **THEN** the critic SHALL tag an extra-primary-person failure

### Requirement: Detect fabricated faces
When the source or first frame does not establish a reliable frontal face, a later clearly visible new face without visual basis SHALL be tagged as potential fabricated identity. Strict quality policy SHALL treat this as rejection, particularly for back-facing, occluded, or partial-profile subjects.

#### Scenario: Back-facing source invents a face
- **WHEN** the source keyframe shows a Character from behind and a later frame exposes a detailed frontal face not grounded in a reference or planned turn
- **THEN** strict temporal QC SHALL reject the clip with a fabricated-face issue

### Requirement: Quality state is explicit and non-boolean
Automatic image and video evaluations SHALL use explicit states equivalent to `NOT_RUN`, `RUNNING`, `PASSED`, `REJECTED`, `UNAVAILABLE`, `DEGRADED_ACCEPTED`, and `MANUAL_REVIEW_REQUIRED`. Critic infrastructure failure SHALL become `UNAVAILABLE`, never `PASSED`. Policy SHALL explicitly determine critic retry, degraded review, human escalation, or blocking.

#### Scenario: Critic provider is unavailable
- **WHEN** generation succeeds but the required critic cannot be reached
- **THEN** quality state SHALL be `UNAVAILABLE` and downstream behavior SHALL follow the configured fallback policy without claiming a pass

### Requirement: Bounded temporal regeneration
A semantic temporal rejection MAY produce deterministic retry guidance and a new generation attempt only within the configured temporal retry limit. The system SHALL persist attempt, reject reason, issue tags, guidance, and source lineage. Provider, model, configuration, or critic-infrastructure failures SHALL follow technical retry/readiness policy rather than creative regeneration loops.

#### Scenario: Exhaust temporal retries
- **WHEN** the clip remains semantically rejected after the configured temporal retry limit
- **THEN** the Shot SHALL require intervention or remain blocked according to profile policy and SHALL not be silently accepted

### Requirement: Automatic review and human approval remain separate
Automatic critics SHALL execute in MANUAL_REVIEW, BALANCED, and AUTO profiles when their quality gates are enabled. Human approval requirements SHALL be an independent profile decision. AUTO MAY remove routine human approval but SHALL NOT disable automatic scoring, ranking, retry, or prerequisite validation.

#### Scenario: AUTO production candidate passes
- **WHEN** an AUTO candidate clearly passes automatic thresholds and prerequisites
- **THEN** it MAY become accepted without human approval while retaining its complete critic and ranking evidence
