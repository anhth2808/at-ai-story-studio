## ADDED Requirements

### Requirement: Persist project image-generation configuration
Each project MAY store one current bounded image-generation configuration and its output-affecting values SHALL participate in Scene image fingerprints. Configuration changes SHALL not modify Story settings, chapter text, StoryState, Scene narrative revisions, Visual Profiles, TTS, subtitles, backgrounds, or existing rendered video Assets.

#### Scenario: Change image resolution
- **WHEN** a user changes the project's image width and height
- **THEN** new generations SHALL use the new settings and existing generated images SHALL remain historical without changing narrative or audio state

### Requirement: Scope image freshness to dependent Scenes
A Visual Prompt Package or output-affecting image configuration change SHALL mark only image revisions whose fingerprints depend on the changed input visually stale. It SHALL not delete those images or stale unrelated Scene images. Current manual Scene images SHALL remain selectable and their provenance SHALL stay distinct from generated freshness.

#### Scenario: Change one location profile
- **WHEN** a location profile changes for Scenes 3 and 7
- **THEN** packages and generated images for Scenes 3 and 7 SHALL become stale while unrelated Scene images, chapter content, TTS, subtitles, backgrounds, and renders remain unchanged

### Requirement: Persist Scene image selection across restart
Project reads SHALL recover image settings, generation history, freshness, review status, provider prompt correlation, Asset linkage, and explicit current Scene image selection after API or worker restart.

#### Scenario: Restart after selecting a revision
- **WHEN** the application restarts after a user selects image revision 2 as current
- **THEN** revision 2 SHALL remain current and every prior revision SHALL remain available with its existing metadata
