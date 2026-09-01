## ADDED Requirements

### Requirement: Resolve canonical visual identity separately
The Scene Engine SHALL resolve current character, location, recurring-object, and Style Bible profiles when building visual output, while retaining Scene narrative structure and Scene-specific visual state as separate inputs. It SHALL not treat Scene records as the canonical source for recurring appearance.

#### Scenario: Build a consistent scene package
- **WHEN** a current Scene references known visual profiles
- **THEN** the resolved output SHALL include canonical profile revisions plus scene-specific state without rewriting scene structure or StoryState

### Requirement: Rebuild prompts without replanning scenes
The Scene Engine SHALL rebuild a Visual Prompt Package from the current Scene revision and current visual dependencies without regenerating scene boundaries, source ranges, narrative purpose, or chapter content. Prompt rebuild SHALL be independently requestable and persist its dependency provenance.

#### Scenario: Refresh after a style change
- **WHEN** a Style Bible revision makes a scene prompt stale
- **THEN** rebuilding SHALL create a current package from the unchanged Scene revision and new style revision

### Requirement: Preserve scene prompt dependency evidence
Scene visual output SHALL identify every resolved profile revision, variant revision, Style Bible revision, scene revision, and prompt-template version used to assemble the result. Missing or ambiguous visual references SHALL remain visible as warnings rather than being silently invented.

#### Scenario: Missing profile during scene resolution
- **WHEN** a known scene character has no current visual profile
- **THEN** the Scene Engine SHALL retain the scene and expose a missing-profile warning in the package/check result
