# Animated Story Timeline

The V1 animated story path renders accepted Scene images with deterministic FFmpeg motion (Ken Burns), and - since Prompt #13 - can additionally render selected Scenes through AI image-to-video. See `ai-video.md`; the timeline, Chapter Video, and Project Video contracts below are unchanged: AI motion produces the same normalized SceneClip Assets.

```text
chapter source text
  -> TTS segments with UTF-16 source ranges and measured durations
  -> SceneTiming revision
  -> provider-neutral MotionPlan revisions
  -> Scene Clips (video only; sources: KEN_BURNS, AI_VIDEO, HYBRID)
  -> Chapter Videos (narration and subtitles)
  -> Project Video (optional project music)
```

## Contracts

`packages/shared/src/timeline.ts` owns the boundary schemas:

- `SceneTiming` and `SceneTimingUpdate` use integer milliseconds and half-open source ranges.
- `MotionPlan` allows only `STATIC`, `ZOOM_IN`, `ZOOM_OUT`, `PAN_LEFT`, `PAN_RIGHT`, `PAN_UP`, `PAN_DOWN`, `PAN_ZOOM`, and `SLOW_PUSH_IN`.
- Motion scale is bounded to `1..1.25`; normalized positions and optional focus points are bounded to `0..1`.
- `RenderScope` supports `SCENE`, `CHAPTER`, `CHAPTER_RANGE`, `SELECTED_CHAPTERS`, and `FULL_STORY`.
- `RenderRequest` requires explicit `source`: `SCENES` or the legacy `BACKGROUND` path.
- `RenderPlan` reports reusable, required, and blocked Scene and Chapter counts plus final assembly state.

## Timing

`segmentNarrationText()` retains cleaned narration while mapping each segment to the original UTF-16 source offsets. Timing requires completed TTS segments with source mappings and positive measured durations.

`buildSceneTiming()` maps Scene source boundaries to cumulative audio time. Boundaries inside a TTS segment use deterministic proportional interpolation. Gaps close at the midpoint between adjacent mapped boundaries. Minimum Scene duration is applied by redistributing internal boundaries without changing Scene source ranges. AUTO timing is reproducible. A valid MANUAL revision must cover the complete audio duration, preserve Scene order, and is revision-checked before persistence.

A current MANUAL timing revision is not replaced by an automatic rebuild while its audio Asset remains current. If the audio Asset changes, an explicit manual replacement is required.

## Motion and fitting

`createDefaultMotionPlan()` selects a bounded motion from Scene purpose, camera, composition, movement intent, Scene number, and configured intensity. The result contains no FFmpeg expression or provider data.

`buildCropPlan()` handles `COVER` and `CONTAIN` for 16:9 and 9:16 output. COVER proportionally scales and crops. CONTAIN preserves the full image and fills the unused canvas intentionally. The compiler clamps motion endpoints inside the valid crop bounds.

## Media boundaries

Scene Clips have two sources. Ken Burns scenes compile through
`buildSceneClipArguments` (looped still, bounded motion). AI_VIDEO/HYBRID
scenes compile through `buildAiSceneClipArguments`
(`ai-clip-render.ts`): the accepted raw AI clip is normalized, and
`AI_THEN_KEN_BURNS` continues to the exact SceneTiming duration with a
crossfade into bounded Ken Burns over the accepted image. Raw AI clips reuse
across timing/subtitle/music/quality changes; the video provider runs only
when source image, motion plan, settings, workflow, or seed change.
`packages/media/src/timeline-render.ts` remains the Chapter/Project compiler:

- Scene Clip: looped still image, bounded motion, H.264, configured FPS, `yuv420p`, no narration requirement.
- Chapter Video: CUT, CROSSFADE, or FADE; narration duration is authoritative; the current Chapter SRT is burned in here.
- Project Video: ordered Chapter Videos are assembled once. Optional music is looped or trimmed and mixed below narration at this stage only.

`FfmpegTools.runWithProgress()` uses separate arguments and `-progress pipe:1`. No shell interpolation is used. Staging files are validated with `validateHierarchicalVideo()` before immutable workspace-relative promotion.

## API

- `GET /api/projects/:projectId/chapters/:chapterId/timeline` returns the current ChapterTimeline, renderable current image URL, source excerpt, MotionPlan, timing, transition, clip status, warnings, and safe blockers.
- `POST /api/projects/:projectId/chapters/:chapterId/timeline/timing` schedules AUTO timing.
- `PATCH /api/projects/:projectId/chapters/:chapterId/timeline` schedules a validated MANUAL timing update.
- `POST` and `PATCH /api/projects/:projectId/chapters/:chapterId/timeline/motion` build or update MotionPlan revisions.
- `GET /api/projects/:id/render/plan` performs a metadata-only dry run for every supported scope.
- `POST /api/projects/:id/render` schedules explicit `SCENES` work or preserves the no-body and `BACKGROUND` legacy behavior.
- Scoped metadata is available at `/api/projects/:projectId/scenes/:sceneId/video`, `/api/projects/:projectId/chapters/:chapterId/video`, and `/api/projects/:projectId/video` with scope query fields.

Timeline responses expose Asset URLs, never absolute filesystem paths. Binary media continues through `/api/assets/:id` with managed path validation and range support.

## Cache and invalidation

Fingerprints use canonical JSON and compiler versions. Scene Clip inputs are the Scene image hash, SceneTiming data, MotionPlan data, fitting and output settings, and fallback policy. Chapter Video inputs are ordered Scene Clip fingerprints, narration hash, subtitle hash, transition and subtitle settings. Project Video inputs are ordered Chapter Video fingerprints, scope, project settings, and optional music hash.

Asset dependency edges propagate invalidation only to descendants:

```text
Scene image or MotionPlan -> Scene Clip -> containing Chapter Video -> selected Project Videos
SceneTiming -> containing Chapter Video -> selected Project Videos
Chapter narration or subtitle -> containing Chapter Video -> selected Project Videos
Project music or project settings -> Project Videos
```

Current production-ready images are preferred. When image approval is enabled, only `ACCEPTED` current images are renderable. `FAIL` blocks missing images. `HOLD_PREVIOUS`, `BLACK`, and `PROJECT_BACKGROUND` are explicit opt-in fallbacks and are recorded in the RenderPlan and output metadata. Rejected or stale candidates are never silently selected.

## Durable jobs

`TimelineWorkflowService` materializes guarded Scene Clip, Chapter Video, and Project Video steps with dependency edges. Each worker execution rechecks current fingerprints and direct dependencies before FFmpeg, after validation, and before promotion. Render jobs persist expected duration, actual progress time, status, diagnostics, and output Asset links.

A failed Scene Clip leaves its Chapter and Project dependencies blocked. Retrying the failed step does not rerun completed sibling Clips. If a worker lease expires after output registration, the next worker verifies the matching current output and completes the step without invoking FFmpeg again. Partial, corrupt, cancelled, or stale outputs never become current.

## Legacy mode

The existing `scheduleRender()` and `buildRenderArguments()` path remains explicit for `BACKGROUND` source and no-body clients. Legacy background rendering does not create Scene fallback data, SceneTiming, MotionPlan, or hierarchical video Assets.

## Production handoff

Prompt #14's production run consumes the current renderable Scene and Chapter
outputs through the existing Timeline service. Timeline invalidation remains
chapter-local: a Scene image, MotionPlan, or SceneTiming change stales only
that Scene Clip, its Chapter Video, and dependent Project Videos. Production
reuses unaffected clips and never asks the timeline to regenerate unrelated
chapters.
