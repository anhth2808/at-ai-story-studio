# Narration and subtitles Specification

## Purpose

Turn manually authored chapter text into reliable, retryable narration and interoperable subtitles using conservative deterministic preparation and measured audio timing.

## Requirements

### Requirement: Conservative text preparation
The system SHALL create a deterministic cleaned narration representation that normalizes line endings/whitespace and removes only unsupported control or formatting artifacts while preserving meaning, punctuation, paragraph boundaries, and the original chapter content.

#### Scenario: Clean chapter text
- **WHEN** a chapter contains repeated whitespace, line ending variants, or control characters
- **THEN** the TTS input SHALL be normalized deterministically, the original content SHALL remain unchanged, and any removals/replacements SHALL be reportable

### Requirement: Deterministic bounded segmentation
The system SHALL continue to produce ordered provider-safe narration segments from cleaned chapter text, and each persisted segment SHALL also retain the exact chapter revision/source snapshot and a half-open source range mapping back to the chapter text used by Scene planning. Cleaning and whitespace normalization SHALL preserve a deterministic mapping or fail explicitly when a source position cannot be mapped; it SHALL not guess from a different chapter revision.

#### Scenario: Persist segment source ranges
- **WHEN** narration is segmented for a current chapter revision
- **THEN** every TTS segment SHALL retain its text, text hash, source start/end offsets, chapter revision, and stable order for later Scene timing derivation

#### Scenario: Rebuild after chapter edit
- **WHEN** chapter content changes after TTS segments were generated
- **THEN** old segment mappings SHALL remain historical and the new narration schedule SHALL create mappings for the new chapter revision instead of reusing stale positions
#### Scenario: Same input and configuration
- **WHEN** unchanged chapter text and the same cleaner/segmenter/provider limits are processed twice
- **THEN** the segment sequence, text, order, and hashes SHALL be identical

#### Scenario: Oversized sentence
- **WHEN** one sentence exceeds the configured provider limit
- **THEN** it SHALL be split at the safest available punctuation/word/grapheme boundary and expose a warning rather than failing through an unbounded request

### Requirement: TTS provider boundary
Narration workflow SHALL depend on a narrow TTS capability that returns normalized audio candidates and optional timing metadata. The initial configured provider SHALL be Edge TTS, and provider-specific protocol details SHALL not be exposed to workflow or UI contracts.

#### Scenario: Synthesize one segment
- **WHEN** an eligible TTS segment is executed with valid text and configuration
- **THEN** Edge TTS SHALL produce a validated non-empty audio asset candidate with measured duration or a visible structured failure

#### Scenario: Provider failure
- **WHEN** Edge TTS is unavailable, rejects input, times out, or produces invalid audio
- **THEN** only the affected segment attempt SHALL fail with retryability/error details and completed valid segments SHALL remain reusable

### Requirement: Independent segment retry
The system SHALL persist segment text/hash/status/audio/duration/attempt/error and SHALL retry failed or invalidated segments independently while reusing completed segments whose fingerprints still match.

#### Scenario: Retry failed segment only
- **WHEN** segments 1 and 2 are completed and valid and segment 3 failed
- **THEN** retry SHALL not call the provider for segments 1 or 2 and SHALL call it for segment 3

### Requirement: Chapter audio merge
The system SHALL merge ordered successful segment audio into a tracked chapter narration Asset, validate it, and retain measured duration plus the ordered source-position/timing manifest. The merged duration SHALL be the authoritative Chapter narration duration for SceneTiming and ChapterTimeline construction.

#### Scenario: Use measured chapter duration
- **WHEN** segment audio is merged successfully
- **THEN** the chapter audio Asset metadata SHALL expose measured duration and cumulative segment timing sufficient to map source ranges into narration time

#### Scenario: Incomplete timing manifest
- **WHEN** a segment is completed but its duration or source mapping is absent/stale
- **THEN** the chapter timeline prerequisite SHALL remain incomplete and the system SHALL not claim valid SceneTiming
#### Scenario: Missing segment blocks merge
- **WHEN** any required segment is pending, failed, invalidated, or missing
- **THEN** chapter audio SHALL not be promoted as current and the merge step SHALL report the blocking segment

### Requirement: Known-text SRT subtitles
The system SHALL continue generating parseable UTF-8 SRT from persisted text and measured segment durations with cumulative monotonic timestamps. Chapter subtitle Assets SHALL remain independently readable and editable and SHALL be consumable for default subtitle burn-in during Chapter Video rendering. Subtitle cue times SHALL remain within the measured chapter audio duration.

#### Scenario: Burn current subtitle at Chapter stage
- **WHEN** a current subtitle Asset exists for a Chapter Video render
- **THEN** the renderer SHALL use that exact subtitle revision for the Chapter and SHALL not require project-level SRT time shifting during Project Video assembly
#### Scenario: Generate subtitles
- **WHEN** all chapter narration segments have valid durations
- **THEN** the system SHALL create subtitle cues covering the ordered segment text with non-overlapping timestamps and a downloadable SRT asset

### Requirement: Subtitle manual override
The system SHALL allow validated manual subtitle replacement without changing TTS audio or Scene Clips. Replacing a Chapter subtitle SHALL invalidate only that Chapter's video descendants and any Project Videos that include it.

#### Scenario: Edit subtitles without rebuilding images
- **WHEN** a user saves a valid replacement SRT
- **THEN** narration and all Scene Clips SHALL remain reusable while the containing Chapter Video and downstream Project Video become stale
#### Scenario: Replace subtitle
- **WHEN** a valid replacement SRT is uploaded for a chapter
- **THEN** the system SHALL register it as the current subtitle asset, invalidate only dependent render output, and preserve the current narration

### Requirement: No AI narration features
This capability SHALL NOT invoke LLMs, Story AI, OMP, WhisperX, voice cloning, or image/video generation.

#### Scenario: V1 narration path
- **WHEN** a user generates TTS or subtitles
- **THEN** execution SHALL use authored text, deterministic preparation, Edge TTS, measured media, and subtitle serialization only
