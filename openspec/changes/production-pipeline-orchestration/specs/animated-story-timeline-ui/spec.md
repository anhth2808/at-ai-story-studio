## ADDED Requirements

### Requirement: Production dashboard sits beside existing workspaces
The web application SHALL expose a Production surface alongside existing Story, Scenes, Visual Bible, Images, Audio, Timeline, Video, and Render surfaces. It SHALL show profile/scope selection, side-effect-free plan preview, persisted run/stage progress, intervention status, pause/resume/cancel/retry controls, and a link to the ready publication package without replacing existing editors.

#### Scenario: Preview without scheduling
- **WHEN** a user opens Production and requests Preview Plan
- **THEN** the UI SHALL show reuse/build/review/block classifications and named warnings without creating workflow jobs

#### Scenario: Waiting for review
- **WHEN** a run has a blocking IMAGE_REVIEW_REQUIRED intervention
- **THEN** the Production surface SHALL show the affected Scene identity, the existing review destination, WAITING_FOR_USER status, and a Resume action after resolution
