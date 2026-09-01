## ADDED Requirements

### Requirement: Persist visual consistency work
The workflow system SHALL support independently persisted steps for generating character, location, and recurring-object visual-profile candidates, building visual prompt packages for one scene, and building missing or stale packages for selected chapters. Each step SHALL use the existing workflow statuses, attempts, progress, cancellation, leases, errors, and input fingerprints.

#### Scenario: Schedule a scene prompt build
- **WHEN** a user requests a prompt build for a chapter or selected chapters
- **THEN** the system SHALL persist one bounded step per selected chapter/scene scope and return durable work identifiers without loading all project scenes into one response

### Requirement: Resume visual work safely
A visual step SHALL commit validated profile/package data and provenance before the worker marks it completed. Technical retries SHALL reuse unchanged inputs and existing completed output; creative profile regeneration SHALL create a reviewable candidate/revision rather than silently changing approved identity.

#### Scenario: Recover after worker restart
- **WHEN** a worker restarts after a visual profile or package commit but before step completion
- **THEN** recovery SHALL detect the committed matching fingerprint and avoid duplicate OMP generation

#### Scenario: Retry one failed package
- **WHEN** one scene package fails while other packages are current
- **THEN** retrying SHALL rerun only the failed scope and SHALL leave unrelated package and story/media state unchanged

### Requirement: Scope visual dependencies
Visual profile and Style Bible changes SHALL invalidate only dependent visual prompt steps/packages. Visual workflow steps SHALL not create or trigger TTS, subtitle, background, render, or image-provider work.

#### Scenario: Change a character profile
- **WHEN** one character visual revision changes
- **THEN** only steps/packages that reference that character SHALL become stale or pending rebuild
