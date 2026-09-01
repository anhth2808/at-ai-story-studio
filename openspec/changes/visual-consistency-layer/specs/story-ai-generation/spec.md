## ADDED Requirements

### Requirement: Structured visual-profile candidates
The story AI boundary SHALL support separate provider-independent operations for character, location, and recurring-object visual-profile candidates. Each operation SHALL receive bounded existing story data and project Style Bible context, return a simple structured result, and remain distinct from scene planning and image generation.

#### Scenario: Generate a profile candidate
- **WHEN** a user requests a character or location visual profile from available story data
- **THEN** the boundary SHALL return a candidate that can be validated and reviewed before becoming canonical

#### Scenario: Avoid unbounded story context
- **WHEN** a profile candidate is requested for a late chapter
- **THEN** the operation SHALL use selected relevant story data rather than serializing the complete novel

### Requirement: Validate visual AI output before persistence
Every visual-profile candidate and optional prompt-refinement result SHALL pass the operation's runtime schema and reference checks before persistence. Invalid output SHALL preserve the prior current profile/package and produce a safe retryable or terminal diagnostic according to the error category.

#### Scenario: Reject malformed profile output
- **WHEN** OMP returns unknown fields, malformed JSON, or values outside bounded visual-profile fields
- **THEN** the application SHALL reject the candidate and SHALL not overwrite an approved profile

### Requirement: Preserve canonical constraints during refinement
Optional visual prompt refinement MAY improve wording but SHALL retain the structured package separately and SHALL not contradict approved canonical profile attributes, selected variants, scene state, or Style Bible constraints. A refinement failure SHALL leave the deterministic package usable.

#### Scenario: Refinement conflicts with canonical identity
- **WHEN** a refinement proposes a different approved hair color or location landmark
- **THEN** the application SHALL reject or flag the refinement and SHALL preserve the canonical structured package
