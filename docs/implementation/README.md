# V1 implementation

AI Story Studio V1 is a local-first vertical slice:

`Story -> TTS -> SRT subtitles -> background -> FFmpeg -> MP4`

- [Setup](setup.md)
- [Architecture](architecture.md)
- [Workflow](workflow.md)
- [Filesystem](filesystem.md)
- [Known limitations](known-limitations.md)

The implementation intentionally stops before story generation, character memory, scene planning, image generation, and AI video.

## Verification record

The hardened V1 path was exercised with Node 22.22.2, pnpm 11.22.0, SQLite, the real Edge TTS provider, FFmpeg, ffprobe, and the filesystem workspace.

Automated checks:

- `pnpm run typecheck` - passed
- `pnpm run build` - passed
- `pnpm test` - passed, 13 tests
- `pnpm run lint` - passed
- `pnpm run format:check` - passed

The real smoke path created a project and a Vietnamese chapter with three narration segments, uploaded a PNG background, synthesized all Edge TTS segments, merged chapter audio, generated SRT subtitles, rendered MP4, probed the MP4, and played it in Chromium. The output was:

`workspace-e2e-hardening/projects/bc1cceec-8e76-476e-aa9e-f86382476e59/renders/7b63ecd6-15a3-47b3-83cd-bdfa3bbae5e7.mp4`

The MP4 contained H.264 video at 1920x1080 and AAC audio and was reported as 10.705958 seconds by ffprobe. API and worker were stopped and restarted; the project, completed render job, and current rendered asset remained available from SQLite.

The automated retry fixture verifies provider invocation counts: after segments 1 and 2 complete and segment 3 fails, rescheduling invokes the provider only for segment 3 and then merges all three valid segments. Chapter content-change and stale in-flight work fixtures also pass.

The exact local procedure is the three-terminal setup in [Setup](setup.md). The current render implementation intentionally uses the first chapter only; multi-chapter project assembly is a separate milestone. No Story AI, LLM, OMP, or other future-stage capability was implemented.
