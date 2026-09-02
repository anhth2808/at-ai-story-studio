## Context

See `proposal.md` for motivation and the delta specifications for observable behavior. The repository already has a Node/TypeScript modular monolith, a single SQLite-backed lease worker, managed filesystem Assets, a shell-free `ProcessRunner`, `FfmpegTools`/ffprobe helpers, chapter-scoped TTS and SRT generation, revisioned Scenes with UTF-16 source ranges, accepted/current Scene image revisions, and a background-based project renderer that currently selects the first Chapter.

The current TTS rows store text, measured duration, and hash but not a source-position map. The current renderer has one `RENDER` step, one project render role, and a `buildRenderArguments` helper for one background plus one Chapter's audio/subtitle. `asset_dependencies` exists but hierarchical video dependencies are not yet persisted. The worker claims one step at a time, which is sufficient for conservative FFmpeg concurrency and restart recovery.

Prompt #11 deliberately ends at accepted Scene images. This change consumes that accepted image contract and does not add an AI video provider, an OMP motion call, or a new queue.

## Goals / Non-Goals

**Goals:**

- Build deterministic narration-to-Scene timing from exact Scene ranges and measured TTS segment audio.
- Persist reviewable timing and provider-neutral motion plans without changing narrative Scene records.
- Render and validate reusable Scene Clips, Chapter Videos, and multi-Chapter Project Videos.
- Preserve valid lower-level outputs across retries, restarts, image changes, subtitle changes, and late-Chapter changes.
- Keep FFmpeg argument construction and process safety centralized in `packages/media`.
- Preserve the existing background renderer as an explicit legacy visual-source path.
- Make render scope, prerequisites, cache reuse, progress, and failures visible through thin API and small Timeline UI additions.
- Prove the path with focused tests and real three-Chapter media evidence.

**Non-Goals:**

- No AI video, image-to-video, lip sync, animated faces, 3D parallax, particles, object/face tracking, computer-vision motion planning, or WhisperX.
- No Remotion, MoviePy, browser video composition, distributed queue, worker pool, or speculative provider abstraction.
- No full non-linear editor, arbitrary filter editor, raw FFmpeg expression input, or giant project-level filter graph.
- No automatic Scene restructuring when timing is short or image quality is poor.
- No autonomous image regeneration, candidate selection, Story generation, TTS generation, subtitle generation, or YouTube publishing as a render side effect.

## Decisions

### 1. Keep one explicit hierarchical render workflow

Add three render levels and keep the existing worker as the only execution queue:

```text
CURRENT accepted Scene image + SceneTiming + MotionPlan
                    -> RENDER_SCENE_CLIP -> SCENE_VIDEO_CLIP

Scene Clips + chapter audio + chapter SRT
                    -> RENDER_CHAPTER_VIDEO -> CHAPTER_VIDEO

Chapter Videos + optional project music
                    -> RENDER_PROJECT_VIDEO -> PROJECT_VIDEO
```

`BUILD_SCENE_TIMING` and `BUILD_MOTION_PLAN` are persisted steps when requested. A render request materializes only the selected scope and missing/stale descendants. Scene Clip steps remain independently retryable. The worker still claims one step at a time, so FFmpeg concurrency stays one without a semaphore or second queue.

A Chapter Video is the composition boundary for subtitles. It owns the chapter's narration, burned subtitle, and visual transitions. A Project Video concatenates already-rendered Chapter Videos and mixes project music once. This keeps a multi-hour project out of one filter graph and avoids shifting a multi-hour SRT.

### 2. Extend, do not replace, the current render entry points

Add a validated render request with:

- `source`: `SCENES` or `BACKGROUND`;
- `scope`: one Scene, one Chapter, inclusive Chapter range, explicit Chapter IDs, or full Story;
- `autoBuild`: whether missing/stale timing, motion, Scene Clips, and Chapter Videos may be materialized;
- optional explicit fallback policy: `FAIL`, `HOLD_PREVIOUS`, `BLACK`, or `PROJECT_BACKGROUND`;
- quality/profile overrides only where the existing project render configuration permits them.

The existing `POST /api/projects/:id/render` remains the public project render command. New UI calls it with an explicit Scene source and scope. A request with no new body keeps the legacy `BACKGROUND` behavior for existing clients and projects; it does not silently fall back from a missing Scene image. New timeline endpoints expose Scene and Chapter commands without requiring clients to know workflow step IDs.

`project:render` and the legacy `RENDERED_VIDEO` path remain readable. New Scene timeline outputs use typed asset kinds and scope-specific roles. A Project Video role includes a stable scope key so a Chapter range render does not overwrite a full-Story revision.

### 3. Persist source-positioned TTS segments

Extend `tts_segments` additively with nullable `chapter_revision`, `source_start_offset`, `source_end_offset`, and a bounded `source_text` snapshot. New TTS schedules populate these values from the exact persisted Chapter content and revision. Existing rows with null mapping remain usable by the legacy audio path but are not valid inputs to new SceneTiming until narration is regenerated.

The text preparation path gains one internal operation that carries source spans through cleaning and segmentation. It preserves the current cleaned provider text and hash behavior, while assigning each output segment a half-open source range in the original Chapter string. The span builder is deterministic for line-ending/whitespace cleanup and rejected as incomplete rather than guessing when a transformation cannot be mapped. The stored source snapshot makes the mapping auditable after a later Chapter edit.

For each ordered segment, build a time map:

```text
segment source [sourceStart, sourceEnd)
segment audio  [cumulativeStartMs, cumulativeEndMs)
```

To map a Scene offset:

1. Verify the segment set has the current Chapter revision/content hash, positive measured durations, ordered source spans, and no out-of-bounds span.
2. Use `0` for an offset before the first span and the total measured duration after the last span.
3. Use the segment cumulative edge for an offset on a span edge.
4. For an offset inside a span, use character-ratio interpolation:
   `audioStart + round(duration * (offset - sourceStart) / (sourceEnd - sourceStart))`.
5. For whitespace gaps between spans, use the midpoint of adjacent cumulative audio edges and apply the same result to both neighboring Scene boundaries.
6. Round once to integer milliseconds, then enforce monotonic boundaries.

Scene source ranges remain half-open UTF-16 offsets. The algorithm uses characters rather than word alignment because it is deterministic, available from current persisted data, and does not require WhisperX. The timing manifest records the algorithm version and source/audio fingerprints.

### 4. Use a revisioned Chapter SceneTiming aggregate

Add `scene_timing_revisions` with project/chapter ownership, exact Chapter revision, current Chapter audio Asset ID/hash, timing mode, revision, duration, minimum duration policy, ordered item JSON, warnings, input fingerprint, status/current flag, and timestamps. Item JSON is bounded and contains Scene stable/revision IDs, source range, start/end/duration, raw mapped boundaries, and timing diagnostics. Keep the aggregate chapter-scoped because Timeline reads are chapter-scoped and because one short transaction can validate total coverage.

Automatic timing maps current Scenes in Scene number order, clamps the first start to zero and the last end to measured audio duration, and closes internal gaps at deterministic midpoints. It rejects mapped overlap, negative/zero intervals, stale sources, and gaps that cannot be reconciled. A configured `minimumSceneDurationMs` is a soft floor: boundaries are redistributed from adjacent intervals while preserving total duration; if the number of Scenes makes the floor mathematically impossible, the result remains positive and carries a visible warning instead of changing Scene structure.

Manual edits create a new current timing revision with `MANUAL` mode and an input fingerprint over the exact edited items, Chapter audio Asset, and Chapter revision. Automatic rebuilds see the current manual revision and leave it untouched unless the request explicitly replaces the lock. A manual edit cannot change Scene source ranges, Chapter duration, or Scene order.

### 5. Store MotionPlans per Scene revision

Add `motion_plan_revisions` with project/Scene ownership, Scene revision, timing revision, revision/current flag, controlled motion type, start/end scale, start/end normalized position, easing, optional focus point, intensity, input fingerprint, status, and timestamps. Relational numeric fields are bounded so safe crop validation and selective invalidation do not parse arbitrary provider data. No raw FFmpeg expression is persisted.

Automatic selection is a pure function of Scene number, purpose, camera framing, composition character positions, and project motion intensity. The initial table is intentionally small:

| Scene signal | Default motion | Constraint |
| --- | --- | --- |
| `EXTREME_WIDE`, `WIDE`, establishing purpose | `SLOW_PUSH_IN` or `PAN_ZOOM` | very small scale range |
| `MEDIUM`, `FULL`, dialogue/transition | deterministic pan or `ZOOM_IN` | preserve subject side |
| `CLOSE_UP`, `EXTREME_CLOSE_UP` | `STATIC` or subtle `ZOOM_IN` | never aggressive |
| action/climax or explicit movement intent | controlled pan/zoom rotation | intensity still bounded |
| unknown framing/position | deterministic sequence fallback | center focus |

A stable rotation keyed by Scene number and purpose prevents `zoom in` on every Scene without introducing randomness. If composition says a subject is left/right/center, the generated crop focus follows that side and avoids moving the viewport away from it. No face detection is added. An optional OMP refinement is explicitly deferred; deterministic plans remain the baseline and are sufficient for rendering.

### 6. Compile safe crop and motion filters in `packages/media`

Add provider-neutral media input types and central compiler functions beside the existing `buildRenderArguments`. Workflow code passes validated paths, probed dimensions, duration, target profile, and MotionPlan data; only `packages/media` creates FFmpeg arguments/filter scripts.

For `COVER`:

1. Probe source dimensions before compilation.
2. Compute base scale `max(targetWidth/sourceWidth, targetHeight/sourceHeight)`.
3. Apply bounded animated scale from the MotionPlan.
4. Compute the scaled image dimensions at the motion endpoints.
5. Clamp crop origin to `[0, scaledWidth-targetWidth]` and `[0, scaledHeight-targetHeight]` for every endpoint.
6. Interpolate crop origin and scale over normalized time with a bounded easing function.
7. Emit exact target dimensions, FPS, and `yuv420p` output.

For `CONTAIN`, compute `min(targetWidth/sourceWidth, targetHeight/sourceHeight)`, preserve the complete image, and fill unused space with an intentional configured fill. A blurred enlarged background is an optional additive compiler mode, not a hidden fallback. No input is stretched.

Scene Clips use a looped image input, bounded duration, and a video-only FFmpeg command. The compiler may use `zoompan` or an equivalent generated filter script, but the choice remains internal and is tested through observable arguments/output. `STATIC` still uses the same fitting compiler so output profiles remain identical.

The filter compiler rejects non-finite values, invalid dimensions, negative durations, unsupported easing/motion types, and crop ranges outside the source. `FAST_PREVIEW` maps to a lower internal encode profile and short optional preview duration; `STANDARD` and `HIGH` retain the configured output dimensions and use controlled H.264 presets/CRF values. The domain never stores these expressions.

### 7. Keep transitions at Chapter scope

Scene Clips do not know neighboring Scenes. Chapter composition applies only `CUT`, `CROSSFADE`, and `FADE` with a bounded default duration of 500 ms and a configurable 300-800 ms range.

- `CUT` uses a concat list when all clips are compatible.
- `CROSSFADE` creates a managed Chapter-level filter script with bounded `xfade` offsets.
- `FADE` uses a short fade-to-black/through-black transition at the same visual boundary.

The final Chapter video is padded/trimmed to the authoritative Chapter narration duration after visual transition overlap. Transition overlap never changes the audio stream or subtitle timestamps. The Chapter filter graph can contain all Scenes in that Chapter, but the Project graph never contains all Scenes in all Chapters.

### 8. Burn subtitles in Chapter Videos and mix music once

Chapter Video inputs are current Scene Clips, the current Chapter audio Asset, and the current Chapter subtitle Asset. Subtitle burn-in uses the existing SRT file and bounded style fields for font size, position, and outline. The compiler safely escapes managed filenames and style values; clients cannot supply raw filter text.

The default Chapter output is H.264/AAC MP4 with a normalized audio profile, even when Scene Clips are video-only. Project assembly concatenates compatible Chapter Videos. If project music is enabled, a second final-stage audio mix loops/trims the one project music Asset, applies bounded volume, maps the existing Chapter Video video stream, and encodes only the required audio/video container path. Chapter Video never mixes project music, preventing double application.

The legacy background path continues to use `buildRenderArguments` and its existing current background semantics. It is selected only by explicit `BACKGROUND` source or the compatibility default described above.

### 9. Use typed manifests as timeline persistence

Keep the existing `TIMELINE_MANIFEST` Asset mechanism rather than adding a generic timeline database. Each successful aggregate writes a canonical JSON manifest before media execution:

- Scene Clip manifest: Scene/image/timing/motion/profile/fallback/compiler inputs.
- Chapter Timeline manifest: ordered SceneTimelineItems, transitions, timing revision, Scene Clip hashes, Chapter audio/subtitle hashes, duration, and profile.
- Project Timeline manifest: selected Chapter IDs/numbers, Chapter Video hashes, scope, music hash/settings, and profile.

The manifest is written under the attempt staging directory, hashed, promoted, and registered as a `TIMELINE_MANIFEST` Asset. `render_jobs` is extended with `render_type` and `scope_id` while retaining its existing workflow/timeline/output links and expected/actual duration fields. The render job projection therefore covers `SCENE_CLIP`, `CHAPTER_VIDEO`, and `PROJECT_VIDEO` without creating a second job table.

Video output Assets use:

- `SCENE_VIDEO_CLIP`, role `scene:{stableSceneId}:video`;
- `CHAPTER_VIDEO`, role `chapter:{chapterId}:video`;
- `PROJECT_VIDEO`, role `project:video:{scopeKey}`.

Files live under `projects/{projectId}/video/scenes/{sceneId}/`, `video/chapters/{chapterId}/`, and `video/projects/{scopeKey}/`. Existing `renders/` output remains for legacy renders. Asset dependency rows record Scene image to Scene Clip, Scene Clip/audio/subtitle to Chapter Video, and Chapter Video/music to Project Video lineage.

### 10. Make fingerprints and cache checks hierarchical

Use the existing canonical JSON SHA-256 helper with versioned compiler identifiers. Direct inputs are:

```text
SceneClip = image hash + timing revision/data + motion revision/data
            + fit/aspect + resolution/FPS/quality + compiler version

ChapterVideo = ordered SceneClip fingerprints + narration hash + subtitle hash
               + transition/subtitle/profile settings + compiler version

ProjectVideo = ordered ChapterVideo fingerprints + selected scope
               + project music hash/settings + project profile/compiler version
```

Before scheduling, query a valid current Asset with the exact expected fingerprint and verify its file/probe metadata. A matching Asset is reused by marking the materialized step complete without starting FFmpeg. A pending/running matching step is reused rather than duplicated. Candidate IDs, timestamps, unrelated chapters, and image-generation review metadata do not enter video fingerprints except through the selected image Asset hash.

Input changes call a focused invalidator and also remain detectable through fingerprint mismatch. Scene image or MotionPlan changes stale the Scene role and its containing Chapter/Project descendants. Timing or Chapter audio/subtitle changes stale only the Chapter and Project descendants. Project music/settings changes stale Project outputs only. Legacy background changes invalidate only legacy render descendants. Prior Asset files are retained.

### 11. Materialize render plans and dependency graphs

Add a `RenderPlanner` application service in `packages/workflow` that returns a metadata-only `RenderPlan`. It resolves the requested scope, current Scenes, accepted images, timing, MotionPlans, current audio/subtitle Assets, and compatible Chapter Videos using bounded SQL and pagination. It computes reusable versus required counts without reading media bytes into memory.

For `autoBuild=false`, the API returns the plan and named blockers. For `autoBuild=true`, one SQLite materialization transaction creates only missing/stale timing/motion/Scene Clip/Chapter Video/Project steps and their dependency edges. Valid outputs are represented as completed dependencies. A Chapter step depends on every required Scene Clip. A Project step depends on every selected Chapter Video. A failed dependency leaves dependents pending/blocked and visible; it is never omitted.

Render scopes are normalized and sorted before fingerprinting. A selected Chapter list must belong to the project, contain unique IDs, and be converted to current chapter-number order. Range and full-story plans do not load chapter prose or image bytes.

### 12. Extend the worker with current-input and output guards

`WorkerExecutor` dispatches the new step types to small workflow-owned methods. Each method:

1. Parses a strict step payload.
2. Re-reads current direct inputs and verifies the stored fingerprint, ownership, current pointers, and fallback policy.
3. Writes a canonical manifest to attempt staging.
4. Executes FFmpeg through `FfmpegTools` with `AbortSignal` and structured progress.
5. Probes duration, stream types, codecs, dimensions, FPS/pixel format, and required audio.
6. Hashes and promotes output only after validation.
7. Registers manifest/output Assets and dependency rows behind the current step lease guard.
8. Leaves the workflow step completion to the existing guarded worker transition.

If a process exits after output registration but before step completion, recovery finds the matching output Asset/render job by step and fingerprint and completes idempotently. If an input changes during FFmpeg, the output may remain historical but cannot become current. Partial files remain in attempt staging for bounded diagnostics and are not referenced by SQLite.

Extend `ProcessRunner`/`FfmpegTools` with an optional bounded stdout chunk/progress callback. FFmpeg commands add `-progress pipe:1`; key/value `out_time_ms`, `duration`, `progress`, and `speed` values are parsed structurally and persisted as render-time progress. Human stderr remains bounded diagnostic text. Cancellation and timeout use the existing Windows-safe process-tree termination.

Before a large Project render, use Node filesystem statistics where available for a conservative staging-space check. The estimate is advisory for unknown codec sizes; actual write failures still become safe retryable errors. Successful staging directories are cleaned through existing reconciliation/cleanup rules.

### 13. Extend API and UI without widening the application shell

Add thin routes that call the planner/service:

- chapter timeline read and timing/motion build/update endpoints;
- Scene Clip preview/render endpoint;
- Chapter Video render endpoint;
- project RenderPlan dry-run endpoint;
- project render endpoint accepting scope/source/auto-build;
- scoped current video metadata endpoints where the existing Asset URL is insufficient.

The shared DTOs expose only metadata, Asset IDs/URLs, timing/motion data, fingerprints, statuses, progress, blockers, and safe errors. They never expose absolute paths, provider graphs, full media bytes, or raw FFmpeg filters.

Update the existing web navigation to include `Story`, `Scenes`, `Visual Bible`, `Images`, `Timeline`, `Audio`, and `Render`. Keep background/music upload controls available in the Render area as an explicit legacy/project-music configuration. Timeline is a chapter-scoped responsive list, not a freeform editor: thumbnail/current-image state, source title, start, duration, motion, transition, status, Preview, Edit Motion, and Use Different Image. Render controls select Scene/Chapter/range/selected/full scope, show dry-run reuse counts and blockers, and poll persisted hierarchical progress. All new UI copy is Vietnamese; enums and fingerprints remain machine data.

Manual timing uses native numeric/time controls with a visible AUTO/MANUAL lock and validation messages. Image selection links to the existing accepted/current image APIs and never chooses a rejected candidate. At 375 px, cards stack, action targets remain at least 44 px, and no horizontal timeline canvas is introduced.

### 14. Add one additive migration and preserve old installations

Create the next numbered migration after `0012_image_candidates_quality.sql` and register it in `migrateDatabase`. The migration:

- adds nullable TTS source mapping columns;
- creates `scene_timing_revisions` and `motion_plan_revisions` with current-pointer/status checks and useful project/chapter/Scene indexes;
- extends `render_jobs` with render type/scope and progress-time metadata;
- adds indexes for hierarchical Asset dependencies and render scope lookups;
- leaves all existing Assets, image generations, chapters, workflow rows, and legacy render roles intact.

Existing TTS rows receive null source mappings and are not fabricated. Existing project render configuration receives compatibility defaults (`BACKGROUND` source, existing dimensions/music behavior). New Scene timeline rendering reports that TTS must be regenerated when source mapping is absent. No migration invokes OMP, FFmpeg, TTS, or image generation.

### 15. Verification strategy

Focused automated contracts:

- source-positioned TTS segmentation preserves exact UTF-16 ranges and deterministic hashes;
- timing maps boundaries at segment edges and inside a segment to exact expected integer milliseconds;
- coverage rejects overlap/gaps/out-of-bounds/negative durations and preserves manual locks;
- automatic MotionPlans are stable for identical Scene input, vary without randomness, preserve focus, and stay inside crop bounds for 16:9 and 9:16 COVER/CONTAIN;
- media compilers use argument arrays, safe managed paths, correct codec/profile settings, transitions, subtitle burn-in, music semantics, and no raw client filter expressions;
- Scene Clip/Chapter/Project fingerprints change only when direct inputs change;
- unchanged renders reuse valid Assets and do not invoke the FFmpeg runner;
- changing one Scene invalidates only its clip, Chapter, and Project descendants;
- changing one subtitle/audio invalidates only that Chapter and downstream Project outputs;
- five synthetic Chapters/ten Scenes and a 100-Chapter/500-Scene planning simulation remain bounded and metadata-only;
- restart recovery preserves completed outputs, failed Scene retry resumes the Chapter, and blocked dependencies never render with missing visuals;
- existing Story, Scene, image, TTS, subtitle, legacy background, and workflow tests remain green.

Required real evidence after implementation:

1. Use a real project with at least three Chapters, current narration, accepted Scene images, generated timing, deterministic MotionPlans, and current subtitles.
2. Render one real Chapter and inspect scene changes, motion, narration, subtitles, crop, and playable output.
3. Render three real Chapters into one Project Video and validate all streams with ffprobe.
4. Change one Scene image in Chapter 2, rerender, and record that only its Scene Clip, Chapter 2 Video, and final Project Video rebuilt while Chapters 1 and 3 reused their Assets.
5. Stop/restart the worker between stages and resume from persisted outputs.
6. Watch the resulting MP4 and record duration, performance, storage, transition, subtitle, music, and known-quality observations in implementation docs.

## Risks / Trade-offs

- **TTS cleaning can change source offsets.** Carry source spans through preparation and reject unmappable transforms; do not approximate from an unrelated Chapter revision.
- **Character-ratio timing is not word alignment.** It is deterministic and sufficient for V1; precise alignment remains a later ASR capability.
- **Very many Scenes can make a Chapter filter graph large.** Keep the graph Chapter-scoped, cap Scene count through existing planning bounds, and prefer concat for CUT transitions.
- **Crossfade changes visual output duration.** Pad/trim the final visual stream to narration duration and keep audio/subtitle timing authoritative.
- **FFmpeg builds differ in filter/codec support.** Validate capability at health/render preflight, record tool versions, and fail with safe diagnostics rather than silently substituting encoders.
- **SQLite and filesystem commits are not atomic.** Use attempt staging, hashes, guarded Asset registration, idempotent recovery, and reconciliation as in the current media path.
- **Project music mix may require a final re-encode.** Keep Chapter Videos music-free so the cost is paid once and never duplicates music.
- **Legacy and Scene render modes can confuse users.** Make source and scope explicit in the plan/manifest and show missing accepted images instead of hiding a fallback.
- **Manual timing can become invalid after audio changes.** Keep the timing lock visible, mark it stale when its source audio fingerprint changes, and require explicit user rebuild/unlock.
- **Long projects consume disk through immutable revisions.** Retain reusable outputs by design, clean only successful staging, and document future cleanup rather than deleting valid history automatically.

## Migration Plan

1. Ship shared contracts and pure timing/motion/media compiler types with no new runtime jobs.
2. Apply the additive migration through the existing single startup migration path; verify an existing database and a fresh database both migrate without reset.
3. Add repositories/services and focused tests for source maps, timing, motion, manifests, fingerprints, and invalidation.
4. Extend worker dispatch and API commands; keep old `RENDER`/background behavior available.
5. Add Timeline/Render UI and browser verification at desktop and narrow viewport.
6. Run focused tests, the 100-Chapter plan simulation, and all existing Story/Scene/image/TTS/subtitle/media regressions.
7. Run the mandatory real one-Chapter, three-Chapter, scoped-rerender, and restart evidence, then update implementation documentation and the two useful permanent AGENTS rules.
8. Run final format/typecheck/lint/test/build and the required `/ponytail-review` before any commit.

Rollback is application-level. The additive schema remains in place; the previous application can continue using legacy assets, TTS rows, and `RENDER` background jobs. No new video tables or files are destructively removed during rollback.
