# AI Video (Prompt #13)

AI Video adds real generated motion as a **SceneClip source**. It does not own
Chapter or Project rendering: the Prompt #12 hierarchy
`SceneClip -> ChapterVideo -> ProjectVideo` is unchanged, and the Chapter
renderer consumes normalized clips regardless of origin.

```text
Accepted Scene image + AiMotionPlan
  -> VideoGenerationProvider (ComfyUI Wan 2.2 TI2V-5B, image-to-video-v1)
  -> raw AI_SCENE_VIDEO Asset (reviewed: UNREVIEWED / ACCEPTED / REJECTED)
  -> SceneClip normalization (AI_THEN_KEN_BURNS duration policy)
  -> SCENE_VIDEO_CLIP (same role, same fingerprint contract as Ken Burns)
  -> EXISTING ChapterVideo -> ProjectVideo
```

## Scene motion sources

Each Scene has a motion source: `KEN_BURNS` (default), `AI_VIDEO`, or
`HYBRID`. Chapters and Projects mix sources freely. Ken Burns is unchanged and
always available; it is the fallback when the provider is unavailable, the
video models are missing, a generation failed (for example OOM), or a raw clip
was rejected.

- `AI_VIDEO`: the accepted raw clip is normalized; clips shorter than the
  SceneTiming duration continue with the accepted image (Ken Burns) after a
  crossfade; longer clips are trimmed.
- `HYBRID`: same policy - the AI motion plays first, then a bounded crossfade
  returns to the accepted image with subtle Ken Burns continuation. This is
  the practical long-form mode: a 5-second AI burst covers the opening of a
  40-second scene without generating 40 seconds of diffusion video.

## Source image gate

Scheduling reuses the canonical downstream Scene-image gate
(`AssetRepository.currentRenderableSceneImage`), including its freshness
checks. With `requireImageApproval` enabled, only the current `ACCEPTED`
image qualifies as an AI-video source; a `REJECTED` current image never
qualifies, even when approval is disabled. The same gate is re-checked
before execution, so an image rejected mid-generation fails the step as
`STALE_INPUT` instead of publishing. Motion-plan updates validate through
`aiMotionPlanUpdateSchema` and honor `expectedRevision` (`409 CONFLICT` on
mismatch); motion-source updates have no optimistic-concurrency field by
design because that storage keeps no revision counter.

## Raw vs normalized

- Raw provider output is an immutable `AI_SCENE_VIDEO` Asset under
  `projects/{projectId}/video/motion/{sceneStableId}/{generationId}.mp4`,
  validated by ffprobe before publication and never overwritten.
- Normalized clips are regular `SCENE_VIDEO_CLIP` Assets under the existing
  `scene:{stableId}:video` role, fingerprinted with
  `ai-scene-clip-ffmpeg-v1` over the raw generation fingerprint, timing,
  policy, crossfade, and profile. Raw assets survive timing, subtitle, music,
  and quality changes; the provider is not invoked for those.

## Generation duration vs SceneTiming

They are independent numbers. A Scene lasting 37 seconds uses a 3.4-second
BALANCED clip by default; nothing asks the diffusion model to cover narration
length. Audio and narration stay authoritative.

## Review

Raw clips carry `UNREVIEWED` / `ACCEPTED` / `REJECTED`, issue tags
(identity drift, face/body distortion, motion too strong/weak, camera wrong,
morphing, flicker, loop artifacts, other) and notes. With
`requireMotionApproval` (default true) a clip must be accepted before it can
become current or feed a production SceneClip. Review never mutates canonical
Story/Scene/Visual Bible data; regenerate-with-feedback combines the original
motion intent, structured issues, and notes into the next request only.

## API surface

- `GET/PUT /api/projects/:id/video-settings`, `POST .../video-settings/readiness`
- `GET/PUT /api/projects/:id/scenes/:sceneId/ai-motion`
- `PUT /api/projects/:id/scenes/:sceneId/motion-source`
- `POST /api/projects/:id/scenes/:sceneId/ai-video/generate` (202)
- `POST .../ai-video/:generationId/regenerate` (`SAME_SEED` retry-like, `NEW_SEED` creative)
- `PUT .../ai-video/:generationId/review|accept|current`, `GET .../ai-video/:generationId`
- `POST /api/projects/:id/ai-video/generate-batch`, `POST .../chapters/:chapterId/ai-video/generate-missing`
- Jobs flow through the standard `/api/jobs/:id` with retry/cancel.

## Known limitations

See `known-limitations.md` and `video-benchmark.md` for measured generation
times and quality observations on the RTX 3060 12GB target.
