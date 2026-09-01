## ADDED Requirements

### Requirement: Provider-neutral image handoff
A CURRENT Visual Prompt Package SHALL be the exclusive narrative and visual-context input for an image-generation operation. The package SHALL expose its exact identity, status, positive prompt, negative prompt, reference-asset identifiers, and input fingerprint without embedding ComfyUI node IDs, checkpoint names, samplers, schedulers, guidance, seeds, or other provider execution settings. Visual Consistency operations themselves SHALL remain separate from provider submission.

#### Scenario: Hand a package to image generation
- **WHEN** a user explicitly schedules image generation for a Scene with a CURRENT package
- **THEN** the image layer SHALL consume the persisted package and SHALL NOT ask the Visual Consistency service to reconstruct Story context

#### Scenario: Reference conditioning is unavailable
- **WHEN** the package contains reference assets but the selected image workflow is text-only
- **THEN** the package and provider request SHALL retain the references while the result SHALL disclose that they were not consumed

### Requirement: Visual changes stale dependent images
Changing a character, location, recurring-object, Style Bible, Scene, object resolution, or prompt refinement input SHALL continue to stale the dependent Visual Prompt Package and SHALL also make images generated from that package visually stale. Historical image Assets SHALL be retained and their generation success SHALL remain distinct from freshness.

#### Scenario: Change a character profile after image generation
- **WHEN** an approved Character Visual Profile revision changes after a Scene image completed
- **THEN** the dependent package and image SHALL become visually stale without deleting the image, changing its review status, or invalidating unrelated images

#### Scenario: Rebuild a stale package
- **WHEN** a user rebuilds a package after a dependency change
- **THEN** the old image SHALL remain historical and a new image SHALL require an explicit generate/regenerate action
