## Why

The studio reliably renders long stories as Ken Burns scene clips (Prompt #12), but every Scene is still a moving still. Local image-to-video is now practical on the installed RTX 3060 12GB: the existing ComfyUI 0.33.1 server already contains the complete, Apache-2.0-licensed Wan 2.2 TI2V-5B model set (diffusion 9.3 GB + VAE 1.3 GB + umt5 encoder 6.3 GB) and exposes the native `Wan22ImageToVideoLatent` node, so selected Scenes can gain real AI motion without new dependencies, custom nodes, or model downloads.

## What Changes

- Add a provider-neutral `VideoGenerationProvider` boundary with a single `ComfyUiVideoProvider` implementation driving one approved native workflow template `image-to-video-v1` (Wan 2.2 TI2V-5B: `UNETLoader`, `CLIPLoader`, `VAELoader`, `ModelSamplingSD3`, `CLIPTextEncode`, `LoadImage`, `Wan22ImageToVideoLatent`, `KSampler`, `VAEDecode`, `CreateVideo`, `SaveVideo`). No arbitrary workflow execution, no custom nodes, no committed model files.
- Add a provider-neutral `VideoGenerationRequest`/`VideoGenerationResult` contract. Requests carry scene identity, source image asset id, motion prompt, resolution, frame count, fps, seed, and settings - never ComfyUI node ids.
- Add `AiMotionPlan` (character action, environment motion, camera intent, intensity `SUBTLE|MEDIUM|STRONG`, bounded camera vocabulary) persisted separately from the image Visual Prompt Package. Motion prompts emphasize movement, not appearance; construction is deterministic with optional OMP structuring.
- Persist raw provider output as a new immutable AI Motion Asset type (`AI_SCENE_VIDEO`) with ffprobe validation, generation fingerprint (source image hash + motion plan fingerprint + provider + workflow template version + model + settings + seed), revision history, review states (`UNREVIEWED|ACCEPTED|REJECTED`), issue tags, and user notes. Raw assets are never overwritten; stale in-flight results cannot become current.
- Add Scene motion source modes `KEN_BURNS|AI_VIDEO|HYBRID`. The existing Ken Burns path is unchanged and remains the first-class fallback when the provider is unavailable, models are missing, generation fails/OOMs, or a clip is rejected.
- Normalize raw AI clips into the existing SceneClip contract via a SceneClip builder stage: shared resolution/fps/pixel-format/codec, audio dropped (narration stays authoritative), duration fit to SceneTiming. AI generation duration is independent from Scene timing; diffusion is never asked to cover a whole narration scene.
- Implement `AI_THEN_KEN_BURNS` as the default duration policy for HYBRID: the accepted AI clip plays first, then a short crossfade returns to the accepted Scene image with subtle Ken Burns continuation for the remainder. `LOOP_AI` and `TIME_STRETCH` are not implemented. Longer-than-scene clips trim deterministically.
- Extend the durable workflow with `GENERATE_AI_SCENE_VIDEO` and `NORMALIZE_AI_SCENE_CLIP` steps (no new queue): provider job persistence, long configurable timeouts, single-flight GPU concurrency (1), retry (technical) vs regenerate (new seed) semantics, restart recovery through the existing persisted ComfyUI prompt-id history/queue reconciliation, and OOM classification that does not blindly retry identical settings.
- Extend video readiness diagnostics separately from image readiness (`READY`, `COMFYUI_UNAVAILABLE`, `WORKFLOW_MISSING`, `VIDEO_MODEL_MISSING`, `DEPENDENCY_MISSING`, `NOT_CONFIGURED`, `ERROR`) plus VRAM-safe presets (`LOW_VRAM`, `BALANCED`, `QUALITY`) validated by a real local benchmark.
- Keep invalidation chapter-local and expense-aware: source image change or motion prompt change marks raw AI motion stale; timing-only, subtitle, music, or final-quality changes reuse raw AI assets and rebuild only normalized clips/chapters/project.
- Extend RenderPlan with AI visibility (missing AI motion assets, AI scene clips to normalize, estimated generation count and recent-average duration), never auto-launching AI generation from full-story render.
- Add batch generation for one Scene, selected Scenes, or Scenes missing AI motion in a Chapter, with explicit user action, priority hints, per-scene failure isolation, and later scenes unaffected by earlier failures.
- Extend the UI: Scene motion source picker, motion prompt/seed/status display, generate/retry/regenerate actions, raw clip and normalized clip previews, review (accept/reject/issue tags/notes), timeline clip-source badges, and render-plan AI counts. Vietnamese UI copy.
- Add `FakeVideoProvider` for deterministic tests, scale simulation (100 chapters x 5 scenes, 70/20/30 mode mix) without GPU runs, and focused tests for request mapping, workflow validation, fingerprints, staleness, reuse, hybrid duration composition, fallback, retry-vs-regenerate, and restart state.
- Real verification gate: actual multi-frame Wan 2.2 5B clips on 3 representative scene images, a real HYBRID long-scene build, a mixed KEN_BURNS + AI_VIDEO + HYBRID Chapter render, a multi-Chapter Project render through the unchanged #12 hierarchical renderer, and scoped-rerender plus timing-change reuse evidence with provider-call proof.
- Update `AGENTS.md` and implementation docs (ai-video, video-provider, comfyui-video, ai-motion-plan, hybrid-scene-clips, video-benchmark, animated-story-timeline, render planning, known-limitations, setup, architecture, workflow) and fix pre-#12 documentation drift.

## Capabilities

### New Capabilities

- `ai-video-generation`: Provider-neutral video generation boundary, approved Wan 2.2 TI2V-5B ComfyUI workflow, request/result contracts, readiness diagnostics, VRAM presets, timeouts, OOM handling, provider job persistence and recovery, raw AI Motion Asset lifecycle (revisions, review, fingerprint), and AiMotionPlan/motion prompt model.
- `ai-scene-clip-composition`: Scene motion source modes, raw-clip-to-SceneClip normalization, duration policies (`AI_THEN_KEN_BURNS` default, deterministic trim), HYBRID composition with crossfade continuation, source-aware SceneClip fingerprints, and expense-aware scoped invalidation with raw-asset reuse.
- `ai-video-workflow-ui`: Scene motion controls, AI generation/review lifecycle surfaces, raw and normalized previews, timeline source badges, render-plan AI visibility, and batch selection flows.

### Modified Capabilities

- `durable-workflow-jobs`: Add AI video generation and normalization steps to the existing graph with long-running provider semantics, restart recovery, retry-vs-regenerate distinction, and GPU single-flight policy.
- `render-planning-and-cache`: Report AI motion and normalization work in RenderPlan, extend SceneClip fingerprints with source-mode-specific inputs, and reuse raw AI assets across timing/subtitle/music/quality-only changes.
- `scene-timing-and-motion`: Store per-Scene AiMotionPlan and motion source mode without coupling AI generation duration to SceneTiming.
- `hierarchical-video-rendering`: Accept normalized SceneClips from any source (Ken Burns, AI video, hybrid) without renderer changes; narration and subtitle behavior stay authoritative and unchanged.
- `animated-story-timeline-ui`: Show clip source per Scene and surface AI motion status alongside existing timing/motion controls.
- `managed-assets`: Add the immutable raw AI Motion Asset type and normalized AI SceneClip lineage under managed project video directories.

## Impact

Affected areas: `packages/shared` (video generation, AiMotionPlan, motion source schemas); additive SQLite migrations (AI motion records, revisions, review, provider jobs, scene motion source fields); `packages/media` (raw clip validation, normalization/hybrid FFmpeg compilers); `packages/workflow` (generation/normalization steps, planning, fingerprints, invalidation, recovery); `apps/api` routes (scene motion, AI generation/review, readiness, render plan); `apps/worker` dispatch; `apps/web` Scene/timeline/render UI; docs and AGENTS.md. The Chapter/Project renderers, timeline, subtitle, narration, and hierarchical caching remain structurally unchanged - AI video only adds a new SceneClip source below that boundary. Ken Burns stays a first-class production mode and universal fallback.
