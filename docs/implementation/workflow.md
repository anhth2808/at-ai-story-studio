# Workflow

SQLite is the source of truth. A scheduled execution materializes named steps and dependencies. The existing media path remains explicit:

```text
CLEAN_TEXT -> TTS_SEGMENT 0 -> TTS_SEGMENT 1 -> ... -> MERGE_AUDIO
                                      `-> SUBTITLE
MERGE_AUDIO + current background + current subtitle + optional music -> RENDER
```

Each step has a persisted status, fingerprint, progress, attempts, lease owner, lease expiry, and bounded error. The worker claims one eligible step transactionally, creates an attempt, leases it, updates progress, and conditionally completes or fails it. Expired leases are recovered on startup. Failed work retries up to the step limit.

## Story workflow

Small stories retain the existing path:

```text
GENERATE_STORY_BLUEPRINT -> GENERATE_CHAPTER_PLANS -> GENERATE_CHAPTER
```

Long stories use hierarchical planning and sequential V2 generation:

```text
GENERATE_STORY_BLUEPRINT -> GENERATE_STORY_ARCS
GENERATE_STORY_ARCS -> GENERATE_CHAPTER_PLAN_WINDOW
GENERATE_CHAPTER_PLAN_WINDOW -> GENERATE_CHAPTER_V2 1 -> GENERATE_CHAPTER_V2 2 -> ...
```

Arcs cover the target without gaps. Windows are bounded to 10-25 chapters, default 20. A batch materializes only the requested range and uses a required predecessor dependency for each chapter.

When a worker claims a V2 chapter, it compiles deterministic bounded context from the current StoryState, current plan item/window and arc, stable blueprint essentials, relevant dynamic state, prior/recent summaries, threads, facts, events, and gap markers. It updates the running fingerprint before calling the isolated OMP host. Full historical prose is not loaded for normal V2 generation.

Accepted V2 output is schema-validated and reduced before one SQLite finalization transaction writes the chapter revision, summary, StateDelta, StoryState checkpoint, normalized records, lineage, usage, and generation completion. The worker marks the workflow step complete only after finalization returns. A recovered finalized checkpoint is reused idempotently instead of calling OMP again.

## Scene workflow

Scene work uses the same SQLite workflow and one worker; it does not create a
second queue:

```text
GENERATE_SCENES (one chapter-level OMP call -> atomic scene plan)
REGENERATE_SCENE (one selected scene revision)
GENERATE_SCENE_PROMPT (one selected scene prompt revision)
```

Visual consistency uses the same worker and durable execution records:

```text
GENERATE_*_VISUAL_PROFILE -> DRAFT candidate -> explicit approval
BUILD_VISUAL_PROMPT -> CURRENT Visual Prompt Package
REFINE_VISUAL_PROMPT -> optional revision against package fingerprint
```

Profile generation compiles bounded Story, StoryState, location, Scene, and
Style Bible context before calling the isolated OMP host. Valid output is
persisted with provenance before the step completes. Invalid output records a
failed generation and never overwrites an approved profile. Package builds are
deterministic and idempotent for the same Scene revision and dependency
fingerprints. A package or object mapping change stales only the affected
visual package.

The planner receives exact chapter text plus bounded blueprint, selected
characters, summaries, StoryState, current style, and diagnostics. A plan is
accepted only after strict scene schema, contiguous order, UTF-16 range, and
prompt validation. Scene and prompt generations persist provenance and usage
before the worker marks the step complete. Technical failure, cancellation,
lease expiry, and retry use the existing workflow paths.

Scene dependencies are deliberately selective. Chapter text and Story
settings/blueprint stale scene structure and prompts. Visual style, location,
and future canonical character edits stale only dependent prompts. Scene
planning never starts image generation, media upload, narration, subtitle, or
render work.

## Image workflow

Image generation is another persisted step on the same one-worker queue:

```text
CURRENT Visual Prompt Package -> GENERATE_SCENE_IMAGE -> validate -> promote -> SCENE_IMAGE Asset
```

Scheduling resolves a concrete seed and persists the generation revision,
provider prompt UUID, settings/package fingerprints, workflow step, and job.
The worker checks ComfyUI history and queue state before submission, polls for
terminal evidence, downloads only the controlled output node, validates the
file, and commits the Asset under the active lease. Restart recovery therefore
resumes the same provider prompt instead of blindly submitting another one.

Conditioned generation is an explicit opt-in: the request carries an
`ImageGenerationMode` of `TEXT_ONLY` (default) or `REFERENCE_CONDITIONED` with
an explicit CharacterId-to-reference mapping, and `REFERENCE_CONDITIONED` uses
the approved `reference-character-v1` native workflow. See
`reference-conditioning.md`.

Technical retry keeps the logical generation and seed. Same-seed or new-seed
regeneration creates a separate immutable revision. If package or settings
inputs change while ComfyUI runs, a validated result may remain historical but
cannot become current. Manual uploads enter the same revision/current model
without a provider job.

Prompt #11 candidate quality loop: one Scene request may create 1-4 candidates
in one persisted candidate set (max 40 jobs per multi-candidate batch, checked
before writes). Completing candidates never silently replace the Scene's current
image; the user reviews candidates in a grid, saves structured scores/issues/
notes, rejects with feedback, and accepts one candidate - which atomically sets
review ACCEPTED and both current pointers. Feedback regeneration assembles
deterministic guidance from the review and the current Scene/package (no LLM),
creates a new one-candidate set, and stops for review. See `image-quality.md`,
`candidate-generation.md`, and `regeneration-feedback.md`.

Chapter and selected-Scene batches materialize bounded independent one-step
jobs. With one worker, effective ComfyUI generation concurrency remains one.
Image completion never schedules rendering or video generation.

## Batch outcomes

Batch items are independently `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, or `CANCELLED`. Failure pauses later work. Retry resets only the failed item. Skip records a visible gap marker and makes only the immediate successor dependency optional; it is never counted as generated content. Cancel stops future claims and propagates cancellation to the active step.

Changing settings, blueprint, an arc, a plan window, or a chapter invalidates only dependent Story records and media descendants. Historical regeneration and manual edits preserve later chapter content and media, mark later generated narrative lineage `CONTINUITY_STALE`, and require an explicit rebuild, analysis acceptance, or regeneration choice. A completed Story step never enqueues TTS or rendering.

## Manual media flow

1. Create a project.
2. Add and save chapter text, or generate and review Story text.
3. Upload a background image or video.
4. Generate narration explicitly.
5. Generate subtitles explicitly.
6. Render MP4 explicitly.
7. Poll the job until `COMPLETED`; retry a failed job from its job endpoint.

## AI video workflow (Prompt #13)

AI motion is prepared explicitly before rendering: pick Scenes, set their
motion source (AI_VIDEO or HYBRID), optionally edit the AI motion plan, then
generate. Each generation is a durable `GENERATE_AI_SCENE_VIDEO` step
(submit -> poll -> download -> probe -> promote -> review). Accepted raw
clips normalize into SceneClips during the normal scoped render. RenderPlan
reports AI-specific counts (missing motion, clips to normalize, estimated
generation time) and never schedules AI generation implicitly. See
`ai-video.md` and `video-provider.md`.

## Production workflow (Prompt #14)

The production coordinator is a persisted, bounded layer over these existing
steps:

```text
STORY -> CHAPTERS -> AUDIO -> SCENES -> VISUAL_PROFILES -> VISUAL_PROMPTS
  -> SCENE_IMAGES -> AI_MOTION -> TIMELINE -> RENDER -> PUBLICATION_PACKAGE
```

`ProductionOrchestrator` advances one stage at a time, reuses current matching
outputs, schedules only missing bounded units, and pauses for review or
configuration. It persists stage work and interventions, supports pause,
resume, cancel, retry, lease recovery, and scope conflict checks. The
coordinator never calls providers, FFmpeg, ffprobe, or filesystem export code.

The publication stage generates a revisioned metadata/manifest package from
current Asset IDs and hashes, then exports through a safe managed directory.
It does not upload to YouTube or any other external platform.
