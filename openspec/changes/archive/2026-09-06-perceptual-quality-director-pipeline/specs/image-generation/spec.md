## ADDED Requirements

### Requirement: Shot-level image generation
Image generation SHALL accept current Shot Visual Prompt Packages while preserving the existing Scene-level API for Scenes without Shot plans. A Shot candidate SHALL retain exact Scene/Shot revisions, ordered reference bindings, candidate-set identity, seed, settings, workflow, critic state, and immutable Asset lineage. Completing one Shot candidate SHALL not alter unrelated Shots or Scene narrative data.

#### Scenario: Generate one Shot candidate
- **WHEN** an eligible current Shot package is scheduled
- **THEN** the provider request SHALL use that exact package and binding order and the resulting Asset SHALL be linked to the Shot and Scene revisions

### Requirement: Production candidate count follows bounded policy
Production scheduling SHALL obtain image candidate count from the immutable ProductionProfile snapshot and a deterministic Shot-importance policy rather than hard-code one. FAST SHALL request one candidate. BALANCED SHALL request one or two candidates. QUALITY SHALL request two or three candidates for important identity-sensitive, speaking close-up, hero, or reveal Shots. The system SHALL retain existing candidate and batch hard caps and SHALL not request three candidates for every trivial Shot.

#### Scenario: Important QUALITY Shot
- **WHEN** a QUALITY profile schedules a hero speaking close-up marked high importance
- **THEN** it SHALL request the configured bounded quality candidate count up to three

#### Scenario: Trivial BALANCED Shot
- **WHEN** BALANCED schedules a low-importance environment detail
- **THEN** it SHALL request one candidate unless explicit bounded policy says otherwise

### Requirement: Candidate fingerprints include quality inputs
A Shot image candidate fingerprint SHALL include exact Shot/Scene revisions, prompt package fingerprint, ordered reference bindings and hashes, conditioning mode, candidate policy version, workflow mapping, provider settings, concrete seed, generation instructions, and regeneration guidance. Critic evaluations SHALL not change an already generated Asset fingerprint but SHALL govern selection eligibility.

#### Scenario: Reference ordinal changes
- **WHEN** the same reference Assets are reordered under a new binding set
- **THEN** the candidate fingerprint SHALL change and the prior candidate SHALL not be current for the new request
