## MODIFIED Requirements

### Requirement: Provider-neutral video generation boundary
The system SHALL expose a video generation boundary whose request carries project, chapter, Scene, and Shot identity; exact source keyframe Asset ID/hash; optional continuation-source lineage; motion prompt; negative prompt; backend identity; legal dimensions/frame count/FPS; seed; and bounded provider settings without backend node IDs or raw workflow JSON. The result SHALL carry provider/backend, provider job ID, reproducibility metadata, actual dimensions/FPS/frame count/duration, persisted video Asset reference, and bounded warnings. Backend-specific behavior SHALL stay behind adapters.

#### Scenario: Request remains backend-neutral
- **WHEN** a Shot video generation is scheduled for Wan or LTX-2
- **THEN** the persisted domain request SHALL identify the backend and reproducible values but contain no ComfyUI node IDs or full graph

#### Scenario: Request stays provider-neutral
- **WHEN** a Scene or Shot AI video generation is scheduled
- **THEN** the persisted request SHALL contain no ComfyUI node IDs or raw workflow JSON and SHALL be replayable against any conforming backend implementation

### Requirement: Approved ComfyUI backend workflows
The system SHALL retain the approved native Wan 2.2 TI2V-5B workflow and SHALL add one versioned application-approved LTX-2 local workflow descriptor adapted from the inspected known-good topology. Each adapter SHALL validate required node classes, fixed links, model identities, and mapped inputs before submission. Arbitrary client-supplied workflow JSON SHALL remain rejected. Missing custom nodes required by the selected LTX workflow SHALL be reported honestly and SHALL not affect Wan readiness.

#### Scenario: Wan remains ready without LTX nodes
- **WHEN** native Wan requirements are present but LTX-specific nodes are absent
- **THEN** Wan readiness SHALL remain independently READY while LTX readiness reports its missing dependencies

### Requirement: AiMotionPlan derives from accepted static state
The system SHALL persist motion intent separately from the static Shot prompt. The compiled motion prompt SHALL assume the accepted keyframe establishes identity, clothing, initial pose, composition, Location, and object placement and SHALL emphasize changes, speed, camera movement, subtle environment motion, emotional timing, speaking behavior, and stability of face, body proportions, clothing, important objects, and background structure. Production defaults SHALL prefer STATIC, slow PUSH_IN, and justified subtle PULL_OUT; pan, orbit, and handheld SHALL require explicit Shot intent and supported bounded strength.

#### Scenario: Compile conservative motion
- **WHEN** no narrative motion is required
- **THEN** the production motion plan SHALL default to STATIC or subtle subject/environment motion rather than adding camera movement for novelty

### Requirement: Raw AI Motion Asset lifecycle includes quality state
Each generated raw Shot clip SHALL remain immutable and persist exact source keyframe and continuation lineage, backend/workflow/model/settings metadata, seed, generation attempt, technical status, review status, automatic temporal QC state, critic evaluation identity, and current/freshness state. A raw clip SHALL become accepted/current only when required automatic and human gates pass. Historical rejected or stale clips SHALL remain queryable.

#### Scenario: Critic unavailable after generation
- **WHEN** a raw clip validates technically but its required temporal critic is unavailable
- **THEN** generation status MAY remain completed, quality status SHALL be unavailable, and the clip SHALL not be reported accepted unless explicit degraded policy permits and records it

## ADDED Requirements

### Requirement: Valid continuation source replaces keyframe generation
When strict continuation eligibility passes, video generation SHALL consume a managed extracted frame from the previous accepted current Shot clip and SHALL persist source clip/Shot/frame lineage. If the source cannot be extracted or is stale, missing, rejected, or wrong-revision, scheduling SHALL fail with a continuation prerequisite error and SHALL not generate an unrelated keyframe silently.

#### Scenario: Missing previous clip
- **WHEN** a continuation Shot has no eligible prior accepted video clip
- **THEN** the system SHALL report `CONTINUATION_SOURCE_MISSING` or equivalent and SHALL not submit video generation
