# Reference Reuse and License Boundaries

## Policy

The design uses the completed source-grounded research in `docs/projects/`, `docs/architecture-patterns.md`, `docs/reusable-components.md`, `docs/provider-matrix.md`, and `docs/workflow-comparison.md`. No source from `references/` is copied into AI Story Studio.

Labels are decisions, not license opinions:

- **LEARN FROM:** architecture/behavior evidence only; write an original implementation.
- **WRAP:** call the project/package/executable/service behind a studio adapter; preserve license/notices and isolate its data/process contract.
- **REIMPLEMENT:** build the behavior from requirements in the new TypeScript-first architecture, without copying source.
- **OPTIONAL:** useful but not required for V1's shipping path.
- **DO NOT USE:** exclude the component/path from the studio core.

Dependency, model, dataset, service terms, and output rights must be checked separately even when repository code is permissively licensed.

## Decisions by project

### story-claw — MIT

Research: [`docs/projects/story-claw.md`](../projects/story-claw.md).

- **LEARN FROM:** staged novel workflow; persistent character/location/archive concepts; selected prior/later context; storyboards/global order; duration-first media; quality checks, retries, completeness gates, and persistent stage progress.
- **REIMPLEMENT:** bounded story context, story event/archive model, workflow checkpoints, typed visual/timeline records, and deterministic validation in the TypeScript modules. Reuse architectural lessons, not the reference project's Pi-agent or workspace coupling.
- **OPTIONAL:** future ComfyUI/image-to-video adapter ideas and reference/continuation image handling for V2–V4.
- **DO NOT USE:** Electron/CLI presentation, metered GPU shutdown scripts, or sub-agent tool orchestration as the deterministic production engine.

MIT would permit reuse with notice, but original reimplementation avoids dragging in framework/provider assumptions and complies with this phase's no-copy rule.

### pyvideotrans — GPLv3

Research: [`docs/projects/pyvideotrans.md`](../projects/pyvideotrans.md).

- **LEARN FROM:** named dubbing stages, explicit stage queues, cancellation, GPU-aware workers, provider registries, cache scopes, FFmpeg hardware probing, and alignment behavior.
- **REIMPLEMENT:** durable stage/attempt/dependency vocabulary and typed capability registry as original TypeScript code.
- **OPTIONAL:** a separate future dubbing product flow; it is not the V1 story-generation path.
- **DO NOT USE:** copy/link the GPL application UI, mutable mixin pipeline, or source into a differently licensed studio unless the project explicitly chooses GPL-compatible distribution and completes legal review.

Architecture ideas are not copied code. Process-level interoperability might be possible later, but there is no reason to depend on the entire app for V1.

### MoneyPrinterTurbo — MIT

Research: [`docs/projects/MoneyPrinterTurbo.md`](../projects/MoneyPrinterTurbo.md).

- **LEARN FROM:** shared pipeline across API/UI, provider registry breadth, task artifact URLs, media-source persistence, FFmpeg probing/fallback, optional music, and isolated publication failures.
- **REIMPLEMENT:** provider descriptors, artifact API, workflow persistence/invalidation, and FFmpeg timeline compiler. Its in-memory/Redis task manager and global configuration are insufficient for exact resume.
- **OPTIONAL:** stock-media provider ideas for later visual variety.
- **DO NOT USE:** cross-posting/platform publication in the long-story V1 core; MoviePy pipeline as the final architecture.

### MoneyPrinter — MIT

Research: [`docs/projects/MoneyPrinter.md`](../projects/MoneyPrinter.md).

- **LEARN FROM:** smallest understandable subject→script→TTS→subtitle→video path; persisted jobs/events; polling worker; cancellation checks; local Ollama.
- **REIMPLEMENT:** job/attempt/error fields and worker claim behavior with durable step/dependency semantics.
- **OPTIONAL:** stock footage path after uploaded backgrounds/slideshows.
- **DO NOT USE:** TikTok voice service coupling, linear no-resume pipeline, and frontend-specific YouTube upload assumptions.

### NarratoAI — MIT

Research: [`docs/projects/NarratoAI.md`](../projects/NarratoAI.md).

- **LEARN FROM:** explicit LLM manager/provider façade, cached/batched analysis artifacts, progress callbacks, subtitle/audio composition, and robust FFmpeg fallbacks.
- **REIMPLEMENT:** normalized provider contracts, persisted progress, and neutral timeline; remove Streamlit/global task coupling.
- **OPTIONAL:** future imported-video understanding/documentary workflow and SFX/BGM policies.
- **DO NOT USE:** Streamlit/Jianying-specific UI/export as core product behavior.

### ShortGPT — MIT

Research: [`docs/projects/ShortGPT.md`](../projects/ShortGPT.md).

- **LEARN FROM:** numbered resumable steps, persisted asset fields, separation of content planning from editing, JSON editing schema, and timed visual queries.
- **REIMPLEMENT:** workflow graph/checkpoints and typed timeline in durable SQLite/domain records; do not copy its mutable file-DB mechanics.
- **OPTIONAL:** timed stock search as a future scene-visual source.
- **DO NOT USE:** Gradio GUI, hard-coded stock workflow, or the small voice interface as the studio provider contract.

### WhisperX — BSD-2-Clause

Research: [`docs/projects/whisperX.md`](../projects/whisperX.md).

- **WRAP:** package/CLI/local service behind `ASRProvider` for optional ASR/forced alignment; preserve BSD attribution and review transitive model licenses.
- **LEARN FROM:** segment/word/speaker timing schema, staged ASR→alignment→diarization, cache/device controls.
- **OPTIONAL:** V1 subtitle quality mode; default subtitles use known TTS segments.
- **DO NOT USE:** subtitle writers as the entire subtitle domain or diarization in the required story path.

### edge-tts — mixed LGPLv3; `srt_composer.py` MIT

Research: [`docs/projects/edge-tts.md`](../projects/edge-tts.md).

- **WRAP:** an installed external Python CLI/package behind `TTSProvider`; record version and comply with LGPL distribution/notice obligations. This is the fastest V1 TTS path, not a stable owned service.
- **LEARN FROM:** UTF-8-aware chunking, word/sentence boundary events, offset compensation, and boundary-to-SRT concepts.
- **OPTIONAL:** direct use of the small MIT SRT composer is unnecessary because the studio will implement its own cue serializer.
- **DO NOT USE:** copy protocol/DRM/WebSocket implementation into the studio, or assume an undocumented free service has permanent availability/terms.

### F5-TTS — MIT

Research: [`docs/projects/F5-TTS.md`](../projects/F5-TTS.md).

- **WRAP:** pinned local Python HTTP sidecar behind `TTSProvider` and voice-conditioning capability; keep stateful model lifetime outside Fastify and the Node.js worker.
- **LEARN FROM:** reference preprocessing/hash cache, chunking/cross-fade, reference transcript handling, and multi-voice tags.
- **OPTIONAL:** second V1/early post-V1 TTS provider for local/private narration after Edge validates the pipeline.
- **DO NOT USE:** training/Gradio UI in the studio core; copy global cache/config mechanics. Audit model/vocoder/checkpoint terms separately.

### GPT-SoVITS — MIT

Research: [`docs/projects/GPT-SoVITS.md`](../projects/GPT-SoVITS.md).

- **WRAP:** existing FastAPI/local service behind `TTSProvider` when mature multilingual voice cloning is needed.
- **LEARN FROM:** reference-audio prompt contract, model/prompt cache ownership, streaming modes, and preprocessing/training lifecycle separation.
- **OPTIONAL:** provider pack after the simpler V1 narration path; especially valuable for users already operating its models.
- **DO NOT USE:** monolithic Gradio training UI or embed stateful GPU models in the web host. Audit included third-party/model terms.

## Cross-reference synthesis

| Studio concern | Evidence to retain | Studio decision |
|---|---|---|
| Long story | story-claw is the only integrated novel/story archive path | Reimplement a smaller blueprint/summary/event context model. |
| Durable work | ShortGPT resume + MoneyPrinter jobs + story-claw progress | Reimplement DB step graph, attempts, leases and lineage. |
| Provider breadth | MoneyPrinterTurbo/NarratoAI/pyvideotrans | Reimplement narrow capability registry; wrap only selected tools. |
| TTS | Edge timings; F5/GPT-SoVITS local cloning | Edge wrapper first; local sidecars optional next; chunking owned by studio. |
| Subtitle timing | Edge boundaries + WhisperX alignment | Known-segment default; optional WhisperX adapter. |
| Render | all production references converge on FFmpeg | Own neutral timeline and FFmpeg compiler; avoid copied MoviePy pipelines. |
| Visual future | story-claw ComfyUI/image-to-video path | Add scene/image/video producer steps later, not V1 dependency. |

## Decision: wrap tools, reimplement product

- **Alternatives:** fork one reference; copy permissively licensed components; ignore references entirely.
- **Why:** no reference supplies the required long-story, durable, local-first TypeScript product; wrappers preserve mature ML while original modules fit the domain.
- **Trade-offs:** more original engineering; adapters require version/operations testing.
- **Future impact:** reference projects can be upgraded/replaced without becoming the studio's architecture.
