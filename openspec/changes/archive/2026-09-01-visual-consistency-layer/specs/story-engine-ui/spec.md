## ADDED Requirements

### Requirement: Visual Bible workspace
The web application SHALL provide a project Visual Bible area with separate Style, Characters, Locations, and Objects sections. It SHALL use Vietnamese user-facing labels, statuses, validation messages, empty states, and errors while preserving the existing Story, Scenes, Audio, Video, and Render areas.

#### Scenario: Open an empty Visual Bible
- **WHEN** a project has no visual profiles
- **THEN** the UI SHALL show actionable missing-profile and style states without implying image generation has started

### Requirement: Edit and review visual profiles
The Visual Bible SHALL allow users to view, edit, approve, and explicitly regenerate character, location, recurring-object, and Style Bible revisions. It SHALL show profile status, revision, canonical prompt fragment, reference slots when present, and safe generation errors. Approved/manual data SHALL not be silently overwritten.

#### Scenario: Review a draft candidate
- **WHEN** a generated character candidate is available
- **THEN** the UI SHALL show it as a draft with an explicit approval/edit action and leave the prior approved revision visible

### Requirement: Review resolved scene packages
Scene detail SHALL show resolved character identities and states, location, objects, Style Bible, visual description, deterministic/refined prompt, negative prompt, dependency status, and consistency warnings. Users SHALL be able to rebuild a stale package without regenerating Scene structure.

#### Scenario: Show a consistency warning
- **WHEN** a scene is missing a visual profile or has a canonical conflict
- **THEN** the UI SHALL show an understandable Vietnamese warning beside the affected reference and package status

### Requirement: Selective Visual Bible reads
Visual Bible lists and scene package lists SHALL be paginated or otherwise bounded. The UI SHALL fetch detail only for the selected profile/scene and SHALL display persisted state after API or worker restart rather than relying on in-memory optimistic state.

#### Scenario: Browse many profiles
- **WHEN** a project contains many scenes and profile revisions
- **THEN** the UI SHALL request bounded metadata pages and SHALL not load all prompt payloads or chapter prose in one dashboard response
