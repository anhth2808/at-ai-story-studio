## ADDED Requirements

### Requirement: Clip source and AI status in timeline
The timeline per-Scene card SHALL display the SceneClip source mode (KEN_BURNS/AI_VIDEO/HYBRID), the AI motion generation/review status when applicable, and a playable normalized SceneClip preview. AI controls SHALL integrate into the existing timeline/Scene surfaces; no separate AI video timeline view SHALL be created.

#### Scenario: Scene clip preview in timeline
- **WHEN** a Scene has a current normalized SceneClip of AI origin
- **THEN** the timeline card SHALL offer playback of that clip and show its source badge
