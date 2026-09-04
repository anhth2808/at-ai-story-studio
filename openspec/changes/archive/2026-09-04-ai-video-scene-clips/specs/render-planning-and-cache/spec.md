## MODIFIED Requirements

### Requirement: Render plan before execution
The system SHALL be able to build a dry-run RenderPlan for a Scene, Chapter, Chapter range, selected Chapters, or full Story render. The plan SHALL identify missing, stale, reusable, and blocked Scene Clips and Chapter Videos, the required final assembly, selected scope, expected duration where known, and named prerequisites. A dry run SHALL not start a workflow job or FFmpeg process. For AI-sourced Scenes the plan SHALL additionally report AI motion assets missing, AI SceneClips requiring normalization, estimated generation count, and an approximate AI time estimate from recent completed generation durations when available. The plan SHALL never schedule AI generation implicitly.

#### Scenario: Preview a full-story plan
- **WHEN** a user requests a dry-run plan for a long Story
- **THEN** the result SHALL report counts such as reusable and required Scene Clips, reusable and required Chapters, and final assembly status without loading all media bytes or starting rendering

#### Scenario: Missing accepted image in a plan
- **WHEN** a selected Scene lacks a valid accepted/current image
- **THEN** the plan SHALL mark that Scene and its dependent Chapter/Project work blocked with an explicit prerequisite

#### Scenario: AI work is visible before rendering
- **WHEN** a plan covers Scenes in AI_VIDEO/HYBRID mode lacking accepted raw clips
- **THEN** the plan SHALL count them as AI-missing, report the estimated generation workload, and mark the affected clips blocked or fallback-eligible per policy without starting generation

## ADDED Requirements

### Requirement: Raw AI asset reuse across render-only changes
Render-scoped changes - SceneTiming adjustments, subtitle or music changes, quality preset or final resolution changes - SHALL reuse current raw AI Motion Assets and SHALL not invoke the video provider. Only normalized SceneClips and downstream Chapter/Project outputs rebuild. Provider calls SHALL occur only when the raw generation fingerprint inputs change (source image, motion plan, provider settings, workflow version, seed).

#### Scenario: Subtitle change reuse
- **WHEN** a Chapter subtitle is replaced after AI clips are normalized
- **THEN** the raw AI assets and normalized SceneClips SHALL be reused, only the Chapter Video and Project Video rebuild, and no provider call SHALL occur
