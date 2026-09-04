# Design: AI Video Scene Clips (Prompt #13)

## Context

Prompt #12 delivered the hierarchy `SceneClip -> ChapterVideo -> ProjectVideo` with fingerprint-based caching, scoped invalidation, and durable one-worker jobs. Video outputs are `assets` rows (types `SCENE_VIDEO_CLIP`/`CHAPTER_VIDEO`/`PROJECT_VIDEO`) keyed by role (`scene:{stableId}:video`); the Chapter renderer seam is `executeChapterVideoRender` resolving that role by fingerprint equality. ComfyUI integration (`packages/workflow/src/comfyui.ts`) builds workflow graphs in TypeScript with fixed node ids, validates them against code specs before every submission, reconciles persisted provider job ids via `/history` + `/queue` (idempotent resubmission), and reports readiness separately from generation. Provider settings are per-project DB rows.

Local environment (verified 2026-09-03):

- GPU: RTX 3060 12GB (Ampere), driver 591.86; system RAM 32GB.
- ComfyUI `0.33.1` running at `http://127.0.0.1:8188`, `D:\AI\ComfyUI_windows_portable`, zero custom nodes.
- Model files already present: `wan2.2_ti2v_5B_fp16.safetensors` (9.3GB, diffusion_models), `wan2.2_vae.safetensors` (1.3GB), `umt5_xxl_fp8_e4m3fn_scaled.safetensors` (6.3GB, text_encoders). Also staged but unused by this change: `ltx-2-19b-distilled-fp8.safetensors` (25.2GB), `gemma_3_12B_it_fp4_mixed.safetensors` (8.8GB), `ltx-video-2b-v0.9.5.safetensors`.
- Live `object_info` confirms native `Wan22ImageToVideoLatent`, `CreateVideo`, `SaveVideo` nodes.

## Goals / Non-Goals

**Goals:**

- One selected local I2V technique producing real clips on this 3060 with zero new dependencies.
- AI motion as a new SceneClip source below the existing hierarchy; Chapter/Project renderers unchanged.
- Raw AI output as an immutable, reusable, reviewable Asset distinct from normalized SceneClips.
- Expense discipline: short bounded clips, HYBRID expansion, raw reuse across render-only changes, concurrency 1, no implicit bulk generation.

**Non-Goals:** text-to-video, lip sync, audio from providers, video interpolation/upscale subsystems, automatic vision-scored regeneration loops, multi-model support, cloud providers, a second queue or a second timeline.

## Research and Selection

Candidates evaluated for RTX 3060 12GB, ComfyUI-native, I2V (research 2026-09-03; sources: docs.comfy.org Wan 2.2 tutorial + official template JSON, willitrunai.com Wan VRAM tiers, localaimaster.com Aug-2026 stack review, community RTX-3060 reports):

| Candidate | I2V | ComfyUI | VRAM @ practical res | 12GB usable | Notes |
|---|---|---|---|---|---|
| **Wan 2.2 TI2V-5B fp16** | native (`Wan22ImageToVideoLatent`) | native nodes only, official template | ~8-10GB peak w/ native offloading (official docs: "fits well on 8GB") | **YES, comfortable** | Apache 2.0; high-compression VAE keeps latents small; already installed locally |
| Wan 2.2 I2V-A14B (GGUF Q4/Q5 + T5 CPU offload) | yes | needs ComfyUI-GGUF custom node + 2 GGUF files (not installed) | ~6-8GB @480p but heavy offload; slow | marginal | Best quality tier; deferred: custom-node fragility + slow on 3060 + 20GB extra downloads |
| LTX-2 / LTX-2.3 distilled | yes | native or GGUF; 19B fp8 ckpt staged locally (25.2GB) | Q3 GGUF floor on 12GB; fp8 ckpt needs heavy offload, slow | marginal | Generates synced audio we must discard; **LTX-2 Community License** (not Apache); deferred |
| LTX-Video 0.9.x 13B distilled | yes | native | ~12GB | borderline | Fastest 12GB option historically; superseded by Wan 5B quality here; rejected: fp16 quality/VRAM tighter than Wan 5B with no local install |
| HunyuanVideo 1.5 (8.3B) | yes | native | official min 14GB w/ offloading | NO | rejected |
| CogVideoX / Mochi 1 | weak I2V / T2V only | wrapper-heavy | 12-24GB | NO / slow | rejected |

**SELECTED_VIDEO_TECHNIQUE = Wan 2.2 TI2V-5B, ComfyUI native `image-to-video-v1` workflow.**
Rationale: only candidate that is simultaneously (1) fully installed locally already, (2) 100% native ComfyUI nodes - matching the repo's no-custom-nodes policy, (3) Apache 2.0, (4) comfortably inside 12GB with official-template settings as the ceiling. Community RTX-3060 reports for Wan-family I2V at 480p-class resolutions corroborate feasibility; the real benchmark in this change is the acceptance gate (`RTX3060_12GB_PRACTICAL` is only claimed after measured local runs).

**DEFERRED_TECHNIQUES:** Wan 2.2 I2V-A14B GGUF (quality upgrade path behind the same provider interface), LTX-2 distilled (already staged; candidate second provider later), SeedVR2 native upscaling for delivery resolution (ComfyUI 0.28+; revisit when normalization upscale quality matters).
**REJECTED_TECHNIQUES:** HunyuanVideo (VRAM), CogVideoX/Mochi (VRAM/speed/I2V), cloud APIs (out of scope).

## Decisions

### D1. Workflow template follows the repo's TS-graph convention (not JSON files)

The prompt sketched `comfyui/workflows/image-to-video-v1.json` + mapping TS. The repo has no JSON template files: both approved image workflows are TS-built graphs validated against code specs. Second convention beside an existing one is prohibited. Decision: new `packages/workflow/src/comfyui-video.ts` with `buildComfyUiVideoPrompt(request)` producing the official `video_wan2_2_5B_ti2v` graph (node ids fixed: `37 UNETLoader`, `38 CLIPLoader`, `39 VAELoader`, `48 ModelSamplingSD3(shift 8)`, `6/7 CLIPTextEncode pos/neg`, `56 LoadImage`, `55 Wan22ImageToVideoLatent(width,height,length,batch)`, `3 KSampler(seed,steps,cfg,uni_pc,simple,1)`, `8 VAEDecode`, `57 CreateVideo(fps)`, `58 SaveVideo`), `videoGraphSpec()` validation, mapping version `image-to-video-v1-mapping-1` baked into fingerprints. The Wan standard Chinese negative prompt ships as the template default. Alternative rejected: on-disk JSON duplicates the validation/spec machinery for no benefit.

### D2. Provider boundary mirrors `ImageProvider`, not a generic framework

`interface VideoGenerationProvider { generate; readiness; cancel }` in `comfyui-video.ts`, one implementation `ComfyUiVideoProvider` reusing the same HTTP surface (`/prompt`, `/history/{id}`, `/queue`, `/view`, `/upload/image` for the source image, `/system_stats`, `/object_info`, `/models/*`). Output collection differs: `SaveVideo` yields `outputs[save].gifs/videos` entries; download whitelists `.mp4/.webm` into `staging/comfyui-video-{providerJobId}/`. Poll interval 2s (video is long); per-request `VideoGenerationRequest/Result` zod schemas in `packages/shared/src/video.ts`. No node ids cross the boundary.

### D3. Separate `video_generation_settings` table, not columns on image settings

Per-project row mirroring `image_generation_settings`: provider, base_url, diffusion_model (`wan2.2_ti2v_5B_fp16.safetensors`), text_encoder (`umt5_xxl_fp8_e4m3fn_scaled.safetensors`), vae (`wan2.2_vae.safetensors`), sampler (`uni_pc`), scheduler (`simple`), steps (20), guidance (5), shift (8), preset (`LOW_VRAM|BALANCED|QUALITY`), connection_timeout_ms (5000), generation_timeout_ms (default 3,600,000; video-appropriate), require_motion_approval (default true). Presets are code constants: LOW_VRAM 640x360x81f, BALANCED 832x480x81f, QUALITY 1280x704x121f (template ceilings; real benchmark may tighten BALANCED default). Rationale: independent row_version/optimistic concurrency, independent readiness; avoids invalidating image settings/fingerprints. Video readiness (`videoReadinessSchema`) reuses ComfyUI reachability + node checks + `/models/{diffusion_models,text_encoders,vae}` membership for the three Wan files.

### D4. Data model: two new revisioned tables + asset type, no changes to existing tables

Migration `0014_ai_video.sql`:

- `ai_motion_plan_revisions`: id, project_id, chapter_id, scene_stable_id, scene_revision_id (CASCADE, mirrors `motion_plan_revisions`), revision, character_action, environment_motion, camera_motion (enum vocabulary), intensity (`SUBTLE|MEDIUM|STRONG`), priority (`NONE|LOW|MEDIUM|HIGH`), motion_prompt (compiled text), negative_prompt, input_fingerprint, status, is_current; UNIQUE(scene_revision_id, revision), partial UNIQUE current per scene.
- `scene_video_generations`: id, project_id, chapter_id, scene_stable_id, scene_revision_id, revision, request snapshot JSON, source_image_asset_id + source_image_sha256, motion_plan_revision_id, provider, workflow_template, mapping_version, model, settings fingerprint, seed, provider_job_id, status (`PENDING|RUNNING|COMPLETED|FAILED|CANCELLED`), review_status (`UNREVIEWED|ACCEPTED|REJECTED`), review issues/notes JSON, error_code/message, generation_duration_ms, asset_id, is_current; partial UNIQUE current per (scene_stable_id, source_image_sha256) so a new accepted image forces a new current lineage while history persists.
- `scenes` motion source: stored in scene payload JSON (`motionSource` field, default `KEN_BURNS`) rather than a new column - Scene revisions already carry a payload the timeline reads. (If scene payload schema is frozen in `scene-revisions`, add a nullable `motion_source` column instead; implementer picks whichever the existing scene revision schema admits without a breaking change.)
- `assets.type` += `AI_SCENE_VIDEO` (enum via checkpoint-compatible ALTER). Raw storage: `projects/{pid}/video/motion/{sceneStableId}/{generationId}.mp4` (new `managedVideoRelativePath` kind). Normalized clips keep `SCENE_VIDEO_CLIP` + role `scene:{stableId}:video`.

### D5. Steps and step keys

- `GENERATE_AI_SCENE_VIDEO`, step key `scene-video:{sceneRevisionId}:{revision}`, jobs mirror type same, request snapshot + provider job id persisted before submission (image-generation pattern). Retry = same snapshot; regenerate = service creates next revision (new seed, optional feedback guidance appended to motion prompt deterministically).
- `NORMALIZE_AI_SCENE_CLIP` reuses the existing `RENDER_SCENE_CLIP` machinery: decision - implement normalization as the AI branch of `executeSceneClipRender` (dispatch by payload `source: 'KEN_BURNS'|'AI_VIDEO'|'HYBRID'`) rather than a new step type. The step's contract (staging render, `validateHierarchicalVideo`, promote, register under `scene:{stableId}:video` with fingerprint) is identical; only the FFmpeg compiler differs. This keeps one SceneClip step type, one render_jobs render_type, one dependency/wait graph - the smallest correct seam. `GENERATE_AI_SCENE_VIDEO` is a new step type; `NORMALIZE_AI_SCENE_CLIP` as a separately named step exists only if implementation finds the dispatch branch unclean - default is the branch.

### D6. Fingerprints

- Raw generation: `aiVideoFingerprint = sha256({mappingVersion, provider, model, settingsFingerprint, sourceImageSha256, motionPlanFingerprint, seed})` - motionPlanFingerprint covers the AiMotionPlan revision input_fingerprint.
- Normalized AI SceneClip: `{compilerVersion:'ai-scene-clip-ffmpeg-v1', sceneId, sceneRevision, timing revision/data, rawGenerationFingerprint, durationPolicy:'AI_THEN_KEN_BURNS', crossfadeMs, profile{width,height,fps,qualityPreset}, fitMode}`. Ken Burns clip fingerprint unchanged (`scene-clip-ffmpeg-v1`). `sceneClipFingerprint()` selects by scene motionSource; KEN_BURNS scenes byte-identical behavior to #12.
- Chapter/Project fingerprints unchanged (they embed clip fingerprints).

### D7. Normalization and HYBRID composition (FFmpeg)

New pure compiler `buildAiSceneClipArguments()` in `packages/media/src/ai-clip-render.ts` (argv only, no I/O - same convention as `timeline-render.ts`):

- Common: input raw clip (probe-validated), target profile; scale+pad/crop to profile (COVER semantics; AI clips generated at 16:9/9:16 preset matching project orientation), `-an`, fps/profile identical to Ken Burns clips.
- `AI_VIDEO`, clip >= duration: `-t sceneDuration` trim.
- `AI_VIDEO`/`HYBRID`, clip < duration (`AI_THEN_KEN_BURNS`): two segments - segment A = raw clip trimmed to `min(clipDur, sceneDur - crossfade)`, segment B = Ken Burns continuation over the accepted scene image for `sceneDur - clipDur + crossfade` (existing bounded-motion crop math, `SLOW_PUSH_IN` default continuation), then `xfade=transition=fade:duration=crossfadeMs` (default 500ms, clamped to <=1s and <= 20% of the shorter segment). Segments rendered to staging then concatenated in one command via filter_complex. No LOOP_AI, no time-stretch, no AI-final-frame extraction (continuation anchors to the accepted image - identity-safe default; revisit only with visual evidence).
- Determinism: same inputs -> same argv; continuation motion parameters derived from scene data like `createDefaultMotionPlan`.

### D8. Motion prompt construction

`packages/workflow/src/ai-motion-plan.ts`: `createDefaultAiMotionPlan(scene, timing)` deterministic from scene metadata (purpose, camera, composition, movement intent - same inputs `createDefaultMotionPlan` uses) mapping camera intent to the bounded vocabulary (`STATIC`, `PUSH_IN`, `PULL_OUT`, `PAN_LEFT`, `PAN_RIGHT`, `ORBIT_SUBTLE`, `HANDHELD_SUBTLE`) and intensity to prompt phrasing; `compileMotionPrompt(plan)` emits 1-3 sentences of motion-only text. Optional OMP refinement goes through the existing OMP agent boundary with a strict JSON contract (like `REFINE_VISUAL_PROMPT`); default path is deterministic-only. Safety vocabulary baked into phrasing ("slowly", "subtle", "gently"; never "rapid", "transform", "morph").

### D9. Invalidation wiring (all via existing primitives)

- Accepted image changes: existing `retireCurrentAsset(scene image role)` -> `invalidateAssetDependents` already kills SceneClip/Chapter/Project. Add: raw AI assets carry `source_image_asset_id`; `SceneVideoRepository` marks scene_video_generations stale (is_current=0 lineage via partial-unique on (scene, source sha)) when the current image's sha differs. No deletion.
- Motion plan change / regenerate accepted: `invalidateCurrentRole('scene:{stableId}:video')` (existing) - clip/chapter/project rebuild; raw stays reusable as history.
- Timing-only change: existing `invalidateChapterVideoAssets` invalidates scene clips + chapter (acceptable: normalized clips embed timing; raw untouched - provider does not run).
- Subtitle/music/quality: existing paths; raw + (for subtitle/music) clips reused by fingerprint.
- Motion source change KEN_BURNS <-> AI/HYBRID: scene payload change -> scene revision bump -> clip fingerprint changes (motionSource is a fingerprint input); no upstream invalidation.

### D10. Batch + concurrency + estimates

Batch = loop of `scene-video:{...}` steps in one execution (image batch pattern, cap 40 jobs). Concurrency stays 1 (single-step worker claim; no semaphore needed). RenderPlan gains `ai: {scenesSelected, missingMotion, clipsToNormalize, estimatedGenerations, estimatedGenerationMs?}` - estimate = missing count x median of last 10 completed real generation durations (persisted on generations; `null` until benchmark data exists, displayed as "chưa có dữ liệu"). `POST /render` never schedules GENERATE_AI_SCENE_VIDEO; scenes missing motion in AI/HYBRID mode surface as blockers or fallback per policy.

### D11. API surface (thin routes, service-owned logic)

- `GET/PUT /api/projects/:id/video-settings`, `POST /api/projects/:id/video-settings/readiness`
- `GET /api/projects/:id/scenes/:sceneId/ai-motion` (current plan + generations list), `PUT .../ai-motion` (plan update, expectedRevision)
- `POST .../scenes/:sceneId/ai-video/generate` (202), `POST .../ai-video/:generationId/regenerate` ({mode SAME_SEED|NEW_SEED, useReviewFeedback}), `PUT .../ai-video/:generationId/review`, `PUT .../ai-video/:generationId/current`, `GET .../ai-video/:generationId` (+asset url)
- `POST /api/projects/:id/ai-video/generate-batch` {sceneIds} and `POST .../chapters/:chapterId/ai-video/generate-missing`
- RenderPlan/timeline DTOs extended (`motionSource`, `aiMotion` status, `sceneClipSource`) in `packages/shared`.
- Jobs retry/cancel reuse `/api/jobs/:id/*` unchanged.

### D12. UI (ScenesWorkspace/TimelinePanel extensions, Vietnamese copy)

Scene card: motion source select (Ken Burns/AI Video/Lai ghép? no - "Kết hợp (Hybrid)"), motion prompt textarea + seed + status, buttons Tạo video AI / Thử lại / Tạo lại, raw clip `<video>` preview + normalized clip preview, review form reusing `quality-review` CSS with video issue tags (15 image tags + video-specific: LỆCH NHÂN DẠNG, MÉO MẶT/THÂN, CHUYỂN ĐỘNG QUÁ MẠNH/YẾU, CAMERA SAI, BIẾN DẠNG VẬT/NỀN, NHÁY, LẶP XẤU, KHÁC). Timeline scene card: source badge + clip `<video>` (wiring the currently-unused `sceneClipAssetUrl`). RenderPlan: AI counts + estimate line. Job polling via existing 2s scoped poller pattern.

### D13. FakeVideoProvider + scale simulation

`FakeVideoProvider` (deterministic: writes a tiny real MP4 via FFmpeg lavfi color source or reuses a checked-in 12-frame fixture produced at test setup, honoring request dims/fps/duration via `-t`) for service/workflow tests. Scale test: 100 chapters x 5 scenes, 70% KEN_BURNS / 20% HYBRID / 10% AI_VIDEO, asserting plan counts, fingerprint fan-out, dependency edges, and zero provider calls for timing-only changes - never 150 real generations.

## Risks / Trade-offs

- [Wan 5B quality/motion below expectations on cinematic scenes] -> SUBTLE default + HYBRID (short AI burst + Ken Burns) tolerates mediocre motion; review gating rejects bad clips; provider interface leaves room for the deferred 14B/LTX-2 upgrade without pipeline changes.
- [3060 generation slower than hoped at BALANCED preset] -> benchmark step explicitly measures s/clip at LOW_VRAM and BALANCED and tightens the default preset; RenderPlan estimate keeps user expectations honest; concurrency 1 + idempotent resume make long batches restart-safe.
- [Video generation exceeds lease heartbeat tolerances] -> provider poll loop is inside one step execution with heartbeats every 5s (same as image path, which already runs ~3min generations); `generation_timeout_ms` bounds runaway jobs; OOM classification prevents identical retry loops.
- [xfade filter requires equal fps/format/resolution inputs] -> both segments rendered at target profile before xfade; compiler validates; real HYBRID test is an acceptance gate.
- [Raw clip storage growth (MP4s are large)] -> bounded presets cap clip length (~3-5s); assets track bytes; reconcileWorkspace reports; documented retention: no deletion yet (consistent with image history policy).
- [`scene payload vs column` for motionSource] -> resolved at implementation start (D4); either is additive and fingerprint-safe.
- [Restart mid-download of a large output] -> staging re-download is idempotent (provider job already terminal in history); partial staging files cleaned on failure (image pattern).

## Migration Plan

Additive SQLite migration `0014_ai_video.sql` (new tables, enum extension via ALTER where the enum is a CHECK/table constraint compatible with existing migration style, `AI_SCENE_VIDEO` asset type in shared zod). No existing table rewritten; rollback = drop new tables/revert code. Workspace gains `video/motion/` directories via `prepareProjectDirectories` (idempotent, reconcile-safe). Existing projects default every Scene to `KEN_BURNS` - behavior byte-identical until a user opts in.

## Open Questions

- Exact BALANCED preset parameters (resolution/frames) - resolved by the Task "real benchmark" before defaults are frozen; specs only require presets exist and the default be locally proven.
- Whether OMP motion-prompt refinement ships in the first pass or stays deterministic-only - decided during implementation by how much value the deterministic prompt shows in the benchmark; the OMP path is optional by spec.
