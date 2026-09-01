## Context

See `proposal.md` for motivation. The repository is a TypeScript modular monolith with one Fastify API, one React/Vite web app, one SQLite-backed worker, revisioned Scenes and Visual Prompt Packages, an existing managed Asset table/stream route, and workflow steps with attempts, leases, cancellation, retry, and stale-worker guards. `VisualPromptPackage.payload.fullPrompt`, `negativePrompt`, reference asset IDs, dependency revisions, and `inputFingerprint` are already persisted. Current image lists and storage do not exist.

The current worker executes one workflow step at a time, so it already provides the required initial GPU concurrency of one. `packages/media` already supplies managed workspace paths, staging promotion, SHA-256 streaming, ffprobe image validation, path containment, and file streaming. The shortest safe implementation extends those paths rather than adding an image package, queue, semaphore, image library, or provider registry.

Current ComfyUI behavior was verified against official documentation, current source, and the running local server:

- Official routes document `POST /prompt`, `GET /queue`, `GET /history/{prompt_id}`, `GET /view`, `GET /system_stats`, `GET /models/{folder}`, and `GET /object_info/{node_class}`. `POST /prompt` validates API-format graph data and returns `prompt_id` plus queue number or a 400 error with `node_errors`.
- Official WebSocket messages include `execution_start`, `progress`, `execution_success`, `execution_error`, and `executing` with `node: null` at completion. The official example waits by WebSocket, then reads `/history/{prompt_id}` and downloads `/view` outputs.
- Current `Comfy-Org/ComfyUI` source accepts an application-supplied canonical UUID as `prompt_id`, exposes targeted `/api/jobs/{job_id}/cancel`, and retains legacy queue delete and interrupt routes.
- The running server is ComfyUI `0.33.1` at `http://127.0.0.1:8188` on an RTX 3060. Its live `/api/jobs` and history contain successful Flux 2 Klein image jobs. Available tested components are `flux-2-klein-base-4b-fp8.safetensors`, `qwen_3_4b.safetensors`, and `full_encoder_small_decoder.safetensors`.
- The current Studio database has a current Scene in project `Smoke project`, but no current Visual Prompt Package. Apply verification must build a CURRENT package before the required Studio-owned real generation.

Primary sources:

- https://docs.comfy.org/development/comfyui-server/comms_routes
- https://docs.comfy.org/development/comfyui-server/comms_messages
- https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/server.py

## Goals / Non-Goals

**Goals:**

- Produce and preview real Scene image pixels through one controlled local ComfyUI workflow.
- Preserve exact Visual Prompt Package, seed, settings, workflow, provider job, Asset, revision, and current-selection provenance.
- Resume a known ComfyUI prompt after worker loss and never let stale work replace current output.
- Reuse existing workflow, worker, Asset streaming, media validation, and Scene UI patterns.
- Keep generated/manual images reviewable and selectable without mutating Scene narrative data.

**Non-Goals:**

- No arbitrary workflow JSON API, graph editor, plugin marketplace, second queue, new provider registry, image BLOB/base64 storage, or automatic model download.
- No reference conditioning, custom nodes, LoRA, ControlNet, identity model, vision scoring, auto-selection, AI video, or render-timeline integration.
- No claim of pixel-perfect recurring identity. Prompt #8 supplies text-level consistency only.

## Decisions

### 1. Keep the image boundary inside the existing workflow package

Add narrow image contracts and implementation modules under `packages/workflow/src` because this package already owns TTS provider execution, worker dispatch, orchestration, fingerprints, and Asset promotion. Do not create a new workspace package for one provider.

The provider-neutral shape is conceptually:

```ts
type ImageGenerationRequest = {
  projectId: string;
  sceneId: string;
  visualPromptPackageId: string;
  prompt: string;
  negativePrompt: string | null;
  width: number;
  height: number;
  seed: number;
  steps: number;
  guidance: number;
  samplerHint: string;
  referenceImages: Array<{ assetId: string; path: string }>;
  providerSettings: ImageProviderSettings;
  providerJobId: string;
};

type ImageGenerationResult = {
  provider: 'COMFYUI';
  providerJobId: string;
  seed: number;
  width: number;
  height: number;
  durationMs: number;
  images: Array<{ stagingPath: string; mediaType: string; width: number; height: number }>;
  metadata: Record<string, unknown>;
  warnings: string[];
};

interface ImageProvider {
  generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>;
  readiness(settings: ImageProviderSettings, signal?: AbortSignal): Promise<ImageProviderReadiness>;
  cancel(providerJobId: string, settings: ImageProviderSettings): Promise<'CANCELLED' | 'UNSUPPORTED' | 'NOT_FOUND'>;
}
```

The service creates the complete request. `ComfyUiImageProvider` never receives repositories and cannot load Story, Scene, blueprint, profiles, locations, or StoryState. Reference assets are resolved to project-owned managed paths by the service, but `text-to-image-v1` returns `REFERENCE_IMAGES_UNUSED` and does not upload or map them.

### 2. Use canonical package prompt text for the first workflow

The initial request uses `VisualPromptPackage.payload.fullPrompt` and `negativePrompt`, exactly as Prompt #9 specifies. Optional OMP `refinedPrompt` remains inspectable but is not silently substituted. Bounded regeneration instructions are appended to the provider request only and become part of that generation fingerprint; they do not create or edit a canonical profile/package revision.

### 3. Store one controlled Flux 2 API-format template as TypeScript data

Add one source-controlled `text-to-image-v1` template and mapping module under `packages/workflow/src/comfyui`. Store the graph as a typed object constant rather than runtime JSON so the existing TypeScript build needs no JSON-copy step or new loader. This still commits the exact approved workflow and centralizes all node IDs.

The initial zero-custom-node graph uses:

| Node | Class | Mapped input |
|---|---|---|
| `1` | `UNETLoader` | configured diffusion model |
| `2` | `CLIPLoader` | configured text encoder, type `flux2` |
| `3` | `VAELoader` | configured VAE |
| `4` | `CLIPTextEncode` | positive prompt |
| `5` | `CLIPTextEncode` | negative prompt |
| `6` | `RandomNoise` | seed |
| `7` | `KSamplerSelect` | sampler |
| `8` | `Flux2Scheduler` | steps, width, height |
| `9` | `EmptyFlux2LatentImage` | width, height, batch size 1 |
| `10` | `CFGGuider` | guidance and conditioning links |
| `11` | `SamplerCustomAdvanced` | sampling links |
| `12` | `VAEDecode` | decoded image |
| `13` | `SaveImage` | generated application prefix and output mapping |

The mapping clones the approved object before mutation, validates every expected class/input/link, inserts only validated values, and emits the API-format `prompt` object. Node IDs occur only in this module. The template version and mapping version are both fingerprinted.

Model filenames remain settings for compatible Flux 2 components. The tested defaults above are documentation/setup defaults for this machine, not Style Bible fields or universal hardcoded requirements. A different model family requires a later approved template, not arbitrary graph edits.

### 4. Poll HTTP for the core lifecycle

Use Node 22 built-in `fetch`, `AbortSignal.any`, and timeout signals. Do not add a WebSocket dependency. HTTP polling is simpler, naturally restartable, and still uses current supported behavior:

1. Allocate and persist an application generation UUID and a separate provider prompt UUID before worker execution.
2. On each attempt, query `/history/{prompt_id}` and `/queue` before submission.
3. If the prompt is already queued, running, or completed, resume it.
4. If it is absent, submit the mapped graph to `POST /prompt` with that exact `prompt_id` and a generated client ID.
5. Poll matching history and queue state with bounded interval until terminal success/failure, cancellation, or timeout.
6. On success, read the mapped output node from history and stream each supported output from `/view` into attempt staging.

Polling avoids fake completion on queue acceptance and needs no in-memory subscription after restart. The provider parses only bounded response portions and classifies malformed/incompatible shapes. Routine logs contain IDs and normalized status, not prompts or full graphs.

Use current `/api/jobs/{id}/cancel` only when readiness detects the jobs API shape. Otherwise delete a matching pending prompt through `/queue`; for a running prompt without confirmed targeted cancellation, abort local waiting and report that ComfyUI may continue. Do not call an uncertain global interrupt.

### 5. Readiness validates capabilities, nodes, mappings, and models

`readiness()` performs bounded calls with the connection timeout:

1. Validate an `http:` or `https:` base URL with no embedded credentials.
2. Read `/system_stats` and require the expected object shape.
3. Validate the local approved template in memory.
4. Read `/object_info/{class}` for every mapped class and confirm required mapped inputs.
5. Read `/models/diffusion_models`, `/models/text_encoders`, and `/models/vae`; confirm configured component filenames.
6. Read the sampler choices from `KSamplerSelect` object info.
7. Optionally probe `/api/jobs?limit=1` to record targeted job API support.

Map connection failures to `UNREACHABLE`, absent settings to `NOT_CONFIGURED`, graph/node/input failures to `INVALID_WORKFLOW`, unsupported route/shape to `INCOMPATIBLE_API`, and unexpected safe failures to `ERROR`. Missing models produce an actionable `MODEL_MISSING` diagnostic under a non-ready workflow state. Never claim model availability beyond provider responses.

### 6. Add two small persistence aggregates in migration 0010

Add `image_generation_settings` with one row per project:

- project ID primary/foreign key;
- provider and approved template ID;
- base URL and connection/generation timeouts;
- diffusion model, text encoder, VAE, sampler;
- width, height, steps, guidance;
- seed mode and nullable fixed seed;
- optimistic row version and timestamps.

Updating this row does not rewrite old generations. Each generation stores its settings snapshot/fingerprint.

Add `scene_image_generations` with immutable logical revisions and mutable execution/review/current fields:

- ID, project ID, Scene stable ID, exact Scene revision ID, nullable Visual Prompt Package ID;
- unique revision within `(project_id, scene_stable_id)`;
- source `GENERATED` or `MANUAL` and provider;
- generation status `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, or `CANCELLED`;
- review status `UNREVIEWED`, `ACCEPTED`, or `REJECTED`;
- requested/actual seed, requested/actual dimensions;
- separate provider prompt ID, approved workflow/template version, model/settings snapshot;
- package fingerprint, settings fingerprint, full generation input fingerprint;
- workflow step ID, Asset ID, safe error code/message, regeneration instructions;
- explicit `is_current`, timestamps, and duration.

Use existing workflow attempts for attempt history rather than adding a duplicate image-attempt table. Add indexes for project/Scene history, provider prompt lookup, status, and one filtered current generation per project/Scene stable ID.

Visual freshness is derived, not another mutable status column. A generated image is `CURRENT` only when its exact package is still current, package fingerprint still matches, and stored settings fingerprint equals current project settings. Otherwise it is `STALE`. A manual image does not depend on a package/settings fingerprint and remains fresh while its Asset is valid. This avoids fan-out update hooks in every profile/style invalidation path and keeps generation success immutable.

### 7. Commit output and current selection conditionally

`SceneImageRepository` owns the short transaction that:

1. verifies the workflow step is still RUNNING under the active attempt/lease/fingerprint;
2. verifies the generation row still belongs to that step and provider prompt;
3. verifies the source package is still current and its fingerprint matches;
4. inserts the `SCENE_IMAGE` Asset as `READY`;
5. completes generation metadata;
6. if fresh, clears the old Scene image current generation/Asset role and selects the new rows;
7. if stale, keeps the new valid Asset and generation historical/non-current.

The file is first validated in attempt staging, then promoted under `projects/{projectId}/images/scenes/{sceneStableId}/{generationId}.png`. The approved `SaveImage` workflow emits PNG, so generated output is not re-encoded. Manual uploads additionally allow JPEG and WEBP.

SQLite and filesystem cannot commit atomically. If the guarded DB commit fails, delete the promoted unreferenced destination. If the worker crashes after the DB output commit but before workflow completion, the recovered attempt detects the matching completed generation/Asset and completes without resubmitting ComfyUI.

Explicit Set Current uses one transaction to validate project/Scene ownership plus READY Asset state, clear both current pointers for the logical Scene role `scene:{sceneStableId}:image`, and select the requested generation/Asset. Current is never inferred by timestamp.

### 8. Reuse ffprobe and add only missing image-format checks

Stream `/view` bodies directly to staging through Node streams. Do not call `arrayBuffer()` or retain image bytes in memory. Before publication:

- require a non-empty file;
- inspect magic bytes and allow only PNG, JPEG, or WEBP;
- use existing `FfmpegTools.validateProbe(..., 'image')` to obtain readable dimensions;
- require positive dimensions and a reasonable aspect/dimension match to the mapped request;
- compute SHA-256 with the existing streaming helper;
- select extension/media type from validated content, never provider filename alone.

Add WEBP to `contentTypeFor` and project image directories to `prepareProjectDirectories`. Reuse the existing `/api/assets/:id` streaming/range route for preview.

### 9. Separate technical retry from creative regeneration at scheduling

Scheduling a first generation creates one logical generation row and one workflow step. RANDOM mode resolves a concrete seed with Node crypto before both fingerprints and persistence; use an integer within JavaScript's safe range. FIXED mode validates and uses the saved fixed seed.

The existing generic job retry resets the failed step and reuses the same generation row, provider prompt ID, concrete seed, request, and fingerprint. The provider first checks existing queue/history, so restart/timeout recovery does not immediately duplicate work.

Regenerate creates the next generation revision and a new step. Same Seed copies the prior actual seed. New Seed creates a new concrete seed. Optional instructions are bounded, appended only to provider prompt text, and included in the new fingerprint. Prior generation/Asset rows remain unchanged.

### 10. Batch scheduling materializes ordinary Scene steps

Add service methods for one Scene, selected Scene IDs, one Chapter's missing images, and selected missing-or-stale images. Eligibility is resolved with bounded SQL against current Scenes, CURRENT packages, current generations, and derived freshness. Each eligible Scene creates its own generation row, step, and job under one workflow execution. A unique pending fingerprint check prevents duplicate matching work.

Do not add a batch coordinator table for this milestone. The existing execution plus returned job IDs provide persistence, and one worker gives natural GPU backpressure. A failed Scene does not invalidate completed siblings; technical retry targets its existing job.

### 11. Keep APIs thin and image payloads metadata-only

Add shared strict Zod schemas and thin routes for:

- read/update project image settings and test readiness;
- list/get Scene image metadata/history/current;
- schedule first generation or regeneration with `SAME_SEED`/`NEW_SEED` and optional instructions;
- schedule selected/Chapter missing/missing-or-stale work;
- set review status/notes;
- explicitly set current;
- upload one manual Scene image through multipart;
- request provider-aware cancellation through the existing job cancellation path.

Responses return generation/Asset metadata and `/api/assets/{id}` URLs. They never include provider workflow JSON, full image bytes, base64, secrets, or arbitrary file paths.

### 12. Extend the existing Scenes UI, not a new application shell

Add an Image Generation settings panel and Test Connection action to the existing project/Scenes workspace. Extend selected Scene loading with current image and bounded history. Show Vietnamese readiness, missing/running/failed/freshness/review states, preview, Accept, Reject, Retry, Same Seed, New Seed, Set Current, manual upload, optional notes, and selected/missing/stale batch actions.

Reuse existing persisted job polling and `/api/assets/:id` preview patterns. Do not duplicate Visual Bible or create a DAM screen. Verify the real output visually in Chromium after generation and again after API/worker restart.

### 13. Invalidation remains downstream and selective

Profile/style/Scene changes continue to stale Visual Prompt Packages through current code. Generated freshness then derives stale from the package pointer/status/fingerprint. No existing invalidation path deletes image files or touches StoryState, chapters, TTS, subtitles, backgrounds, or renders.

Changing image settings makes only generated images with an older settings fingerprint visually stale. Manual images remain valid/current until the user selects another image. Prompt #9 does not automatically insert Scene images into final video rendering; that media dependency is a later explicit milestone.

### 14. Verification requires fake-provider contracts and two real revisions

Automated coverage uses deterministic fake HTTP/provider behavior for mapping, node validation failure, submission/terminal failure, missing/corrupt output, stale completion, retry, same/new seed regeneration, manual upload, restart recovery, 20-Scene batch continuation, and no duplicate matching success. Existing Visual Consistency, Scene, Story, workflow, migration, media, TTS, subtitle, and render tests remain regression gates.

Live verification uses the current `Smoke project` Scene after rebuilding a CURRENT package, the running ComfyUI `0.33.1`, and the tested Flux 2 Klein component files. It must persist and preview revision 1, restart API/worker, confirm linkage/current selection, regenerate with a new seed, preserve both Assets, and manually review several resulting images against action, profile text, location, style, framing, and contradictions. Existing ComfyUI history is evidence of provider/model availability only, not completion of the Studio smoke.

## Risks / Trade-offs

- **Flux 2-specific first template:** It produces a real image with the available local model and zero custom nodes, but other model families need another approved template. This is preferable to a fake generic mapper or automatic model download.
- **HTTP polling:** It creates small repeated requests and less granular progress than WebSocket events, but recovery is straightforward and no dependency/session state is added. Add WebSocket progress only if polling is measurably inadequate.
- **Provider history retention:** Recovery depends on the prompt remaining in ComfyUI queue/history. If it is absent, the app can submit the same known prompt ID only when no matching active/history record exists; ambiguous provider state is surfaced rather than hidden.
- **Current ComfyUI API evolution:** Core lifecycle routes are official, while the targeted jobs API is newer current source. Capability-probe it and fall back honestly instead of version-string guessing.
- **Filesystem/SQLite split:** A crash can leave an unreferenced promoted file. Existing reconciliation/cleanup handles this class; guarded current publication prevents a partial or stale file from becoming current.
- **Manual current image versus generated freshness:** Manual selection can remain current after canonical profiles change because it has no deterministic package lineage. The UI shows manual origin rather than claiming it matches current profiles.
- **No reference conditioning:** Reference identifiers are preserved but unused by the first template. Face identity may drift between seeds; this is expected until a later explicitly approved conditioning milestone.
