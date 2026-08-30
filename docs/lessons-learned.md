# Lessons Learned and Gap Analysis

## What the references prove

1. **A basic generator is straightforward.** MoneyPrinter and MoneyPrinterTurbo both implement topic → LLM text → stock media → TTS → subtitles → MoviePy/FFmpeg MP4 (`MoneyPrinter/Backend/pipeline.py:73-179`; `MoneyPrinterTurbo/app/services/task.py:1315-1444`).
2. **Dubbing is a distinct pipeline.** pyvideotrans separates prepare, ASR, diarization, translation, TTS, alignment, secondary ASR, and assembly (`pyvideotrans/videotrans/task/job.py:71-206`). It should not be forced into the topic-video pipeline.
3. **Timing is a first-class asset.** whisperX provides word/character alignment and speakers; edge-tts exposes boundaries; story-claw uses TTS word timestamps to place subtitles/SFX (`whisperX/transcribe.py:165-234`; `edge-tts/communicate.py:386-423`; `story-claw/render.ts:1201-1233`).
4. **Novel conversion requires persistent intermediate meaning.** story-claw's clean text, visual preset, archive, segmented scripts, JSONL storyboards, and global order (`story-claw/runner/pipeline.ts:493-1024`) are the first reference to preserve narrative structure beyond a single prompt.
5. **Generated video must be duration-driven.** story-claw synthesizes group audio before panel video and maps duration to valid frame counts (`render.ts:1448-1456,687-709`).
6. **Retries need quality checks, not only HTTP retries.** story-claw detects anomalous TTS duration/rate and changes voice (`render.ts:1117-1155`); image generation softens safety prompts and falls back (`:626-674`).

## Missing capabilities for the future studio

### Long novel understanding
No reference builds a durable global representation of an entire novel. story-claw reads later/prior chapters selectively (`pipeline.ts:556-590,927-956`), which is useful but not a story memory. Missing: chapter ingestion, hierarchical summaries, entities/events/causal links, retrieval by scene/character, versioned memory, and context-budget policies.

### Character consistency
story-claw stores character base prompts, stage prompts, and reference PNGs (`pipeline.ts:628-694`; `render.ts:824-853`) and selects them per panel. Missing: identity embeddings, face/wardrobe consistency scoring, explicit canonical attributes, and automated drift detection across chapters.

### Location and style consistency
Scene base/stage prompts exist in story-claw, but no evaluator proves continuity. Missing: location reference sets, style bible, palette/camera constraints, per-shot inheritance, image similarity/CLIP/face checks, and a human review diff.

### Scene graph and shot planning
story-claw has scene segmentation and panel JSONL; there is no general graph of scenes, characters, locations, props, events, entrances/exits, or shot dependencies. Missing: a typed scene graph and deterministic shot planner capable of rebuilding only affected descendants.

### Image reference management
story-claw's catalog/selector is the strongest starting point. Missing: asset versioning, semantic tags, embeddings, provenance/license fields, aspect/crop variants, reference priority, and user overrides that survive re-planning.

### Automatic quality evaluation and regeneration
Current checks are mostly file existence, media dimensions, TTS rate, and API errors (`story-claw/render.ts:1604-1632`; `MoneyPrinterTurbo/video.py:105-113`). Missing: multimodal shot checks, subtitle/audio sync score, face/character similarity, prompt safety outcome record, quality thresholds, human approval, and targeted regeneration with bounded budget.

### Cost tracking
Cloud keys and optional metered GPU are configured, but no unified usage ledger exists. Missing: per-call provider/model/token/seconds/image/video counts, GPU lease minutes, estimated and actual cost, budget gates, and cost-aware fallback selection.

### GPU scheduling
pyvideotrans caps workers and story-claw starts/stops a GPU, but neither provides a shared memory-aware scheduler. Missing: model memory profiles, queue priorities, exclusive GPU leases, VRAM probing, prewarming, spill-to-CPU policy, and multi-project fairness.

### Workflow persistence/resume
ShortGPT persists last step; story-claw persists episode stage values; MoneyPrinter persists jobs. Missing: one transactional model connecting DAG node inputs, attempts, output hashes, logs, retries, review gates, and invalidation when upstream inputs change.

### Provider fallback
MoneyPrinterTurbo and story-claw have local fallbacks in selected paths. Missing: capability-aware fallback policy: e.g. local WhisperX → cloud ASR; Edge TTS → F5/GPT-SoVITS; GPT image → Gemini/local diffusion; ComfyUI → stock/ken burns. Fallback must preserve contract, record quality/cost differences, and never silently substitute an incompatible modality.

## Local-first path

- **Local baseline:** Ollama or another local LLM; whisperX; Edge TTS or F5/GPT-SoVITS; local BGM; FFmpeg; stock assets only when needed.
- **Consumer-GPU enhancement:** local image diffusion/ComfyUI; F5/GPT-SoVITS voice profiles; local embeddings and quality models.
- **Optional cloud:** high-quality LLM planning, GPT/Gemini images, hosted video generation, cloud TTS/music when local latency or quality is insufficient.

## Risks

- Cloud providers and undocumented services can change; adapters must have versioned contracts.
- Reference audio and image rights are user responsibility; store provenance and consent metadata.
- TTS and video duration mismatch compounds across many scenes; use real probes and bounded alignment.
- Long-story context can overwhelm LLM calls; hierarchical memory and retrieval are mandatory, not an optimization.
- Model licenses differ even when repositories are MIT/BSD; audit downloaded checkpoints and third-party components separately.
