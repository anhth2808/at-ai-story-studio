# Setup

## Prerequisites

- Node.js LTS, currently tested with Node 22
- pnpm 11
- FFmpeg and ffprobe on `PATH`, or `FFMPEG_PATH` and `FFPROBE_PATH`
- Internet access for Edge TTS synthesis

Windows example:

```powershell
$env:PATH = "C:\ffmpeg\bin;$env:PATH"
node --version
pnpm --version
ffmpeg -version
ffprobe -version
```

## OMP Story Engine

Story generation runs through the isolated Bun host in `apps/omp-agent`. The Node API and worker never import the OMP SDK. Use Bun 1.3.14 or newer and verify the installed OMP CLI:

```powershell
bun --version
omp --version
omp models
```

The host uses OMP's supported local authentication discovery. Configure a provider through the normal OMP environment variables or OAuth/auth-broker flow; do not put API keys or OAuth tokens in Story settings:

```powershell
# OAuth/auth-broker setup, when supported by the provider
omp auth-broker status
omp auth-broker login <provider>

# Refresh and inspect the available model catalog
omp models refresh
omp models
```

Story settings may select a model using `provider/model`, for example `openai-codex/gpt-5.6-luna`. The API and UI expose only safe readiness fields through `/api/projects/:projectId/story/readiness`: Bun runtime, selected model, readiness, and setup guidance. `BUN_EXECUTABLE` and `OMP_AGENT_SCRIPT` are optional overrides for the isolated host.

## Install and build

```powershell
pnpm install
pnpm approve-builds
pnpm run build
pnpm run typecheck
pnpm test
pnpm lint
```

Approve the `better-sqlite3` and `esbuild` native/postinstall builds when pnpm asks. The migration is applied automatically by API and worker startup. To run it explicitly:

```powershell
pnpm db:migrate
```

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

`GET /api/health` reports API, SQLite, worker heartbeat, workspace, FFmpeg, and ffprobe independently.
