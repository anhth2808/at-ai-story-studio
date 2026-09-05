## ADDED Requirements

### Requirement: Scene plans own bounded Shot-plan descendants
A current Scene revision SHALL be the parent input for one current revisioned Shot plan containing ordered Narrative Beats and Shots. Scene planning MAY schedule Shot planning as a separate durable operation, but Scene records SHALL remain the canonical narrative boundary and SHALL NOT embed generated image/video Assets. Scene detail reads SHALL expose bounded Shot-plan status and counts rather than every full Shot prompt by default.

#### Scenario: Inspect Scene Shot status
- **WHEN** a current Scene has a 12-Shot plan
- **THEN** the normal Scene detail SHALL expose current plan revision, freshness, issue counts, and bounded summaries while a selective Shot endpoint returns individual Shot details

### Requirement: Hard and soft environment inputs remain separate
Scene planning SHALL resolve a canonical hard Location identity separately from Scene-time weather, lighting, atmosphere, temporary objects, and temporary damage. Scene edits to soft state SHALL stale dependent Shot prompts and media but SHALL NOT create or mutate canonical Location geometry implicitly.

#### Scenario: Change weather only
- **WHEN** a Scene's weather changes at an unchanged Location
- **THEN** the Scene's Shot descendants SHALL become stale while the Location profile and canonical reference remain current

### Requirement: Shot planning uses bounded source and continuity context
Shot planning SHALL use the exact current Scene source range, bounded chapter context, relevant Character and Location identities, and neighboring Shot or Scene continuity summaries. It SHALL NOT load the complete novel or mutate StoryState. Structured output SHALL be strictly runtime-validated before any plan becomes current.

#### Scenario: Plan a late chapter Scene
- **WHEN** a Scene in chapter 100 is planned into Shots
- **THEN** the request SHALL use bounded relevant context and persist provenance without serializing all prior chapter prose
