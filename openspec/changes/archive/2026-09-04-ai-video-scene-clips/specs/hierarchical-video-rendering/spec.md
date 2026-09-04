## ADDED Requirements

### Requirement: Source-agnostic SceneClip consumption
Chapter Video and Project Video rendering SHALL consume normalized SceneClip Assets by role and fingerprint exactly as in the existing hierarchy, regardless of whether a clip was produced by Ken Burns FFmpeg motion or AI clip normalization. No AI-specific Chapter or Project renderer, timeline, or assembly path SHALL exist. Narration duration, subtitle burn-in, transitions, and probe validation SHALL behave identically for mixed-source Chapters.

#### Scenario: Mixed-source chapter renders unchanged
- **WHEN** a Chapter Video renders over clips of mixed origin
- **THEN** the existing `buildChapterVideoArguments` path, narration-authoritative duration, subtitle burn-in, and validation tolerances apply with no source-specific branches
