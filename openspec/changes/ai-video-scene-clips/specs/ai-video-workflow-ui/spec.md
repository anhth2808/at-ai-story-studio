## Purpose

Give the user explicit control over AI scene motion: choosing which Scenes get AI motion, reviewing raw clips before use, previewing both raw and normalized outputs, and seeing AI work and cost in the timeline and render plan - without a separate AI video timeline or hidden auto-generation.

## ADDED Requirements

### Requirement: Scene motion controls
The Scene surface SHALL expose the motion source picker (Ken Burns / AI Video / Hybrid), the video workflow/model in use, the current motion prompt with editing, seed, generation status, and actions Generate, Retry, and Regenerate. AI generation SHALL be opt-in per explicit user action.

#### Scenario: Choose hybrid motion
- **WHEN** a user sets a Scene's motion source to Hybrid and generates AI motion
- **THEN** the Scene SHALL show generation progress and result status, and the Scene remains renderable via Ken Burns fallback while generation is missing or failed

### Requirement: AI motion review
The review surface SHALL show the raw AI clip, its source Scene image, and the motion prompt together, with Accept, Reject, and Regenerate-with-feedback actions, issue tags (identity drift, face/body distortion, motion too strong/weak, camera wrong, morphing, flicker, loop artifacts, other), and free-form notes. Review SHALL be required before a raw clip becomes production-current when approval gating is enabled.

#### Scenario: Reject identity drift
- **WHEN** a user rejects a raw clip with IDENTITY_DRIFT and a note
- **THEN** the clip SHALL not feed the normalized SceneClip, and a later regenerate-with-feedback SHALL combine the original motion intent, the issue tags, and the note without mutating canonical Scene or Visual Bible data

### Requirement: Raw and normalized previews
The UI SHALL preview the raw AI Motion Asset and the normalized final SceneClip as distinct outputs, including for HYBRID Scenes so the user sees how the short AI clip becomes the full Scene duration.

#### Scenario: Preview hybrid composition
- **WHEN** a HYBRID Scene has an accepted clip and a current normalized SceneClip
- **THEN** both SHALL be playable from the Scene/timeline surface

### Requirement: Timeline clip source visibility
The timeline per-Scene display SHALL indicate the SceneClip source (KEN_BURNS, AI_VIDEO, HYBRID) and AI motion status alongside existing timing/motion controls, in the same timeline rather than a separate AI view.

#### Scenario: Mixed chapter timeline
- **WHEN** a Chapter mixes Ken Burns, AI video, and hybrid Scenes
- **THEN** each Scene card SHALL show its source badge and any AI prerequisite status

### Requirement: Render plan AI visibility
The RenderPlan display SHALL report AI-specific work: Scenes with missing AI motion, AI SceneClips to normalize, estimated generation count, and an approximate time estimate from recent real generation durations when available, labeled as an estimate. Full-story render SHALL NOT auto-launch AI generation; preparing AI motion is a separate explicit step or confirmation.

#### Scenario: Plan before bulk generation
- **WHEN** a user opens the render plan for a Story where 12 of 60 AI-mode Scenes lack motion
- **THEN** the plan SHALL show the missing AI work and estimate, and pressing render SHALL not silently start the 12 generations

### Requirement: Batch AI generation with selection
The UI SHALL support generating AI motion for one Scene, selected Scenes, or Scenes missing AI motion within a Chapter, as explicit user actions with per-Scene failure isolation. Batch defaults SHALL NOT target the whole project without explicit selection.

#### Scenario: One failure does not restart the batch
- **WHEN** Scene 8 of a 10-Scene batch fails
- **THEN** Scenes 1-7 results SHALL remain valid and only Scene 8 needs retry

### Requirement: Video readiness display
The UI SHALL surface AI video readiness separately from image readiness with actionable states (for example ComfyUI unavailable, video model missing) and the active preset.

#### Scenario: Missing model guidance
- **WHEN** video readiness reports VIDEO_MODEL_MISSING
- **THEN** the UI SHALL show which model files are expected and where they belong, without auto-downloading anything
