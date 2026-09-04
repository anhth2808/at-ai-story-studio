## Purpose

Turn raw AI motion assets into normalized SceneClips through explicit duration policies so the existing Chapter/Project renderers consume Ken Burns, AI video, and hybrid clips identically, while expensive raw diffusion output stays reusable across render-only changes.

## ADDED Requirements

### Requirement: Scene motion source modes
Each Scene SHALL have a motion source of `KEN_BURNS` (default), `AI_VIDEO`, or `HYBRID`. A Chapter and Project SHALL support arbitrary mixes of sources. The existing Ken Burns path SHALL remain unchanged and always renderable; `AI_VIDEO` and `HYBRID` SHALL additionally require an accepted current raw AI Motion Asset for the current Scene image, otherwise the Scene reports a named blocker or an explicit Ken Burns fallback applies.

#### Scenario: Mixed chapter
- **WHEN** a Chapter contains KEN_BURNS, AI_VIDEO, and HYBRID Scenes with valid inputs
- **THEN** the existing Chapter renderer SHALL produce one Chapter Video from all three normalized SceneClips without mode-specific logic

#### Scenario: AI unavailable
- **WHEN** a Scene is set to AI_VIDEO but the provider is unready, generation failed, or the clip was rejected
- **THEN** the user SHALL still be able to render the Story with Ken Burns through an explicit fallback, and the default blocking policy SHALL name the missing AI prerequisite rather than silently substituting

### Requirement: Normalized SceneClip contract
Every SceneClip entering Chapter render SHALL be normalized to the project profile regardless of source: exact resolution and FPS, `yuv420p`, H.264, MP4, no audio, and duration fitting the SceneTiming item within the existing probe tolerance. Raw provider output SHALL NOT be used directly as a SceneClip; normalization is a separate persisted step producing its own Asset under the existing SceneClip role and type.

#### Scenario: Renderer is source-agnostic
- **WHEN** the Chapter renderer resolves `scene:{stableId}:video`
- **THEN** it SHALL match the current Asset by fingerprint exactly as today, unaware whether the clip came from Ken Burns or AI normalization

### Requirement: Generation duration is independent from SceneTiming
AI motion generation duration SHALL be bounded by the selected preset (short clip), independent of how long the Scene appears in the final story. The system SHALL NOT attempt to generate diffusion video covering a whole long narration Scene. A raw clip shorter than the Scene duration SHALL be expanded by an explicit duration policy; a raw clip longer than the Scene duration SHALL be trimmed deterministically without altering narration timing.

#### Scenario: Six-second clip in a thirty-seven-second Scene
- **WHEN** a 6-second accepted raw clip serves a 37-second SceneTiming item in HYBRID mode
- **THEN** the normalized SceneClip SHALL be exactly the Scene duration with the AI motion placed first and a deterministic continuation covering the remainder

### Requirement: AI_THEN_KEN_BURNS duration policy
`HYBRID` SHALL implement `AI_THEN_KEN_BURNS`: the accepted AI clip plays from Scene start, then a short crossfade transitions to the accepted Scene image continued with subtle Ken Burns motion until the exact Scene duration. `AI_VIDEO` mode with a clip shorter than the Scene SHALL apply the same policy by default. `LOOP_AI` and `TIME_STRETCH` SHALL NOT be defaults. The continuation SHALL use the original accepted image (not a drifted AI final frame) unless a real visual test justifies otherwise.

#### Scenario: Hybrid long scene
- **WHEN** a HYBRID Scene of 20 or more seconds has a 5-second accepted clip
- **THEN** the composed SceneClip SHALL contain no black gap, a bounded crossfade, exact target duration and FPS, and playable normalized output

### Requirement: Source-aware SceneClip fingerprints
The normalized AI SceneClip fingerprint SHALL cover the raw clip's generation fingerprint, SceneTiming data, target resolution/FPS/quality, normalization policy and parameters, and a compiler version - parallel to the Ken Burns fingerprint covering image/motion/fitting inputs. Chapter and Project fingerprints SHALL remain exactly the #12 behavior over ordered SceneClip fingerprints.

#### Scenario: Timing change does not respawn diffusion
- **WHEN** only a SceneTiming item's duration changes for an AI Scene
- **THEN** the raw AI Motion Asset SHALL remain current and reusable and only the normalized SceneClip, Chapter, and Project SHALL rebuild

### Requirement: Expense-aware scoped invalidation and raw reuse
Changing the accepted Scene image or the AiMotionPlan SHALL mark dependent raw AI motion stale (retained as history) and invalidate the normalized SceneClip, its Chapter Video, and dependent Project Videos only. Timing-only, subtitle, narration-side, music, and final quality/resolution changes SHALL NOT invalidate raw AI Motion Assets; they SHALL rebuild only normalized clips and downstream outputs as the existing hierarchy requires. Unrelated Scenes and Chapters SHALL remain valid in all cases.

#### Scenario: Source image swap
- **WHEN** the current accepted Scene image changes while an AI generation is running or after it completed
- **THEN** the old raw output MAY remain as reviewable history but SHALL NOT be current for the new image state, and only that Scene's clip/Chapter/Project chain SHALL rebuild

#### Scenario: Quality preset change
- **WHEN** only the project quality preset or final resolution changes
- **THEN** raw AI clips SHALL be reused and normalization SHALL rebuild from them without any provider call

### Requirement: Stale in-flight result protection
A generation completing after its inputs changed (lost step lease, replaced source image, changed motion plan, superseded revision) SHALL be recorded as history but SHALL never become the current raw Asset. The existing lease-guard and staleness-check patterns SHALL be reused.

#### Scenario: Completion races an image change
- **WHEN** generation started against image v1 completes after the current image became v2
- **THEN** the v1-based result SHALL be persisted as non-current history tied to its source image hash and SHALL NOT be selectable as current for v2
