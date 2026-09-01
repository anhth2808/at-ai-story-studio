# Implementation

AI Story Studio is a local-first modular monolith with three connected layers:

`Story -> TTS -> SRT subtitles -> background -> FFmpeg -> MP4`

`Idea -> blueprint -> arcs/windows -> chapter generation -> StoryState -> review`

`Reviewed chapter -> Scene Engine -> scene metadata/prompts -> explicit media handoff`

The Story and Scene Engines are authoring workflows. Neither automatically
creates narration, images, or video assets; media remains an explicit handoff
after review.

## Implementation guides

- [Setup](setup.md)
- [Architecture](architecture.md)
- [Workflow](workflow.md)
- [Long-story engine](long-story.md)
- [StoryState](story-state.md)
- [Batch generation](batch-generation.md)
- [Continuity](continuity.md)
- [AI usage](ai-usage.md)
- [Filesystem](filesystem.md)
- [Scene Engine](scene-engine.md)
- [Visual style](visual-style.md)
- [Locations](locations.md)
- [Scene prompts](scene-prompts.md)
- [Known limitations](known-limitations.md)

## Scope boundaries

The long-story path supports bounded structured generation, durable SQLite
state, resumable chapter batches, manual chapter analysis, continuity review,
and explicit regeneration. It intentionally stops before character-memory
retrieval systems, scene graphs, image generation, AI video, publishing, and
generic workflow/plugin frameworks.

The media path remains focused on the first working video: project and chapter
creation, narration, subtitles, background media, FFmpeg rendering, and MP4
playback.

## Verification record

The V1 media path has been exercised with Node, pnpm, SQLite, the Edge TTS
provider, FFmpeg, ffprobe, the filesystem workspace, and Chromium. The
long-story path has targeted coverage for schema validation, revisioned
StoryState reduction, bounded context selection, arc/window persistence,
batch retry and recovery, continuity invalidation, usage accounting, and
OMP protocol handling.

The exact local startup procedure is documented in [Setup](setup.md). Current
provider readiness and real-provider smoke results, including known quota or
model-output limitations, are recorded in [Known limitations](known-limitations.md).
