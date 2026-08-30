# UI Design

## Interaction model

Desktop-oriented responsive React SPA served by ASP.NET Core. Navigation is project-first. The UI reads persisted status; refreshing/restarting never resets a progress bar optimistically. Destructive/regenerative actions state what becomes invalidated before execution.

## Main navigation

### Project List

- cards/table: title, language/genre, mode, last updated, storage, overall state;
- create project, open, archive, duplicate settings;
- filters: active, completed, failed;
- top-level worker/provider/FFmpeg health indicator.

### Project Editor / Overview

Header: title, mode, current workflow controls (`Run remaining`, `Pause scheduling`, `Cancel running`), cost/provider summary, last saved.

```text
Story       Completed
Chapters    42 / 50    1 failed
Audio       35 / 50    3 running
Subtitle    35 / 50
Video       Ready
Render      Pending (stale previous render available)
```

Each row opens its screen and shows pending/running/completed/failed/invalidated/cancelled counts. A dependency view explains “Render pending because Audio chapters 36–50 are missing,” not just a spinner.

### Story

- creation-mode inputs;
- imported-source status/rights acknowledgement;
- source analysis and transformation brief for adaptation;
- blueprint editor with version/accept controls;
- characters and plot events in simple cards/tables;
- chapter-plan outline;
- generate/analyze/regenerate actions and provider/cost estimate.

Do not expose a graph editor or prompt IDE in V1.

### Chapters

Left list: chapter number/title and text/audio/subtitle status. Main editor:

- view/edit current chapter; unsaved-change protection and revision history;
- current plan, relevant characters/events, generation context inspection;
- regenerate with impact preview;
- save as new revision;
- generate audio, play/download audio;
- subtitle view/download;
- retry failed chapter/TTS chunks;
- error/attempt panel with safe details and “open log” when available.

For 100 chapters use virtualized/paginated list and batch selection; do not load all bodies/audio waveforms.

### Audio

- TTS provider/config/voice and test phrase;
- chapter status grid and batch `Generate missing`;
- current chapter player, segment/chunk list, duration and retry;
- measured total narration duration, cost/usage, disk use;
- background music asset, preview and volume (music may also appear under Video).

### Video

- source type: uploaded loop video, still, slideshow;
- upload/library selector and validated metadata;
- fit/crop/loop, simple pan/zoom, slideshow order/duration;
- resolution/aspect preview frame;
- future scene/image controls absent or disabled with roadmap note, not placeholder actions.

### Render

- summary of timeline inputs and stale blockers;
- resolution, FPS, quality, narration/music volume, subtitle style;
- estimated duration and storage; FFmpeg encoder availability;
- render/cancel/retry;
- real progress/time, diagnostic error, prior render history;
- final player, reveal file/download, ffprobe validation summary.

### Settings

- workspace path/storage and cleanup;
- provider configurations grouped LLM/TTS/ASR/Image/Video/Translation;
- locality/cost badge, secret setup, health/version/capabilities, test button;
- defaults by language/project type;
- FFmpeg path/version/encoders;
- worker concurrency/resource lanes and logs.

## Status language

- **Pending:** ready or waiting on named prerequisites.
- **Running:** progress + attempt + cancel.
- **Completed:** current output.
- **Failed:** concise error + retry/change settings.
- **Invalidated:** stale because named input changed; prior output still available.
- **Cancelled:** stopped intentionally; resume/retry available.

Use color plus icon/text; never color alone. Status aggregation always links to failed/stale units.

## Critical flows

### Create and run

1. New project → Generate or Adapt.
2. Enter inputs/import source and project defaults.
3. Review generated blueprint/plans.
4. `Run remaining`; overview remains usable while jobs execute.
5. Resolve failures at chapter/chunk level.
6. Configure background/render; render and validate MP4.

### Edit chapter after render

1. Save new chapter revision.
2. Confirmation lists: Audio 5, Subtitle 5, Timeline, Final Render will become stale; chapters 6+ remain unchanged.
3. Overview shows prior render as stale but playable.
4. `Rebuild affected` schedules only invalidated descendants.

## V1 update transport

Start with polling lightweight status endpoints every 1–2 seconds while work is active and slower when idle. SignalR is optional after durable state is correct. Persisted state, not push messages, is authoritative.

## Accessibility and long-form usability

Keyboard-accessible controls, visible focus, labels/errors, subtitle contrast preview, chapter autosave draft separated from committed revision, confirmation for paid batches, and no modal that must remain open during jobs.

## Decision: React SPA, no desktop shell initially

- **Alternatives:** Blazor; Electron/Tauri; server-rendered MVC.
- **Why:** React handles editors, virtualized lists, players, and progress dashboards well while ASP.NET serves one local origin.
- **Trade-offs:** TypeScript adds a second language/toolchain; filesystem reveal needs a backend endpoint.
- **Future impact:** the same SPA can be wrapped as a desktop app or hosted remotely if requirements change.
