## Why

The repository now has durable Story, Scene, Visual Prompt Package, accepted Scene image, TTS, subtitle, and single-background render workflows, but it still cannot turn those reviewed inputs into a narration-synchronized multi-scene story video. The current renderer selects the first chapter and renders one fragile project job, so a changed Scene or late chapter would waste valid work and long stories cannot resume at Scene/Chapter boundaries.

## What Changes

- Add deterministic `SceneTiming` derived from exact Scene source ranges and persisted TTS segment text/durations, including proportional boundary estimates inside a TTS segment, coverage validation, minimum-duration handling, and explicit AUTO/MANUAL timing semantics.
- Add provider-neutral `MotionPlan` records for a small set of subtle still-image motions (`STATIC`, `ZOOM_IN`, `ZOOM_OUT`, `PAN_LEFT`, `PAN_RIGHT`, `PAN_UP`, `PAN_DOWN`, `PAN_ZOOM`, and `SLOW_PUSH_IN`). Generate default plans deterministically from Scene camera/framing/composition metadata without an LLM.
- Add safe aspect-ratio fitting and crop planning for 16:9 and 9:16 with `COVER` and `CONTAIN`; optionally support a blurred contained background. Motion ranges must stay inside valid source crop bounds and must not distort images.
- Add hierarchical rendering: accepted Scene image plus timing and motion becomes a cached Scene Clip; ordered Scene Clips plus chapter narration and burned subtitles becomes a Chapter Video; ordered Chapter Videos plus one optional project-level music mix becomes the final Project Video.
- Extend the centralized FFmpeg abstraction with argument-array compilers, Ken Burns filters, CUT/CROSSFADE/FADE transitions, consistent H.264/AAC output settings, structured progress, staging, cancellation, and ffprobe validation for every level. Keep the existing background renderer available for legacy/background-source projects instead of replacing it unnecessarily.
- Add persisted Scene Clip, Chapter Timeline, and Project Timeline/render metadata and asset types. Store video files under managed project video directories, keep manifests/fingerprints immutable, and preserve prior render revisions rather than overwriting them.
- Add render planning and cache reuse. A dry-run plan reports reusable and required Scene Clips/Chapters, auto-builds missing dependencies only when requested, and never re-renders valid unaffected work. Scene, Chapter, and Project fingerprints include only their direct ordered inputs and settings.
- Extend the existing SQLite workflow graph with timing, motion, Scene Clip, Chapter Video, and Project Video steps/jobs. Reuse the one-worker lease/retry/restart system, persist progress and diagnostics, wait on required dependencies, and allow an individual failed Scene Clip to retry without rerendering completed siblings.
- Make invalidation selective: changing one Scene image or MotionPlan invalidates only that Scene Clip, its Chapter Video, and downstream Project Video; changing one Chapter subtitle/audio/timing invalidates only that Chapter and downstream Project Video; unrelated Scenes and Chapters remain reusable.
- Add render scopes for one Scene, one Chapter, an inclusive Chapter range, selected Chapters, and the full Story. The existing project render surface becomes a multi-chapter path for the new Scene timeline while retaining an explicit legacy background path for compatibility.
- Use accepted/current Scene images only. Missing images fail preflight by default with named prerequisites; no rejected candidate is silently substituted. Explicit fallback policies (`HOLD_PREVIOUS`, `BLACK`, or `PROJECT_BACKGROUND`) are opt-in and visible in the render request/manifest.
- Keep narration authoritative for chapter duration. Burn subtitles at Chapter Video stage to avoid multi-hour SRT shifting, and apply optional project music exactly once with looping, bounded volume, and narration priority. Chapter renders do not mix project music.
- Add Timeline API/UI surfaces with chapter scene thumbnails, start/duration, motion, transition, status, preview/edit actions, manual timing validation, render-plan visibility, hierarchical progress, missing-image states, range/full-story controls, and the existing Vietnamese UI conventions.
- Add additive migrations, focused timing/motion/crop/fingerprint/cache/invalidation/restart/failure tests, 100-chapter planning simulation, regression coverage for Story/Scene/image/TTS/subtitle workflows, browser verification, and mandatory real 3-Chapter multi-scene narrated/subtitled animated MP4 evidence plus scoped re-render evidence.
- Do not implement AI video, image-to-video, lip sync, face animation, 3D parallax, computer-vision motion planning, WhisperX, Remotion, a new queue, a full video editor, or automatic publishing.

## Capabilities

### New Capabilities

- `scene-timing-and-motion`: Narration-to-Scene timing, timeline coverage validation, deterministic MotionPlan generation, safe crop/aspect-ratio planning, and manual timing controls.
- `hierarchical-video-rendering`: Scene Clip, Chapter Video, Project Video, transitions, subtitle burn-in, project music mix, output validation, and compatible hierarchical assembly.
- `render-planning-and-cache`: Render plans, direct-input fingerprints, dependency readiness, scoped invalidation, cache reuse, progress, retry, restart/resume, and failure recovery.
- `animated-story-timeline-ui`: Timeline reads and controls for Scene timing/motion/transition/image status plus Scene/Chapter/range/full-story rendering actions.

### Modified Capabilities

- `background-and-rendering`: Extend the existing FFmpeg render path to consume Scene/Chapter/Project timelines and multi-chapter scopes while preserving explicit legacy background rendering.
- `narration-and-subtitles`: Persist enough TTS source traceability for deterministic source-range-to-audio timing and keep chapter subtitle assets compatible with burned Chapter Videos.
- `durable-workflow-jobs`: Add persisted hierarchical render dependencies, progress, retry, restart recovery, and conservative one-worker media execution without creating another queue.
- `managed-assets`: Add immutable Scene Clip, Chapter Video, Project Video, and timeline-manifest asset roles/types with managed paths and asset dependency lineage.
- `scene-engine`: Expose current Scene source ranges, accepted image readiness, MotionPlan, SceneTiming, and timeline status without mutating narrative Scene structure.
- `image-generation`: Make accepted/current Scene image selection the explicit render input and preserve rejected-candidate/history isolation.
- `project-and-chapter-management`: Support multi-chapter render scopes and chapter-local downstream invalidation without invalidating unrelated chapter media.

## Impact

Affected areas are shared render/timeline schemas and DTOs; additive SQLite migrations and repositories; `packages/media` FFmpeg/ffprobe compilers and validation; `packages/workflow` timing, motion, render planning, hierarchical execution, fingerprints, invalidation, and worker dispatch; thin Fastify timeline/render-plan/render routes; the React Timeline and Render surfaces; implementation/design documentation; and real media verification. Existing Story Engine, Scene Engine, Visual Consistency, accepted image, TTS, subtitle, upload, and legacy background workflows remain explicit and usable. No provider-specific AI video path or second job system is introduced.
