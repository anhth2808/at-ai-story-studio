## ADDED Requirements

### Requirement: ProjectVideo exposes deterministic production quality readiness
Before a ProductionRun can build a PublicationPackage, hierarchical rendering SHALL provide a deterministic readiness result covering current ProjectVideo Asset status, selected Chapter coverage/order, required audio and subtitle inputs, fingerprint compatibility, and media probe validation. This result SHALL reuse the existing SceneClip/ChapterVideo/ProjectVideo hierarchy and SHALL not render a second production-specific output.

#### Scenario: Final output passes the gate
- **WHEN** every selected ChapterVideo is current and the ProjectVideo passes validation
- **THEN** the readiness result SHALL be ready for package creation and shall identify the exact ProjectVideo Asset

#### Scenario: Final output is incomplete
- **WHEN** one selected ChapterVideo, narration track, subtitle, or required stream is missing or stale
- **THEN** readiness SHALL fail with a named blocker and package creation SHALL remain incomplete
