## MODIFIED Requirements

### Requirement: Explicit deterministic conditioning mapping
Conditioned generation SHALL carry an ordered `ReferenceBinding` set derived only from the current Shot Visual Prompt Package and approved current Assets. Every binding SHALL persist ordinal, role, Asset ID, entity ID, optional appearance-stage ID, content hash, profile/reference revision, and fingerprint. Provider image N SHALL map to persisted ordinal N; implicit transient list order SHALL NOT be the only identity binding. Bounded quality production MAY condition Characters, Location, and approved supported object references up to the approved workflow limit.

#### Scenario: Bind Character and Location
- **WHEN** a medium Shot uses two visible Character stages and one canonical Location reference
- **THEN** the persisted request SHALL identify exactly which Asset is image 1, image 2, and image 3 and each prompt placeholder SHALL match that order

### Requirement: Generation mode is explicit and profile-aware
Project image settings SHALL retain `TEXT_ONLY` and `REFERENCE_CONDITIONED`, and Scene/Shot scheduling SHALL accept an explicit allowed override. Existing low-cost/manual text-only behavior SHALL remain available. In production QUALITY mode, important visible Characters SHALL require approved exact Character or appearance-stage references, and a canonical Location reference SHALL be used when available. Missing required references SHALL fail with an actionable prerequisite error unless the selected profile explicitly permits an audited text-only fallback; fallback SHALL never be presented as conditioned generation.

#### Scenario: Quality Shot lacks primary reference
- **WHEN** a QUALITY Shot contains an important visible Character without the exact required approved reference
- **THEN** scheduling SHALL block with the missing entity/stage identity unless an explicit audited fallback policy allows text-only generation

### Requirement: Exact references never fuzzy-fallback
Reference resolution SHALL match stable entity and stage identifiers, not fuzzy names or nearest variants. A requested appearance stage SHALL never silently fall back to a prototype, another stage, another Character, or another Asset. A stale, rejected, unapproved, cross-project, or hash-mismatched Asset SHALL be ineligible.

#### Scenario: Similar stage name exists
- **WHEN** a Shot requests stage `winter-coat` and only `winter-coat-damaged` exists
- **THEN** resolution SHALL report `winter-coat` missing and SHALL not bind the similar stage

## ADDED Requirements

### Requirement: Shot-size-aware reference priority
A production Shot with a canonical Location SHALL retain Location conditioning at every Shot size. CLOSE_UP and EXTREME_CLOSE_UP SHALL prioritize Character identity while describing the Location as a local cropped slice; MEDIUM SHALL include Character and Location references; WIDE and EXTREME_WIDE SHALL prioritize Location while including exact Character references as required. The policy SHALL be deterministic and fingerprinted.

#### Scenario: Condition a close-up
- **WHEN** a close-up has an exact Character-stage reference and canonical Location reference
- **THEN** both bindings SHALL remain present, Character identity SHALL receive higher prompt priority, and background text SHALL describe a limited local slice rather than dropping Location continuity
