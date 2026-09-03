## Purpose

Make long-form rendering observable, resumable, and economical by planning hierarchical dependencies before work, reusing valid outputs, and invalidating only the changed Scene, Chapter, and Project descendants.

## ADDED Requirements

### Requirement: Render plan before execution
The system SHALL be able to build a dry-run RenderPlan for a Scene, Chapter, Chapter range, selected Chapters, or full Story render. The plan SHALL identify missing, stale, reusable, and blocked Scene Clips and Chapter Videos, the required final assembly, selected scope, expected duration where known, and named prerequisites. A dry run SHALL not start a workflow job or FFmpeg process.

#### Scenario: Preview a full-story plan
- **WHEN** a user requests a dry-run plan for a long Story
- **THEN** the result SHALL report counts such as reusable and required Scene Clips, reusable and required Chapters, and final assembly status without loading all media bytes or starting rendering

#### Scenario: Missing accepted image in a plan
- **WHEN** a selected Scene lacks a valid accepted/current image
- **THEN** the plan SHALL mark that Scene and its dependent Chapter/Project work blocked with an explicit prerequisite

### Requirement: Hierarchical fingerprints
The system SHALL compute stable fingerprints from canonical JSON over direct ordered inputs and output-affecting settings. A Scene Clip fingerprint SHALL include the current Scene image Asset hash, SceneTiming revision/data, MotionPlan revision/data, fitting/aspect settings, resolution, FPS, quality preset, transition-relevant clip settings, and compiler version. A Chapter Video fingerprint SHALL include ordered Scene Clip fingerprints, narration Asset hash, subtitle hash, chapter audio/subtitle render settings, and compiler version. A Project Video fingerprint SHALL include ordered Chapter Video fingerprints, project music hash and settings when enabled, project render settings, and compiler version. Grouping IDs, timestamps, and unrelated project inputs SHALL not affect these fingerprints.

#### Scenario: Repeat an unchanged render
- **WHEN** a render is requested with identical direct inputs and settings and the prior output is valid/current
- **THEN** the system SHALL reuse the existing output Asset and SHALL not execute FFmpeg again

#### Scenario: Change one Scene image
- **WHEN** only one accepted Scene image Asset hash changes
- **THEN** only that Scene Clip fingerprint and its dependent Chapter and Project fingerprints SHALL change; unrelated Scene Clip and Chapter fingerprints SHALL remain unchanged

### Requirement: Scoped invalidation
The system SHALL propagate invalidation only from a changed input through its persisted dependency descendants. Changing a Scene image or MotionPlan SHALL stale that Scene Clip, its containing Chapter Video, and affected Project Videos. Changing one Chapter subtitle, narration, or SceneTiming SHALL stale only that Chapter Video and affected Project Videos. Changing project music or project-level settings SHALL stale Project Videos without staling reusable Scene Clips or unrelated Chapter Videos.

#### Scenario: Change a late Chapter
- **WHEN** Chapter 47 audio, subtitle, or timing changes
- **THEN** Chapters 1-46 and other unaffected Chapter Videos SHALL remain reusable, while Chapter 47 and downstream Project assembly become stale

#### Scenario: Change a different Chapter subtitle
- **WHEN** a subtitle in Chapter 4 is replaced
- **THEN** Scene Clips for Chapter 4 and every other Chapter SHALL remain valid, Chapter 4 Video SHALL rebuild, and the Project SHALL reassemble

### Requirement: Explicit dependency readiness
A render execution SHALL use only current, fingerprint-matching dependencies. It SHALL wait for or explicitly schedule missing dependencies according to the requested auto-build policy. It SHALL not substitute stale Chapter Videos, rejected Scene images, failed Scene Clips, or missing audio/subtitles without an explicit fallback policy recorded in the plan and manifest.

#### Scenario: Auto-build full Story
- **WHEN** a user explicitly requests full-story auto-build
- **THEN** the system SHALL schedule only missing or stale Scene/Chapter dependencies, preserve valid outputs, and assemble the Project after all required dependencies complete

#### Scenario: Auto-build disabled
- **WHEN** a render plan contains missing dependencies and auto-build is disabled
- **THEN** the render request SHALL return the plan and named blockers without creating an incomplete final output

### Requirement: Persisted progress and hierarchical status
The system SHALL persist progress for Scene Clips, Chapters, and final assembly, including current render time where available, expected duration, percentage, status, attempt, and bounded safe diagnostics. Project status SHALL expose hierarchical counts rather than only one aggregate percentage.

#### Scenario: Observe a long render
- **WHEN** Scene Clip and Chapter jobs are executing
- **THEN** status reads SHALL distinguish completed/running/pending/failed work at each level and SHALL identify the active stage and prerequisite blockers

### Requirement: Retry and restart resume at unit scope
A failed or cancelled Scene Clip SHALL be independently retryable. Retrying it SHALL not rerender completed sibling Scene Clips. After API, worker, or computer restart, completed valid Scene Clips and Chapter Videos SHALL remain reusable and in-progress work SHALL be recovered through the existing durable lease/attempt model. A final Project assembly SHALL not discard reusable lower-level outputs.

#### Scenario: Retry one failed Scene
- **WHEN** Scene Clip 127 fails and is retried after its inputs remain unchanged
- **THEN** only Scene Clip 127 SHALL run again, its Chapter SHALL resume once all required clips are valid, and earlier successful Scene Clips SHALL not run again

#### Scenario: Recover after worker restart
- **WHEN** the worker stops after several Scene Clips or Chapters complete
- **THEN** a restarted worker SHALL recover pending/expired work and reuse completed matching Assets without duplicate rendering

### Requirement: Failure blocks dependents honestly
If a required Scene Clip fails, its Chapter Video and dependent Project Video SHALL remain pending or failed with a named dependency error. A project render SHALL not silently omit a visual interval or use an old output that no longer matches the current fingerprint.

#### Scenario: Scene failure pauses Chapter
- **WHEN** required Scene Clip 8 fails
- **THEN** Chapter Video SHALL not render with a gap, and Project Video SHALL remain blocked until the Scene is retried successfully or an explicit fallback is selected

### Requirement: Managed staging and bounded cleanup
Long renders SHALL write partial outputs under managed attempt staging, avoid loading complete media files into memory, clean successful temporary files, and retain bounded useful failure diagnostics. A disk or filesystem failure SHALL leave workflow state failed/retryable and SHALL not publish a partial current Asset.

#### Scenario: Disk-full failure
- **WHEN** staging or promotion cannot complete because the filesystem rejects a write
- **THEN** the render step SHALL fail safely, preserve its error context, and leave prior valid Assets current and reusable

### Requirement: Render revision history
Each successful Scene Clip, Chapter Video, and Project Video SHALL be an immutable Asset revision with a current pointer governed by its fingerprint and scope. A new render SHALL not overwrite or delete prior successful output merely because it becomes the current revision.

#### Scenario: Preserve previous project output
- **WHEN** a Project Video is reassembled after one Chapter changes
- **THEN** the prior Project Video revision SHALL remain available for playback or diagnosis while the new matching output becomes current
