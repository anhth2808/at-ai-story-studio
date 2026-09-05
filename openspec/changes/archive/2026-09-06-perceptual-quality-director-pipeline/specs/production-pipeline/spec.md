## ADDED Requirements

### Requirement: Product stages aggregate bounded Shot-level work
The existing ProductionStage set SHALL remain unchanged. `SCENES` SHALL aggregate Shot planning; `VISUAL_PROFILES` SHALL aggregate textual profiles and canonical reference Assets; `VISUAL_PROMPTS` SHALL aggregate Shot packages and exact bindings; `SCENE_IMAGES` SHALL aggregate Shot candidate/critic/ranking work; `AI_MOTION` SHALL aggregate Shot video generation and temporal QC; `TIMELINE` SHALL consume accepted Shot media. Status and plan responses SHALL return bounded counts and samples, not raw critic prompts, full provider graphs, or unbounded Shot payloads.

#### Scenario: Report a large Shot stage
- **WHEN** a production scope contains hundreds of Shots
- **THEN** normal run status SHALL expose persisted bounded totals, progress, failures, and samples without returning every Shot payload

### Requirement: Production profiles have explicit bounded quality policy
A ProductionProfile snapshot SHALL include typed bounded candidate-count policy, image quality-gate enablement, image auto-accept threshold, image regeneration limit, video backend preference, temporal quality-gate enablement, temporal retry limit, quality fallback behavior, and strict-reference requirement. It SHALL not contain arbitrary provider graph JSON. Settings affecting image generation SHALL invalidate only dependent image/video/render work; backend-only settings SHALL invalidate video generation but SHALL not invalidate accepted keyframes.

#### Scenario: Change only video backend preference
- **WHEN** a new profile revision changes Wan preference to LTX-2 without changing image policy
- **THEN** accepted current keyframes SHALL remain reusable while affected video generations receive new fingerprints

### Requirement: Profile modes retain automatic quality validation
MANUAL_REVIEW SHALL run automatic critics and pause at explicit human approval gates. BALANCED SHALL run critics, automatically accept clearly passing media, and escalate uncertainty or exhausted retries. AUTO SHALL run automatic critics, ranking, bounded regeneration, and acceptance and SHALL require intervention only for exhausted retries, hard prerequisites, unavailable required providers, or configured uncertainty. AUTO SHALL NOT mean quality validation disabled.

#### Scenario: AUTO image and video flow
- **WHEN** an AUTO run generates a passing ranked keyframe and passing video within retry limits
- **THEN** both automatic gates SHALL execute and the run MAY proceed without routine human approval while retaining evaluation evidence

### Requirement: Quality failures use interventions without false completion
Missing exact references, critic unavailability, exhausted semantic retries, backend readiness failures, and manual-review requirements SHALL create deduplicated production blockers or interventions according to profile policy. A stage SHALL not report completed while required Shot units lack eligible accepted media.

#### Scenario: Temporal critic unavailable
- **WHEN** a required temporal critic remains unavailable after technical retries
- **THEN** `AI_MOTION` SHALL wait, fail, or require intervention according to profile policy and SHALL not report quality pass

### Requirement: Production orchestration preserves canonical ownership
The ProductionOrchestrator SHALL continue coordinating existing canonical services and SHALL not call image/video critics, generation providers, ComfyUI, or FFmpeg directly. It SHALL reconcile Shot-level current/freshness/review/QC state, link fine-grained durable jobs, schedule bounded missing work, and reuse matching completed work after restart.

#### Scenario: Restart after image critic completion
- **WHEN** the worker restarts after a critic evaluation commits but before stage projection updates
- **THEN** reconciliation SHALL reuse the persisted evaluation and candidate Asset without repeating expensive generation or critique
