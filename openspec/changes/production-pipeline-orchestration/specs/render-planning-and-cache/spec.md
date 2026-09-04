## ADDED Requirements

### Requirement: Production planning consumes canonical render readiness
ProductionPlan SHALL consume the existing RenderPlan classifications, fingerprints, dependency blockers, AI normalization state, and scoped invalidation decisions. The production layer SHALL not introduce a second render freshness algorithm or silently change a render fallback policy.

#### Scenario: Plan a partially rendered project
- **WHEN** selected Chapters contain reusable Scene Clips, one stale Chapter Video, and a current unrelated Chapter Video
- **THEN** the ProductionPlan SHALL preserve those canonical reuse/blocker decisions and identify only the affected render and package descendants

### Requirement: Final render readiness is package-consumable
The hierarchical render surface SHALL expose enough bounded readiness information for production package validation to confirm that the current ProjectVideo is valid, fingerprint-compatible, includes the selected scope, and has required narration/subtitles without returning media bytes or raw FFmpeg commands.

#### Scenario: Reject stale final assembly
- **WHEN** a ProjectVideo Asset exists but no longer matches current selected Chapter inputs
- **THEN** the quality/readiness result SHALL be non-ready and SHALL name the stale dependency before package creation
