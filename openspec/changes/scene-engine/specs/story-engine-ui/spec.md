## ADDED Requirements

### Requirement: Scenes project area

The Story workspace SHALL expose a Vietnamese Scenes area that lists chapter scene-plan status and count with actions to generate scenes for a chapter or selected chapters. It SHALL preserve the existing Story, Audio, Subtitle, Video, and Render actions and SHALL show persisted workflow status rather than browser-only progress.

#### Scenario: Open scenes for a project
- **WHEN** a user opens the Scenes area
- **THEN** the UI SHALL show paginated chapter metadata, current scene counts/statuses, density controls, and Generate Scenes actions without loading every chapter's full prose

### Requirement: Scene review and source preview

The scene editor SHALL show scene order, title, purpose, location, characters, mood, camera, visual description, image prompt, and bounded source excerpt for the associated chapter revision. All user-facing copy, errors, empty states, and actions SHALL be Vietnamese while machine enum values remain available for diagnostics.

#### Scenario: Review a generated scene
- **WHEN** a chapter has a completed scene plan
- **THEN** the user SHALL be able to inspect each scene's source excerpt and structured visual fields

### Requirement: First-class scene editing and regeneration

The UI SHALL allow a user to edit supported scene fields and independently regenerate one scene. It SHALL communicate stale/invalidated prompt or scene status and SHALL not silently replace manual edits.

#### Scenario: Regenerate one scene from the editor
- **WHEN** a user selects Regenerate Scene for scene 2
- **THEN** the UI SHALL show durable operation progress and, on success, refresh only scene 2's revision while leaving neighboring scenes visible and unchanged

### Requirement: Visual style controls

The Scenes area SHALL provide basic project visual-style editing and scene-density selection, including LOW, MEDIUM, and HIGH values and an optional bounded target range. Invalid input SHALL be shown as a safe validation error without discarding the current style.

#### Scenario: Change project style
- **WHEN** a user changes the style from anime to cinematic realistic
- **THEN** the UI SHALL show that scene structure remains available and image prompts require refresh

### Requirement: Large-project reads remain selective

Scene dashboard reads SHALL use pagination or chapter filters and SHALL request scene detail/source excerpts separately where useful. The UI SHALL not require a single response containing all chapters, prose, and scene records for a large project.

#### Scenario: Browse 100 chapters
- **WHEN** a project contains 100 chapters and many scene plans
- **THEN** the UI SHALL load bounded pages and preserve the user's selected chapter/scene across refreshes
