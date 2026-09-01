## ADDED Requirements

### Requirement: Structured scene operations

The story AI boundary SHALL support chapter-level scene planning, independent single-scene regeneration, and visual-prompt refresh as provider-independent structured operations. Scene planning SHALL return an ordered scene collection; scene regeneration SHALL return one replacement scene; prompt refresh SHALL return only the updated prompt fields. Free-form or extra-key output SHALL not be accepted as a successful structured result.

#### Scenario: Generate scenes in one planning request
- **WHEN** a valid chapter and bounded scene context are submitted
- **THEN** the boundary SHALL return one schema-valid scene collection suitable for independent persistence

#### Scenario: Regenerate one scene
- **WHEN** a valid scene source range and bounded neighboring context are submitted
- **THEN** the boundary SHALL return one replacement scene without requiring regeneration of neighboring scenes

### Requirement: Scene output validation and references

The system SHALL validate scene purpose, camera framing, composition fields, source offsets, field bounds, scene ordering, character references, and location references before persistence. Invalid output SHALL preserve the current scene result and SHALL produce a safe structured-output or validation failure.

#### Scenario: Reject an invalid range
- **WHEN** the boundary returns an end offset beyond the supplied chapter revision
- **THEN** no scene from that result SHALL become current and the failed attempt SHALL remain retryable when appropriate

#### Scenario: Resolve or flag a character
- **WHEN** the boundary returns a known character ID or an unmatched character name
- **THEN** the known ID SHALL resolve to the project character, while the unmatched name SHALL be flagged as an explicit unresolved candidate or rejected without creating a duplicate canonical character

### Requirement: Bounded scene generation context

Scene operations SHALL compile context from the current chapter, available chapter plan/summary, applicable arc, selected blueprint characters and CharacterState, active threads/facts, prior scene visual context where needed, and current visual-style settings. They SHALL not serialize the full novel by default and SHALL persist prompt/template version and input fingerprint for accepted and failed attempts.

#### Scenario: Keep context bounded
- **WHEN** scene planning is requested for a late chapter in a 200-chapter project
- **THEN** context size SHALL be bounded by configuration and diagnostics SHALL identify selected and omitted context without including all historical prose

### Requirement: Separate planning data from execution prompts

Scene operations SHALL preserve visual description as domain information and image prompt as an execution-oriented representation. A prompt refresh SHALL be able to use current style/location/character visual inputs without replacing source traceability or narrative scene fields.

#### Scenario: Refresh after style change
- **WHEN** a scene's image prompt is stale because the style revision changed
- **THEN** prompt generation SHALL produce a new prompt revision tied to the current style while leaving the valid scene boundary and visual description intact
