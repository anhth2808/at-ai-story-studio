## ADDED Requirements

### Requirement: Scene timing allocates ordered Shot units
The existing SceneTiming SHALL remain the canonical narration interval for a Scene and MAY contain ordered Shot timing allocations derived from the current Shot plan. Shot allocations SHALL preserve Scene total timing, exact plan revision, backend legal frame counts, actual generated durations, and bounded residual metadata. They SHALL not rewrite Chapter narration, subtitle cues, or the Scene source range.

#### Scenario: Allocate Shot durations
- **WHEN** a current SceneTiming spans three current Shots
- **THEN** the Shot allocations SHALL remain ordered, cover the timing unit within documented bounded residual, and retain exact Shot-plan lineage

### Requirement: Backend frame rounding integrates with timeline ownership
For backend-generated Shot clips, legal frame allocation SHALL be computed at the parent timing-unit level and recorded with actual durations. The final eligible Shot MAY absorb bounded residual after child minimums and lattice constraints. Timeline-only timing changes SHALL reuse raw accepted clips when raw generation inputs remain unchanged and SHALL adjust normalization/composition rather than regenerating motion.

#### Scenario: Timing-only edit
- **WHEN** a user changes SceneTiming without changing Shot prompt, keyframe, motion plan, backend, or raw-generation settings
- **THEN** accepted raw Shot videos SHALL remain reusable while only affected normalized SceneClip and render descendants become stale

### Requirement: SceneClip consumes eligible Shot media
A SceneClip plan SHALL compose current accepted Shot videos and allowed static/Ken Burns fallback media in Shot order. It SHALL reject stale, rejected, wrong-plan, failed-QC, missing-reference, or non-current Shot media. AI Video remains a Shot/SceneClip source and SHALL NOT own Chapter or Project rendering.

#### Scenario: One Shot clip fails quality
- **WHEN** one of four required Shot clips is temporally rejected and fallback is not allowed
- **THEN** the SceneClip SHALL remain blocked without invalidating accepted sibling raw clips
