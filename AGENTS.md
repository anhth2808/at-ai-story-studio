# AGENTS.md

# Project

## User rules

- Use "-" instead of "—"
This is already set in the repo's git config, so just commit normally - do not
pass `-c user.name=` / `-c user.email=` overrides.
- Sometime i will write vietnamese. You can answer by vietnamese but do not write any code, docs by vietnamese (except site content)
- Site content (UI copy, Sanity content, SEO metadata) is Vietnamese. Code, comments, and planning artifacts are English.
- Imporant: only use Vietnamese or English. No chinese here.
- ALWAYS use /ponytail-review before comimt anything

This repository contains AI Story Studio.

The long-term direction is:

V1:
Story
→ TTS
→ Subtitle
→ Background Visual
→ Render
→ MP4

V2:
Story
→ Scene Images
→ TTS
→ Animated Visuals
→ MP4

V3:
Story
→ Character Memory
→ Scene Planning
→ Consistent Images
→ Image-to-Video

V4:
Novel
→ Global Story Understanding
→ World/Character Memory
→ Scene Graph
→ Shot Planning
→ AI Video

V5:
Generation
→ Evaluation
→ Regeneration
→ Final Movie

Current priority:

FIRST WORKING VIDEO.

Do not implement future stages prematurely.

# Primary Technology Direction

The main application is TypeScript-first.

Preferred stack:

- Node.js LTS
- TypeScript
- pnpm workspace
- Fastify
- React
- Vite
- SQLite
- Drizzle ORM
- Zod
- Vitest
- FFmpeg
- ffprobe

Python is NOT the primary application backend.

Use Python only when a model or AI library materially benefits from it.

Examples:

- F5-TTS
- WhisperX
- PyTorch
- Transformers
- Diffusers

When Python is required, prefer an isolated sidecar with a clear contract.

Node.js remains responsible for:

- orchestration
- workflow state
- project state
- jobs
- retries
- asset management
- provider selection

Python sidecars remain responsible for model-specific inference.

# Architecture

Prefer a modular monolith.

A reasonable structure is:

apps/
web/
api/
worker/

packages/
domain/
database/
workflow/
providers/
media/
shared/

Do not create packages just to imitate enterprise architecture.

Start simpler when possible.

Create a package only when it represents a meaningful boundary or is shared
by multiple applications.

# V1 Scope

The V1 media path focuses on:

Text
→ TTS
→ Subtitle
→ Background Image/Video
→ FFmpeg
→ MP4

The bounded long-story authoring engine is an explicit current capability:

Idea
→ Blueprint
→ Arcs/plan windows
→ Reviewed chapter generation
→ StoryState

Do NOT implement yet:

- character memory
- world bible
- scene graph
- shot planning
- WhisperX
- F5-TTS
- GPT-SoVITS
- ComfyUI image generation
- AI video
- image-to-video
- YouTube publishing
- generic plugin systems
- generic workflow designers
- Redis
- RabbitMQ
- microservices
- authentication

# Reference Repositories

`/references` contains research material.

Treat reference repositories as READ-ONLY.

Do not modify them.

Do not copy source code without evaluating license compatibility.

Prefer:

- LEARN FROM
- WRAP
- REIMPLEMENT

over copying implementations.

Research documentation exists under `/docs`.

# Workflow

Long-running operations must be persisted.

Workflow progress must survive application restart.

Minimum states:

PENDING
RUNNING
COMPLETED
FAILED
INVALIDATED
CANCELLED

A failed operation should be independently retryable whenever practical.

Do not regenerate successful expensive work unnecessarily.

Example:

TTS Segment 001 COMPLETED
TTS Segment 002 COMPLETED
TTS Segment 003 FAILED
TTS Segment 004 PENDING

Retry Segment 003 rather than regenerating the chapter.

# Dependency Invalidation

Changes invalidate only dependent outputs.

Example:

Chapter Content
→ TTS
→ Subtitle
→ Render

Changing Chapter 5 invalidates:

TTS 5
Subtitle 5
Final Render

It must NOT invalidate unrelated chapters.

Changing only the background should invalidate Render, not narration.

# Manual Override

Manual control is a first-class product feature.

Users must eventually be able to:

- edit chapter text
- replace generated audio
- edit/upload subtitles
- upload background image/video
- upload music
- regenerate individual outputs

Automation should assist the user, not trap the user.

Manual replacement must correctly invalidate dependent outputs.

# Providers

Provider-specific logic must stay behind provider interfaces.

Examples:

TTSProvider
LLMProvider
ASRProvider
ImageProvider
VideoProvider

Workflow code must not contain provider-specific behavior.

Provider preference:

Local / Free
→ Cheap API
→ Premium API

Provider implementations can use:

- native Node libraries
- HTTP APIs
- external processes
- ComfyUI
- isolated Python sidecars

# Image Generation

Image providers must consume the exact current Visual Prompt Package. They must
not reconstruct Story context or mutate canonical visual profiles.

A generated image whose package, settings, fingerprint, or active lease became
stale may remain historical, but it must never replace the current Scene image.

Advanced visual controls must be additive: TEXT_ONLY and the proven
reference-conditioned workflow must remain functional whenever any new control
technique is introduced.

Image quality review must never mutate canonical Story, Scene, or Character
Visual identity data; review feedback may only shape new generation requests.

# Animated Story Timeline

Scene Clip rendering must resolve the current accepted Scene image by explicit
Scene identity and Asset hash. Rejected, stale, historical, or non-current
image candidates must never become render inputs unless an explicit fallback
policy names that historical Asset.

Timeline invalidation is chapter-local. A Scene image, MotionPlan, or SceneTiming
change invalidates that Scene Clip, its containing Chapter Video, and dependent
Project Videos only. Chapter narration or subtitles invalidate only that
Chapter Video and dependent Project Videos; project music or render settings
must not invalidate reusable Scene Clips or unrelated Chapter Videos.


# AI Video

AI Video is a SceneClip source. It must not own Chapter or Project rendering.

Raw expensive AI motion assets must remain reusable when only timing, subtitle,
music, or final render settings change.

Ken Burns remains a first-class fallback.

# TTS

Never assume a provider accepts arbitrarily long text.

Use:

Chapter
→ Text Cleaner
→ Text Segmenter
→ TTS Segments
→ Audio Segments
→ Merge
→ Chapter Audio

Persist segment progress.

Retry failed segments independently.

# Subtitles

V1 should use known narration segments and generated audio durations to create
SRT subtitles.

Do not add WhisperX merely to create basic subtitles.

The subtitle model should allow future:

- word alignment
- karaoke
- styled subtitles

# FFmpeg

Centralize FFmpeg and ffprobe operations.

Never scatter arbitrary FFmpeg commands throughout routes/services.

Provide dedicated media/process abstractions.

External process execution must:

- pass executable arguments separately
- avoid shell interpolation
- capture stdout
- capture stderr
- check exit code
- support timeout
- support AbortSignal
- terminate processes on cancellation
- produce structured errors

Never execute untrusted user input through a shell.

# Database

V1 uses SQLite.

Use Drizzle ORM and migrations.

Media files do NOT belong in SQLite.

Use SQLite for:

- projects
- chapters
- workflows
- jobs
- assets metadata
- provider configuration
- render metadata

Use the filesystem for:

- audio
- images
- video
- subtitles
- temporary media
- rendered output

Configure SQLite appropriately for the local worker model, including WAL mode
where useful.

# Worker

Use a simple database-backed Node.js worker.

SQLite is the source of truth.

Initially assume ONE worker.

Do not introduce Redis/BullMQ/RabbitMQ merely for background processing.

Jobs must support:

- persisted status
- progress
- retry
- cancellation
- restart recovery
- useful error information

# Filesystem

Use a managed workspace.

Example:

workspace/
studio.db

projects/
{projectId}/
chapters/
audio/
subtitles/
backgrounds/
music/
renders/

staging/

Never trust uploaded filenames as internal paths.

Generate internal names.

Prevent path traversal.

Validate media types.

Do not load huge media files fully into memory unnecessarily.

# TypeScript

Use strict TypeScript.

Avoid `any` unless unavoidable and documented.

Prefer explicit domain types.

Validate external/untrusted data at boundaries.

Do not assume TypeScript types validate runtime data.

Use Zod or equivalent runtime validation where appropriate.

Handle null/undefined deliberately.

Avoid unsafe type assertions.

# Backend

Fastify routes should be thin.

Prefer:

Route
→ Application Service
→ Domain/Infrastructure

Do not put workflow/business logic in HTTP handlers.

Use structured logging.

Return meaningful status codes.

Never expose raw internal stack traces to the frontend.

# React

Keep business logic out of large components.

Prefer:

- small components
- typed API clients
- hooks where appropriate
- explicit loading states
- explicit error states
- retry states
- empty states

Do not assume API requests succeed.

Do not mirror backend persistence models directly into UI unless appropriate.

# Error Handling

Never silently swallow errors.

Catch errors when you can:

- recover
- retry
- add useful context
- translate them into application errors

Persist useful workflow/job errors.

Never log:

- API keys
- access tokens
- credentials
- secrets

# Testing

Prioritize tests for behavior that can corrupt or waste expensive work:

- workflow transitions
- dependency invalidation
- job restart/recovery
- text segmentation
- TTS segment retry
- asset hashing
- filesystem path safety
- FFmpeg argument generation

Use Vitest unless there is a concrete reason to use another framework.

Avoid tests that merely test framework behavior.

# Security

Even though V1 is local:

- validate input
- validate uploaded files
- sanitize paths
- prevent path traversal
- avoid shell command interpolation
- keep secrets out of logs
- validate provider responses

# Avoid Over-Engineering

Do NOT introduce without an explicit requirement:

- microservices
- Kubernetes
- event sourcing
- complex CQRS frameworks
- distributed brokers
- generic plugin frameworks
- generic YAML workflow engines
- custom DSLs
- cloud-only infrastructure

Choose simple explicit implementations unless they create an obvious
architectural dead end.

# Current Definition of Done

The first vertical slice is successful when the user can:

1. Start the application.
2. Create a project.
3. Create a chapter.
4. Paste story text.
5. Upload a background image or video.
6. Generate narration.
7. Generate subtitles.
8. Render MP4.
9. Play the MP4.
10. Restart without losing project/workflow state.
11. Retry one failed TTS segment without regenerating completed segments.

Do not expand into advanced AI functionality until this works reliably.

# Decision Rule

When choosing between:

A) a complex future-proof implementation

and

B) a simple implementation satisfying the current milestone

prefer B,

provided it does not create an obvious architectural dead end.

# Final Rule

FIRST WORKING VIDEO

before

ADVANCED AI FEATURES.

# Long-story engine implementation rules

The long-story engine is a bounded authoring workflow layered onto the local
modular monolith. Keep all durable orchestration in Node/TypeScript and keep
provider-specific behavior behind the OMP agent boundary.

- Persist every accepted generated chapter, summary, StoryState revision, state
delta, lineage record, generation metadata, and usage record transactionally
before completing the workflow step.
- Treat StoryState as the compact canonical checkpoint. Use bounded summaries,
selected characters, active threads, important facts, recent events, and
explicit omission diagnostics instead of assembling the full novel into every
prompt.
- For targets over 20 chapters, require arcs and bounded plan windows. Do not
restore a full-project plan as a shortcut.
- Changing an older generated chapter must preserve later chapter content and
media, mark the generated suffix stale, and pause affected batches. Rebuild
from a valid checkpoint or regenerate the suffix in order.
- Manual chapter edits clear generated lineage. Accept state deltas from manual
analysis only after explicit review.
- Keep stable IDs and revision chains for settings, blueprint, plans, arcs,
windows, summaries, state checkpoints, and generated outputs. Never overwrite
historical revisions.
- Strictly validate OMP structured output at the boundary. Persist provider
usage when available and leave unavailable token or cost values unknown.


# Reference-conditioned image generation rules

- Reference-conditioned image generation must retain an explicit CharacterId ->
  ReferenceAsset mapping (asset id, content hash, and profile revision) in the
  persisted request and metadata; never resolve conditioning by prompt name
  order.
- Changing a character reference must never invalidate unrelated characters'
  images or Story/TTS data. Reference changes propagate only through the
  per-character profile dependency model.
