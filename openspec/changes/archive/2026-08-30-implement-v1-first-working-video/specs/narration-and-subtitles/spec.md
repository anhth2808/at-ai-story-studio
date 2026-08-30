## Purpose

Turn manually authored chapter text into reliable, retryable narration and interoperable subtitles using conservative deterministic preparation and measured audio timing.

## ADDED Requirements

### Requirement: Conservative text preparation
The system SHALL create a deterministic cleaned narration representation that normalizes line endings/whitespace and removes only unsupported control or formatting artifacts while preserving meaning, punctuation, paragraph boundaries, and the original chapter content.

#### Scenario: Clean chapter text
- **WHEN** a chapter contains repeated whitespace, line ending variants, or control characters
- **THEN** the TTS input SHALL be normalized deterministically, the original content SHALL remain unchanged, and any removals/replacements SHALL be reportable

### Requirement: Deterministic bounded segmentation
The system SHALL split cleaned text into ordered provider-safe narration segments/chunks using configured limits and stable paragraph/sentence/clause/word boundaries. It SHALL never submit an entire arbitrarily long chapter as one request.

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
The system SHALL merge ordered successful segment audio into a tracked chapter narration asset, validate that it is decodable and non-empty, and retain the measured duration and source segment manifest.

#### Scenario: Missing segment blocks merge
- **WHEN** any required segment is pending, failed, invalidated, or missing
- **THEN** chapter audio SHALL not be promoted as current and the merge step SHALL report the blocking segment

### Requirement: Known-text SRT subtitles
The system SHALL generate UTF-8 SRT subtitles from persisted segment text and actual measured segment durations using cumulative monotonic timestamps. Subtitle output SHALL be parseable, ordered, and bounded by chapter audio duration.

#### Scenario: Generate subtitles
- **WHEN** all chapter narration segments have valid durations
- **THEN** the system SHALL create subtitle cues covering the ordered segment text with non-overlapping timestamps and a downloadable SRT asset

### Requirement: Subtitle manual override
The system SHALL allow a user to edit subtitle text/cues or upload a replacement SRT, validate the result, and make the replacement the current subtitle asset without changing TTS audio.

#### Scenario: Replace subtitle
- **WHEN** a valid replacement SRT is uploaded for a chapter
- **THEN** the system SHALL register it as the current subtitle asset, invalidate only dependent render output, and preserve the current narration

### Requirement: No AI narration features
This capability SHALL NOT invoke LLMs, Story AI, OMP, WhisperX, voice cloning, or image/video generation.

#### Scenario: V1 narration path
- **WHEN** a user generates TTS or subtitles
- **THEN** execution SHALL use authored text, deterministic preparation, Edge TTS, measured media, and subtitle serialization only
