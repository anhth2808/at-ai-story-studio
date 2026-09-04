## ADDED Requirements

### Requirement: Raw AI motion asset type and storage
The system SHALL add an immutable raw AI Motion Asset type (`AI_SCENE_VIDEO`) stored under managed project video directories (for example `projects/{projectId}/video/motion/{sceneStableId}/{generationId}.mp4`) with workspace-relative paths, sha256, size tracking, and the same path-safety and promotion guarantees as other media assets. Raw assets SHALL remain distinct from normalized `SCENE_VIDEO_CLIP` assets, SHALL never be deleted by normalization or rebuilds, and their storage footprint SHALL be observable.

#### Scenario: Raw and normalized stay separate
- **WHEN** a raw clip is normalized into a SceneClip
- **THEN** two distinct Asset rows SHALL exist (raw AI_SCENE_VIDEO plus normalized SCENE_VIDEO_CLIP), each independently reusable and never overwriting the other
