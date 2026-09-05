# Setup

## Prerequisites

- Node.js LTS, currently tested with Node 22.
- pnpm 11.
- Bun 1.3.14 or newer for the isolated OMP host.
- FFmpeg and ffprobe on `PATH`, or `FFMPEG_PATH` and `FFPROBE_PATH`.
- Internet access for Edge TTS synthesis and for the selected OMP provider.
- An authenticated OMP model for Story generation.
- A separately installed ComfyUI server for Scene image generation.

Windows example:

```powershell
$env:PATH = "C:\ffmpeg\bin;$env:PATH"
node --version
pnpm --version
bun --version
ffmpeg -version
ffprobe -version
```

## OMP readiness

Story generation runs through `apps/omp-agent`, not through a Node provider SDK. The host discovers the normal OMP authentication store, creates one in-memory session, disables tools/MCP/LSP/extensions, and exits after one request.

Check the actual host used by Studio:

```powershell
bun apps/omp-agent/src/index.ts --readiness
```

Readiness returns only `ready`, Bun runtime, selected provider/model, and safe guidance. Configure authentication through the normal OMP OAuth/auth-broker flow or provider environment. Never put API keys, OAuth tokens, or credentials in Story settings.

Story settings default to `openai-codex/gpt-5.6-luna`; an explicitly selected authenticated `provider/model` remains supported. `BUN_EXECUTABLE` and `OMP_AGENT_SCRIPT` are optional overrides for the isolated host. The API exposes the same bounded readiness result at `/api/projects/:projectId/story/readiness`.

## ComfyUI readiness

Start ComfyUI on its configured credential-free HTTP(S) endpoint. The tested
local endpoint is `http://127.0.0.1:8188`. In the Scene workspace, open
**Cài đặt tạo ảnh**, configure the exact model filenames, save, then choose
**Kiểm tra kết nối**.

The tested Flux 2 configuration is:

```text
diffusion: flux-2-klein-base-4b-fp8.safetensors
text encoder: qwen_3_4b.safetensors
VAE: full_encoder_small_decoder.safetensors
sampler: euler
workflow: text-to-image-v1
```

Readiness checks the server API, required native nodes, model availability,
sampler, and optional targeted-cancel support. Studio does not install ComfyUI,
download models, accept credentials in the URL, or accept arbitrary workflow
JSON. See [ComfyUI](comfyui.md) for the exact routes and recovery behavior.

## Install, migrate, and verify

```powershell
pnpm install
pnpm approve-builds
pnpm run build
pnpm run typecheck
pnpm test
pnpm lint
```

Approve the `better-sqlite3` and `esbuild` native/postinstall builds when pnpm asks. API and worker startup apply additive migrations automatically. To run migration explicitly:

```powershell
pnpm db:migrate
```

The database uses SQLite foreign keys, WAL mode, a busy timeout, and normal synchronous mode. Do not reset the database to apply the long-story migration.

## Run locally

Use three terminals from the repository root:

```powershell
pnpm --filter @studio/api dev
pnpm --filter @studio/worker start
pnpm --filter @studio/web dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. The API listens on `http://127.0.0.1:3001`.

Optional configuration:

```powershell
$env:STUDIO_WORKSPACE = "D:\studio-workspace"
$env:STUDIO_DB_PATH = "D:\studio-workspace\studio.db"
$env:EDGE_TTS_VOICE = "vi-VN-HoaiMyNeural"
$env:EDGE_TTS_LANGUAGE = "vi-VN"
$env:FFMPEG_PATH = "C:\ffmpeg\bin\ffmpeg.exe"
$env:FFPROBE_PATH = "C:\ffmpeg\bin\ffprobe.exe"
```

`GET /api/health` reports API, SQLite, worker heartbeat, workspace, FFmpeg, and ffprobe independently. The Story dashboard reports OMP readiness separately, so a media-ready installation can still show Story provider setup as unavailable.

## Long-story first run

For a target over 20 chapters, save settings, generate the blueprint, generate and review arcs, generate bounded plan windows, then create a contiguous batch. The batch is resumable and sequential. Generate narration, subtitles, and rendering only from explicit reviewed chapter actions.

## AI video models (Prompt #13)

AI video needs a ComfyUI server (0.33.1 or compatible) with the Wan 2.2
TI2V-5B components in place; Studio never downloads them:

- `ComfyUI/models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors` (9.3 GB)
- `ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` (6.3 GB)
- `ComfyUI/models/vae/wan2.2_vae.safetensors` (1.3 GB)

Source: `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` (Apache 2.0). Verify with
`POST /api/projects/:id/video-settings/readiness`; a missing file reports
`VIDEO_MODEL_MISSING` naming the file. Generation presets: LOW_VRAM
(704x384x81), BALANCED (832x480x81, default), QUALITY (1280x704x121). See
`video-benchmark.md` for measured RTX 3060 12GB timings.

## Production pipeline

Open the project's **Production** workspace to choose a profile and scope,
run read-only preflight and planning, then create a persisted production run.
The API and worker own durable progression; refreshing the browser does not
reset stage state. Start, pause, resume, cancel, and retry commands operate on
the run. Resolve review/configuration interventions before resuming.

The publication stage builds a revisioned package from current assets and
measured chapter audio, then exports it under
`{workspace}/exports/{directoryName}/publication.json`. Export paths are
workspace-relative and validated with ownership and SHA-256 checks. This is a
local package export only; there is no YouTube upload.

When the GPU is reserved by another workload, leave image and AI-motion
provider steps pending and use preflight, planning, existing-output reuse,
package validation, and API/UI checks only. Do not start a production run
until the provider execution window is available.

## Quality pipeline readiness

Shot plans, visual references, candidate critics, temporal keyframe critics,
and TTS anomaly checks are durable worker steps. Automatic critic status is
not human approval: `UNAVAILABLE` pauses or escalates according to the
production profile and never passes a gate. Reuse is fingerprinted by the
current Shot, Asset hashes, package, settings, backend, and evaluator inputs.

For the local LTX path, use the existing ComfyUI server and verify readiness
before generation. The application-owned `LTX2_19B_DISTILLED` adapter selects
the discovered checkpoint, text encoder, and VAE; it does not download models
or modify global ComfyUI workflows.
