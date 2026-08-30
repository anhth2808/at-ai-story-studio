# Reusable Components

The recommended integration boundary is an adapter around a stable studio contract, not source copying. License notes are from each repository's root `LICENSE` unless stated otherwise.

| Component | Existing implementation | Generic enough? | Dependencies | Decision |
|---|---|---|---|---|
| `LLMProvider` | MoneyPrinterTurbo `app/models/llm_provider.py:7-34,187-424` + `app/services/llm.py`; NarratoAI `app/services/llm/manager.py:15-225`; story-claw `agent.ts:28-177` | Registry ideas yes; code is app/config coupled | SDKs, endpoint config, retries, structured output | **Wrap/reimplement contract**; borrow capability registry and response normalization |
| `VisionProvider` | NarratoAI `frame_analysis_service.py:97-179`; `llm/unified_service.py` | Yes at batch-image analysis boundary | OpenAI-compatible/TwelveLabs adapters, image files | **Wrap** with batch, cache, token/cost metadata |
| `TTSProvider` | edge-tts `Communicate`; pyvideotrans `tts/__init__.py:212-233`; MoneyPrinterTurbo `voice.py:455-553`; ShortGPT `VoiceModule` | Interface concept yes; registries are UI-specific | Provider SDK/API, audio tools, timing | **Reimplement typed interface; wrap providers** |
| `VoiceCloneProvider` | F5 `infer/utils_infer.py:298-458`; GPT-SoVITS `TTS.py:421-475,997-1085`; pyvideotrans clone paths | Model-specific, not universal | GPU, checkpoints, reference audio/text | **Wrap** behind profile/reference contract; never assume every TTS supports clone |
| `ASRProvider` | whisperX `asr.py:315-442`, `transcribe.py:124-238`; pyvideotrans recognition registry | Yes | Torch/CTranslate2, VAD, HF models/tokens | **Directly integrate whisperX library under BSD; wrap other providers** |
| `AlignmentProvider` | whisperX `alignment.py:80-424` | Yes for segment→word timing | Language alignment models | **Directly integrate/wrap** |
| `DiarizationProvider` | whisperX `diarize.py`; pyvideotrans diarization stage | Yes as optional stage | pyannote/HF token, GPU | **Wrap** and make speaker uncertainty explicit |
| `TranslationProvider` | pyvideotrans `translator/__init__.py`, `_runner.py`; NarratoAI `subtitle_translator.py` | Registry idea yes | Many cloud/local engines | **Reimplement adapter layer** with batch/quality/cost metadata |
| `ScenePlanner` | story-claw `runner/pipeline.ts:518-793` | Structured workflow yes; prompt logic domain-specific | Agent runtime, filesystem, LLM | **Reimplement** around typed scene graph and validation |
| `ShotPlanner` | story-claw `runner/pipeline.ts:810-1024` | JSONL group/panel contract yes | LLM, resource roster, SFX catalog | **Reimplement/wrap concept**; add deterministic schema validators |
| `ImageProvider` | story-claw `runner/render.ts:612-678`; helpers in `utils/` | Yes | GPT/Gemini APIs, reference files | **Wrap** with reference images, safety retry, seed/model metadata |
| `VideoProvider` | story-claw `render.ts:687-794` ComfyUI; MoneyPrinterTurbo `material.py:699-989,1362-1472` | Yes at submit/poll/download boundary | ComfyUI or cloud APIs, model workflows | **Wrap** with asynchronous job contract and duration limits |
| `AssetManager` | story-claw `utils/paths.ts`, `render.ts:338-591`; MoneyPrinterTurbo materials/cache | Concepts yes | Filesystem, metadata formats | **Reimplement** content-addressed assets plus reference lineage |
| `TimelineEngine` | story-claw `render.ts:1201-1233,1724-1798`; pyvideotrans align/assembly | Yes as domain contract | FFmpeg, duration probes, word cues | **Reimplement** typed timeline IR; borrow duration-first/audio alignment |
| `SubtitleEngine` | edge-tts `SubMaker`; whisperX `SubtitlesProcessor`; NarratoAI `generate_video.py` | Pieces are reusable | SRT/ASS, fonts, timing | **Combine/wrap**; keep word-level source events separate from render styling |
| `RenderEngine` | MoneyPrinterTurbo `video.py:332-762,991-1297`; NarratoAI `generate_video.py:1339-1751`; story-claw `render.ts:1301-1398` | Composition ideas yes | FFmpeg; MoviePy optional | **Reimplement around FFmpeg**; use MoviePy only for specific convenience APIs |
| `WorkflowEngine` | ShortGPT `AbstractContentEngine:60-75`; story-claw `solo.ts:60-277`; pyvideotrans queue routing | Concepts differ | DB/files, prompts, workers | **Reimplement** durable DAG/stages; borrow resume and gates |
| `JobQueue` | MoneyPrinter `worker.py:35-76` + `models.py:20-79`; MoneyPrinterTurbo memory/Redis managers; pyvideotrans QThreads | Yes | DB/Redis or local queues | **Reimplement** with DB-backed leases, retries, resource classes |
| `ProjectStorage` | ShortGPT content DB; story-claw `utils/paths.ts`/progress; MoneyPrinterTurbo task artifacts | Yes | SQLite/object/filesystem | **Reimplement** project/workspace/artifact manifest |
| `GPU scheduler` | pyvideotrans `job.py:208-247`; story-claw `grab_gpu.py`/`shutdown_gpu.py` | Policy yes, scripts no | CUDA/process/cloud VM | **Reimplement** resource scheduler with leases/cost tracking |

## License boundary

MoneyPrinterTurbo, NarratoAI, MoneyPrinter, ShortGPT, F5-TTS, GPT-SoVITS, and story-claw declare MIT; whisperX declares BSD-2-Clause; edge-tts is mixed MIT/LGPLv3 (`docs/projects/edge-tts.md`). pyvideotrans is GPLv3. Direct reuse requires preserving notices and auditing bundled third-party code. The safest path is to reimplement contracts and wrap installed libraries/providers, especially for pyvideotrans and edge-tts.

## Recommended studio contracts

```text
LLMProvider.generate(request) -> StructuredResponse + usage + raw_artifact
TTSProvider.synthesize(text, voice_profile) -> AudioArtifact + timing_events
ASRProvider.transcribe(audio) -> segments + words + speakers?
ImageProvider.generate(prompt, references, constraints) -> ImageArtifact
VideoProvider.generate(image?, prompt, duration) -> AsyncMediaJob
TranslationProvider.translate(items, locale_pair) -> aligned items
TimelineEngine.build(scenes, audio, cues, assets) -> TimelineIR
RenderEngine.render(TimelineIR) -> RenderArtifact + probe
```

Every result should carry provider/model/version, input hashes, seed/parameters, duration, cost estimate, warnings, and cache key. That metadata is missing or inconsistent in the references and is required for reproducibility and regeneration.
