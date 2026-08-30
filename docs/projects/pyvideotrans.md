# pyvideotrans

## Purpose

pyvideotrans is a desktop and CLI video translation/dubbing workstation. It extracts or accepts subtitles, recognizes speech, optionally separates vocals and speakers, translates subtitles, synthesizes replacement speech (including cloning), aligns audio to source timing, and assembles video/audio/subtitle outputs.

## Tech Stack

Python; PySide6 desktop UI (`sp.py`); CLI (`cli.py`); dataclasses/config modules; Qt `QThread` workers and Python queues; FFmpeg/ffprobe helpers; local model caches under `tmp/` and `models/`; many provider adapters. License: GPLv3 (`references/pyvideotrans/LICENSE:1-27`). Direct code reuse would impose copyleft obligations and must be treated separately from architecture reuse.

## Architecture

`TransCreate` (`videotrans/task/trans_create.py:25-53`) is a dataclass assembled from stage mixins. `start_thread()` (`videotrans/task/job.py:208-247`) starts one or more workers for named queues. Workers route the same task object to the next queue; each stage mutates task state and files.

```mermaid
flowchart LR
 UI[PySide6 / CLI] --> C[TaskCfg + TransCreate]
 C --> Q0[prepare_queue]
 Q0 --> Q1[SpeechToText]
 Q1 --> Q2[Diarization]
 Q2 --> Q3[Translation]
 Q3 --> Q4[Dubbing]
 Q4 --> Q5[Alignment]
 Q5 --> Q6[Second ASR optional]
 Q6 --> Q7[Assembly]
 Q7 --> Q8[TaskDone]
 Q8 --> FS[tmp/cache/target files]
```

## Entry Points

- Desktop: `references/pyvideotrans/sp.py:164-218` creates the Qt application and main window.
- CLI: `cli.py:196-276` implements STT/TTS/subtitle-translation/full-video-translation commands; `:521-594` parses and dispatches.
- Task object: `videotrans/task/trans_create.py:25-56`.
- Workers: `videotrans/task/job.py:13-206`.
- Shared queue configuration and model/provider settings: `videotrans/configure/_app_cfg.py`, `_app_settings.py`, and `config.py`.

## Workflow

Preparation (`_stage_prepare.py:14-116`) validates media with `get_video_info`, creates cache/output paths, extracts audio, optionally separates vocal/instrumental tracks, and derives a clone reference. Recognition (`_stage_recogn.py:20-136`) loads existing subtitles or calls `videotrans.recognition.run`, supports denoise and punctuation repair, and saves SRT. Optional diarization passes speaker labels. Translation (`_stage_translate.py:14-74`) calls `translator.run` on copied SRT items and preserves alignment with `check_target_sub`. Dubbing (`_stage_dubbing.py:17-124`) builds `queue_tts` with role/reference audio information and calls `tts.run`. Alignment adjusts generated audio to subtitle/video timing; optional second recognition rechecks dubbed audio. Assembly (`_stage_assemble.py:20-58,79-444`) uses FFmpeg to combine original/translated audio, subtitles, and video with hardware codec options.

## Important Components

- `videotrans/task/job.py:13-67`: common worker loop, interruption/cancel checks, exception reporting, and cleanup. Input queue/task; output next queue or terminal state.
- `videotrans/task/job.py:71-206`: explicit stage workers and routing. This is a practical queue-based workflow engine, though transitions are hard-coded.
- `videotrans/task/_stage_prepare.py:14-116`: media inspection, audio extraction, vocal separation, temp files. Depends on `help_ffmpeg`, `help_misc`, and optional separation models.
- `videotrans/task/_stage_recogn.py:20-136`: ASR and SRT creation through the recognition registry. Output is `source_sub` and `source_srt_list`.
- `videotrans/recognition/__init__.py:11-49,120-211`: numeric provider registry and common `run` entry point. Includes faster-whisper, WhisperX API, Whisper.cpp, FunASR, Qwen, Gemini, Deepgram, ElevenLabs, Google, and local/cloud APIs.
- `videotrans/translator/__init__.py:1-35` and `_runner.py`: translator registry/common runner. Providers include Google, Microsoft, ChatGPT, DeepSeek, Gemini, Azure, OpenRouter, Qwen, DeepL/DeepLX, LibreTranslate, MiniMax, Xiaomi, LiteLLM, and local models.
- `videotrans/tts/__init__.py:6-75,212-233`: TTS registry and common `run`; local built-ins, local HTTP APIs, cloud APIs, Edge TTS, F5-TTS, GPT-SoVITS, CosyVoice, Chatterbox, Kokoro, Fish, ElevenLabs, OpenAI, Gemini, Azure, and more.
- `videotrans/task/_stage_dubbing.py:38-124`: role-aware per-subtitle speech queue, reference-audio cloning, segment output/cache, and generated SRT timing.
- `videotrans/task/_stage_assemble.py:79-444`: FFmpeg command construction, codec selection, progress polling, and final mux.
- `videotrans/configure/_paths.py:9-25`: deterministic `tmp`, logs, translation cache, dubbing cache, model directories; `:52-86` sets offline/Hugging Face/model environment variables.

## Providers

ASR is unusually broad: faster-whisper, OpenAI Whisper, WhisperX API, Whisper.cpp, FunASR, Qwen ASR/local Qwen, Paraformer, Parakeet, FireRedASR, Gemini, Deepgram, ElevenLabs, Google, GLM, Xiaomi, Volcano, and custom APIs. TTS includes Edge TTS; local F5-TTS, GPT-SoVITS, CosyVoice, ChatTTS, Kokoro, Piper, Chatterbox, OmniVoice, Qwen3 local, Supertonic, VITS; local HTTP packs; and cloud Doubao, Qwen, Xiaomi, GLM, MiniMax, OpenAI, Gemini, ElevenLabs, Azure. Translation has both cloud and local/LibreTranslate/M2M100/LiteLLM paths.

## What We Can Reuse

- **DIRECTLY REUSABLE concept:** stage contracts (`prepare`, `recogn`, `trans`, `dubbing`, `align`, `assembling`, `task_done`) and queue routing from `job.py`; they give a useful dubbing workflow vocabulary.
- **REFERENCE ONLY:** provider registries in `recognition/__init__.py`, `tts/__init__.py`, and translator modules. They are broad but numeric-ID/UI-centric; a future studio should use typed capability descriptors.
- **REFERENCE ONLY:** cache path scheme in `_paths.py`; preserve separate model, translation, dubbing, and per-project artifact scopes, but use content hashes and manifests.
- **NOT DIRECTLY USEFUL:** GPL-bound desktop UI and tightly coupled mutable task mixins unless the future product also accepts GPL terms.

## Strengths

Complete dubbing path; many local providers; speaker separation and role/reference audio handling; explicit stage queues; cancellation; GPU-aware worker counts; offline Hugging Face cache setup; FFmpeg hardware codec support; CLI and desktop surfaces; separate tests for helpers and stage behavior.

## Weaknesses

Hard-coded queue graph and mutable mixin object make branching/resume semantics implicit. Provider IDs and UI integration are heavily coupled. Translation/dubbing caches are path-oriented rather than content-addressed. It is an excellent translator/dubber but not a story-planning or image/video-generation system; no shot planner, character bible, or generated visual pipeline.

## Ideas Worth Copying

Adopt explicit preparation/recognition/translation/dubbing/alignment/assembly stages; maintain per-stage queues and cancellation; cap GPU workers based on discovered hardware; cache local models separately; preserve source and target subtitle artifacts; and use a second ASR pass to validate dubbed output. Wrap providers behind capability-based adapters rather than reproducing the numeric registry.
