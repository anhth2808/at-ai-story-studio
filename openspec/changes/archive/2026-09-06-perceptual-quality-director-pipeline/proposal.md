## Why

The production pipeline now coordinates durable Story-to-package work, but its current Scene-level visual prompts, text-first identity handling, single-candidate scheduling, and Wan-only motion path leave a material perceptual-quality gap. The locally proven Story-Claw constraints should be transferred into the canonical pipeline now, before more expensive generation is scaled, while preserving current revision, freshness, review, retry, recovery, and publication guarantees.

## What Changes

- Add durable revisioned NarrativeBeat and Shot planning below each current Scene, with stable lineage, bounded source ranges, one visual beat per Shot, turning-point isolation, filler rejection, dialogue carriers, explicit internal-monologue behavior, and separate static `imagePrompt` and dynamic `videoPrompt` contracts.
- Separate Character identity, appearance stages, and transient Shot state. Add canonical multi-view Character prototype references, prototype-derived appearance-stage references, context-aware but conservative wardrobe inference, exact stage identity, and managed approval/freshness lineage.
- Separate canonical hard Location geometry from transient Scene-time state and add approved, character-free canonical Location reference Assets.
- Replace semantic/serialized diffusion-prompt content with a deterministic visual-only compiler. Persist exact ordered reference bindings, preserve location conditioning by Shot size, strip off-screen Characters, forbid fuzzy reference substitution, and preserve binding ordinals through bounded safety rewriting.
- Add structured physical Shot continuity and strict continuation eligibility. Eligible continuation extracts the previous accepted video clip's final frame and persists exact source lineage; invalid cuts generate a new keyframe.
- Make image candidate count follow bounded ProductionProfile policy and Shot importance. Add automatic image critic evaluation, deterministic ranking, explainable selection, bounded guided regeneration, and accepted-keyframe eligibility gates.
- Refactor Wan-specific execution into backend adapters without removing Wan 2.2 TI2V-5B. Add an LTX-2 local ComfyUI adapter derived from the inspected Story-Claw workflow, with honest readiness, backend-owned graph mappings, independent frame geometry, one FPS source, duration conversion, grouped residual distribution, and complete reproducibility metadata.
- Add conservative Motion Director defaults and automatic temporal VLM evaluation with explicit non-boolean QC state, sampled-frame evidence, extra-person and fabricated-face detection, bounded retry guidance, and no infrastructure-error-as-pass behavior.
- Evolve MANUAL_REVIEW, BALANCED, and AUTO ProductionProfile semantics so every mode runs automatic quality validation while human approval/escalation behavior remains policy-controlled and bounded.
- Add bounded future-identity resolution, robust decodable audio-duration measurement, and generic anomalous-silence checks without loading unbounded future text or introducing provider-specific workflow ownership.
- Extend the existing ProductionOrchestrator stage adapters so `SCENES`, `VISUAL_PROFILES`, `VISUAL_PROMPTS`, `SCENE_IMAGES`, and `AI_MOTION` aggregate Shot-level work without adding Product-level stage proliferation or a parallel pipeline.
- Add additive migrations, typed failure codes, deterministic scoped invalidation, focused behavioral tests, real local FLUX/Wan/LTX smoke evidence where prerequisites are available, combined three-Chapter/restart/reuse verification, and a source-specific Story-Claw parity matrix.
- Preserve all Prompt #14 production orchestration and publication-package behavior. No YouTube publishing, model download, arbitrary provider graph input, second workflow queue, or replacement rendering pipeline is introduced.

## Capabilities

### New Capabilities

- `shot-director`: Durable narrative-beat and Shot planning, validation, static/dynamic prompt responsibility, physical continuity, and strict continuation lineage.
- `reference-first-visuals`: Canonical Character prototype, appearance-stage, and Location reference Assets with identity/stage/state separation and exact binding prerequisites.
- `automatic-media-quality`: Automatic image and temporal critics, explainable candidate ranking, explicit QC states, bounded regeneration, and accepted-media gates.
- `video-backends`: Explicit Wan and LTX-2 backend resolution, readiness, frame geometry, workflow compilation, timing conversion, and reproducibility metadata.

### Modified Capabilities

- `scene-engine`: Scenes become parents of durable ordered Shot plans and expose hard/soft environment inputs without moving pixel generation into Scene planning.
- `visual-consistency`: Visual prompt packages become Shot-aware, visual-only, continuity-aware, and deterministically reference-bound.
- `reference-conditioning`: Exact Character stage and Location reference bindings replace implicit Character-only ordering for quality production.
- `image-generation`: Production candidate scheduling becomes profile/importance-aware and consumes persisted Shot prompt packages and exact bindings.
- `image-quality-workflow`: Automatic critic/ranking/regeneration augments the existing manual review taxonomy and current-image ownership.
- `ai-video-generation`: The provider boundary gains backend-neutral settings, LTX-2 support, continuation frame lineage, backend-specific metadata, and temporal QC prerequisites while preserving Wan.
- `scene-timing-and-motion`: Shot clips and backend-legal grouped frame allocation integrate with existing SceneTiming, SceneClip, ChapterVideo, and ProjectVideo ownership.
- `production-pipeline`: Existing product stages aggregate Shot/reference/critic work and all profile modes retain automatic quality validation.
- `long-story-continuity`: Bounded future-reveal evidence can resolve an unnamed current Character to one stable canonical identity with provenance.
- `narration-and-subtitles`: Timeline inputs use robust decodable audio duration and bounded generic malformed-synthesis detection.
- `durable-workflow-jobs`: New director, reference-generation, critic, and backend work retains current leases, attempts, cancellation, restart reconciliation, and idempotent scheduling.
- `managed-assets`: Character prototype, appearance-stage, Location reference, continuation-frame, and critic evidence roles remain managed, hashed, immutable media references.

## Impact

Affected areas include shared Zod contracts; additive SQLite migrations and repositories; Scene, visual, image, video, timeline, production, Story identity, and narration workflow services; ComfyUI adapters; worker dispatch/reconciliation; thin API/UI review surfaces where required; `AGENTS.md`; implementation/setup/known-limitations documentation; and real verification evidence.

The existing `ProductionOrchestrator`, canonical Scene/image/video/timeline services, one SQLite-backed workflow queue, managed workspace, current Asset selection, review ownership, publication package, and scoped invalidation engine remain authoritative. Story-Claw files under `references/story-claw` remain read-only and supply audited behavior and known-good workflow topology only; runtime code never depends on their paths.