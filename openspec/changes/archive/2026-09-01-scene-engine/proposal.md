## Why

The completed Story and Long Story Engines produce durable chapter prose and continuity state, but they do not translate a chapter into reviewable visual planning data. Without a bounded scene plan, future image generation would have to infer narrative beats, characters, locations, framing, and style from prose at generation time, making continuity and independent regeneration unreliable. This milestone adds that visual planning layer now while preserving the existing text, TTS, subtitle, and render workflows and keeping pixel generation out of scope.

## What Changes

- Add a durable, revisioned Scene model linked to a project and chapter, with validated narrative purpose, source range offsets, resolved character references, location reference, visual description, camera/composition data, image prompt, optional generic negative prompt, continuity notes, prompt provenance, and separate structure/prompt status.
- Add a dedicated bounded `SceneGenerationContext` compiler that selects chapter content, chapter plan/summary, current arc, relevant StoryState character states, active threads/facts, and project visual style without assembling the entire novel.
- Extend the provider-independent OMP operation boundary with one chapter-level structured scene-planning operation and an independent single-scene regeneration operation. Validate all returned JSON with strict Zod schemas and reject unknown characters, invalid ranges, uncontrolled purposes, and malformed camera data.
- Use one OMP planning call per chapter by default, then persist each validated scene independently. Support configurable LOW/MEDIUM/HIGH density and optional target ranges without forcing an exact count that damages narrative boundaries.
- Add source traceability using UTF-16 JavaScript string offsets into the exact chapter revision used for planning. Validate every range against the source content and invalidate the plan when the chapter revision changes.
- Add scene-character snapshot records that reference known blueprint Character IDs while preserving scene-specific role, emotion, action, pose, clothing, injury, and held-object information without mutating canonical StoryState.
- Add lightweight project Locations with normalized lookup, safe reuse, and explicit draft candidates for genuinely new or ambiguous locations. Add only the minimal recurring visual-object references needed by scenes.
- Add small project-level visual-style settings, revisioned with safe fields for style name/description, medium, realism, palette, cinematic style, aspect ratio, and prompt suffix. Keep provider-specific image configuration out of this change.
- Separate domain `visualDescription` from execution-oriented `imagePrompt`; include camera framing, angle, movement intent, composition layers, lighting, color mood, and generic negative prompts as structured planning data.
- Extend scoped invalidation so chapter edits stale only that chapter's scenes, style/location/character visual changes stale scene prompts without destroying scene structure, and historical scene revisions remain inspectable. Do not mutate canonical character or story state during scene generation.
- Add persisted `GENERATE_SCENES`, `REGENERATE_SCENE`, and prompt-related workflow semantics on the existing workflow/job system. Technical retries reuse the operation; creative regeneration creates a new current scene revision and leaves neighboring scenes unchanged.
- Add scene APIs for generation, paginated listing, detail, editing, one-scene regeneration, locations, and visual-style settings. Keep routes thin and avoid returning full chapter prose or all scenes in project dashboards.
- Add a Vietnamese Scenes workspace and simple chapter scene editor with density/style controls, source excerpts, scene editing, and independent regeneration. Preserve the existing Story workspace, chapter editor, TTS, subtitle, and render actions.
- Add additive Drizzle/SQLite migrations, repositories, indexes, deterministic fake-agent tests for splitting, traceability, references, deduplication, invalidation, regeneration, restart, and 20/100-chapter pagination/batch simulations.
- Run a real OMP scene-generation and one-scene-regeneration smoke path against an existing chapter when the documented Bun runtime, authentication, and model are available; record provider usage as unknown when the SDK does not expose it.
- Explicitly do not add ComfyUI, Stable Diffusion, Flux, image/video APIs, character reference images, animation, timeline/storyboard editors, WhisperX, F5-TTS, publishing, scraping, or a second job system.

## Capabilities

### New Capabilities

- `scene-engine`: Structured chapter-to-scene planning, source traceability, scene characters, locations, visual style, prompts, revision, invalidation, regeneration, APIs, workflow steps, and review UI.

### Modified Capabilities

- `story-creative-state`: Expose scene planning as a visual-planning descendant of chapter revisions while keeping canonical StoryState and CharacterState authoritative and unchanged by scene analysis.
- `story-ai-generation`: Add bounded SceneGenerationContext, strict scene-planning/regeneration contracts, controlled purpose/camera values, prompt provenance, and safe reference validation at the OMP boundary.
- `durable-workflow-jobs`: Persist scene planning and single-scene regeneration through the existing workflow, retry, restart recovery, and dependency/invalidation mechanisms.
- `story-engine-ui`: Add scene review, source excerpts, density controls, visual-style controls, scene editing, and independent regeneration without loading a giant project payload.
- `project-and-chapter-management`: Mark scene plans stale when chapter content changes while preserving chapter text, media, StoryState, and unrelated chapter scenes.
- `omp-integration`: Carry the new structured scene operations through the existing isolated Bun OMP host without importing SDK types into Node feature code.

## Impact

Affected areas are `packages/shared` scene schemas, DTOs, enums, and operation contracts; `packages/database` schema, additive migrations, repositories, and indexes; `packages/workflow` scene context, prompts, validation, persistence orchestration, workflow execution, and tests; `apps/api` thin scene and visual-style routes; `apps/web` Vietnamese Scenes UI; `apps/worker` reuse of the existing durable executor; `apps/omp-agent` operation allowlisting through the existing protocol; and `docs/implementation` architecture, workflow, scene-engine, visual-style, locations, scene-prompts, and known-limitations documentation. Existing databases migrate in place without resets. Existing Story Engine, long-story continuity, TTS, subtitles, and render behavior remain explicit and unchanged. No image-generation provider or image asset job is introduced.