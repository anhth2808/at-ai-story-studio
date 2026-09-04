## ADDED Requirements

### Requirement: AiMotionPlan and motion source storage
The system SHALL persist per-Scene-revision AI motion intent - character action, environment motion, camera intent from a bounded vocabulary, intensity (`SUBTLE`/`MEDIUM`/`STRONG`, default `SUBTLE`), optional priority, and the compiled motion prompt fingerprint - as revisioned records separate from Ken Burns MotionPlan and from SceneTiming. The Scene motion source mode (`KEN_BURNS`/`AI_VIDEO`/`HYBRID`) SHALL be stored per Scene with revision-safe updates. AI generation duration SHALL NOT be derived from SceneTiming.

#### Scenario: Timing rebuild leaves motion intent intact
- **WHEN** SceneTiming is rebuilt after narration changes
- **THEN** the AiMotionPlan revisions and raw AI Motion Assets SHALL remain current and untouched, and only normalized SceneClips rebuild
