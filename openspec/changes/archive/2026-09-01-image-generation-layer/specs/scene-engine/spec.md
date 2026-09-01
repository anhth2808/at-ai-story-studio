## ADDED Requirements

### Requirement: Scene image linkage remains outside planning
Each Scene SHALL expose bounded current-image metadata and image-generation history linked to its stable Scene identity and exact Visual Prompt Package revision. Scene planning and prompt rebuilding SHALL not submit provider jobs; image generation SHALL occur only through an explicit image-layer action after a CURRENT package exists.

#### Scenario: Open a Scene with no image
- **WHEN** a current Scene has a CURRENT Visual Prompt Package but no selected image
- **THEN** Scene detail SHALL report `MISSING` image state and allow an explicit image-generation action without replanning the Scene

#### Scenario: Rebuild prompt after Scene edit
- **WHEN** a Scene edit makes its package and prior generated image stale
- **THEN** Scene narrative revisions and image history SHALL remain preserved while generation requires the rebuilt current package

### Requirement: Explicit current Scene image
A Scene MAY have multiple provider-generated and manually uploaded image revisions, but SHALL identify at most one current image by explicit selection. Current selection SHALL not change Scene narrative structure, chapter content, StoryState, narration, subtitles, or neighboring Scenes.

#### Scenario: Select an older Scene image
- **WHEN** a user selects a valid historical image revision as current
- **THEN** Scene detail SHALL return that image as current without changing the Scene revision or deleting newer image history
