## ADDED Requirements

### Requirement: Robust decodable audio duration
Where repeated encoded-segment padding could accumulate timeline error, narration timing SHALL use a robust decodable playback-duration measurement rather than blindly trusting container duration. The media utility SHALL return explicit measurement provenance and SHALL fail safely or expose a bounded fallback when decoding cannot be measured.

#### Scenario: MP3 padding differs from playback
- **WHEN** an MP3 segment's container duration includes encoder padding beyond decodable playback
- **THEN** timeline accumulation SHALL use the measured playback duration and persist or expose the measurement method

### Requirement: Generic anomalous narration detection
Each completed TTS segment SHALL support a provider-neutral bounded quality check for near-empty audio, implausible text-to-duration ratio, excessive silence ratio or activity loss, and extreme duration. Thresholds SHALL be configurable within safe bounds and adapted to the active provider rather than copied as a single universal constant. A rejected segment MAY retry or use an explicit configured fallback only within existing attempt limits; successful sibling segments SHALL remain reusable.

#### Scenario: Long silent tail
- **WHEN** a segment contains brief speech followed by anomalously long silence relative to its text
- **THEN** the segment SHALL be rejected with a typed quality issue and only that segment SHALL be retried or escalated

#### Scenario: Quality check cannot inspect audio
- **WHEN** duration or activity measurement fails
- **THEN** the segment SHALL not be silently marked quality-passed and policy SHALL decide retry or intervention
