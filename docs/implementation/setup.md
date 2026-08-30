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
