## MODIFIED Requirements

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

### Requirement: Feedback regeneration is deterministic and bounded
The system SHALL build bounded regeneration guidance deterministically from critic/manual issues, notes, original Shot package, structured camera/composition/action/Location/object intent, and unchanged exact reference bindings. Automatic regeneration MAY occur only within the ProductionProfile image regeneration limit and resource caps. Technical retry SHALL preserve the same intended candidate. Exhausted semantic failures SHALL become manual-review-required or blocked rather than loop or pass silently.

#### Scenario: Automatic regeneration exhausts
- **WHEN** all candidates fail and the configured regeneration limit is reached
- **THEN** no further candidate job SHALL be created and downstream video SHALL remain blocked pending policy resolution

### Requirement: Image approval policy is independent from automatic QC
Project and ProductionProfile settings SHALL distinguish required automatic image quality gates from required human image approval. MANUAL_REVIEW SHALL run critics and pause for human approval. BALANCED SHALL auto-accept a clear passing result and escalate uncertainty or exhaustion. AUTO SHALL run critics, ranking, retries, and auto-acceptance and SHALL escalate only exhausted retries, hard prerequisites, required-provider unavailability, or configured uncertainty. Changing human approval alone SHALL not change generation fingerprints.

#### Scenario: AUTO still runs critics
- **WHEN** an AUTO production Shot image completes
- **THEN** automatic image evaluation SHALL run before the image can become an eligible video keyframe
