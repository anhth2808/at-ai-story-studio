## MODIFIED Requirements

### Requirement: Deterministic bounded segmentation
The system SHALL continue to produce ordered provider-safe narration segments from cleaned chapter text, and each persisted segment SHALL also retain the exact chapter revision/source snapshot and a half-open source range mapping back to the chapter text used by Scene planning. Cleaning and whitespace normalization SHALL preserve a deterministic mapping or fail explicitly when a source position cannot be mapped; it SHALL not guess from a different chapter revision.

#### Scenario: Persist segment source ranges
- **WHEN** narration is segmented for a current chapter revision
- **THEN** every TTS segment SHALL retain its text, text hash, source start/end offsets, chapter revision, and stable order for later Scene timing derivation

#### Scenario: Rebuild after chapter edit
- **WHEN** chapter content changes after TTS segments were generated
- **THEN** old segment mappings SHALL remain historical and the new narration schedule SHALL create mappings for the new chapter revision instead of reusing stale positions

### Requirement: Chapter audio merge
The system SHALL merge ordered successful segment audio into a tracked chapter narration Asset, validate it, and retain measured duration plus the ordered source-position/timing manifest. The merged duration SHALL be the authoritative Chapter narration duration for SceneTiming and ChapterTimeline construction.

#### Scenario: Use measured chapter duration
- **WHEN** segment audio is merged successfully
- **THEN** the chapter audio Asset metadata SHALL expose measured duration and cumulative segment timing sufficient to map source ranges into narration time

#### Scenario: Incomplete timing manifest
- **WHEN** a segment is completed but its duration or source mapping is absent/stale
- **THEN** the chapter timeline prerequisite SHALL remain incomplete and the system SHALL not claim valid SceneTiming

### Requirement: Known-text SRT subtitles
The system SHALL continue generating parseable UTF-8 SRT from persisted text and measured segment durations with cumulative monotonic timestamps. Chapter subtitle Assets SHALL remain independently readable and editable and SHALL be consumable for default subtitle burn-in during Chapter Video rendering. Subtitle cue times SHALL remain within the measured chapter audio duration.

#### Scenario: Burn current subtitle at Chapter stage
- **WHEN** a current subtitle Asset exists for a Chapter Video render
- **THEN** the renderer SHALL use that exact subtitle revision for the Chapter and SHALL not require project-level SRT time shifting during Project Video assembly

### Requirement: Subtitle manual override
The system SHALL allow validated manual subtitle replacement without changing TTS audio or Scene Clips. Replacing a Chapter subtitle SHALL invalidate only that Chapter's video descendants and any Project Videos that include it.

#### Scenario: Edit subtitles without rebuilding images
- **WHEN** a user saves a valid replacement SRT
- **THEN** narration and all Scene Clips SHALL remain reusable while the containing Chapter Video and downstream Project Video become stale
