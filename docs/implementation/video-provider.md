# Video provider

`packages/workflow/src/comfyui-video.ts` defines the provider-neutral video
boundary and its single ComfyUI implementation.

## Boundary

```ts
interface VideoGenerationProvider {
  generate(request: VideoGenerationRequest, signal?): Promise<VideoGenerationResult>;
  readiness(settings: VideoProviderSettings, signal?): Promise<VideoReadiness>;
  cancel(providerJobId: string, settings: VideoProviderSettings, signal?): Promise<void>;
}
```

- `VideoGenerationRequest` carries scene identity, the exact source image
  asset id + sha256 + workspace path, motion prompt, negative prompt,
  resolution (multiples of 32), frame count (4k+1 Wan latent geometry), fps,
  seed, and provider settings. No provider node ids cross the boundary.
- `VideoGenerationResult` carries provider, provider job id, seed, dimensions,
  fps, frame count, provider wall time, clip duration, and staged video files.

## ComfyUiVideoProvider behavior

- Submits the TS-built `image-to-video-v1` graph to `POST /prompt` with a
  UUID `prompt_id` minted at schedule time.
- Idempotent resubmission: before submitting, the persisted provider job id
  is reconciled against `GET /history/{id}` and `GET /queue`; completed jobs
  resume at download, queued/running jobs resume polling.
- Polls every 2s until terminal or `generationTimeoutMs`.
- Downloads `SaveVideo` output files via `GET /view` into
  `staging/comfyui-video-{providerJobId}/` (mp4/webm whitelist); staging is
  removed after promotion or failure.
- Classifies out-of-memory failures (`OUT_OF_MEMORY`, non-retryable) from the
  ComfyUI failure record so OOM is never retried with identical settings.
- Cancellation uses targeted `/api/jobs/{id}/cancel` when the server supports
  it, otherwise deletes queued prompts only; a running job cannot be safely
  cancelled remotely and Studio reports that honestly.

## Readiness

`POST /api/projects/:id/video-settings/readiness` reports video readiness
separately from image readiness: `NOT_CONFIGURED`, `COMFYUI_UNAVAILABLE`,
`WORKFLOW_MISSING` (missing native nodes), `VIDEO_MODEL_MISSING` (model files
absent from `/models/*`), `INSUFFICIENT_CONFIGURATION` (sampler/scheduler not
offered), `READY`, `ERROR`.

## Settings

Per-project `video_generation_settings` row (`GET/PUT
/api/projects/:id/video-settings`): provider, base URL, the three Wan model
files, sampler/scheduler, steps/guidance/shift, preset, timeouts, seed mode,
and `requireMotionApproval`. Optimistic concurrency via `expectedRowVersion`.
