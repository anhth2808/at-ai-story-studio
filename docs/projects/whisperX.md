# whisperX

## Purpose

whisperX provides time-accurate automatic speech recognition using Whisper/faster-whisper, VAD, forced alignment, and optional speaker diarization. It produces segment and word-level timings suitable for subtitles, dubbing alignment, and timeline construction.

## Tech Stack

Python package/CLI; CTranslate2/faster-whisper; PyTorch/torchaudio; Silero or pyannote VAD; wav2vec2/other Hugging Face alignment models; pyannote diarization; NumPy; subtitle writers. License: BSD-2-Clause (`references/whisperX/LICENSE:1-23`).

## Architecture

The CLI parses model/device/output options and invokes `transcribe_task`. That function loads a VAD+ASR pipeline, loops audio inputs, releases ASR GPU memory, optionally loads language alignment models, then optionally diarizes and assigns speakers before writing formats.

```mermaid
flowchart LR
 CLI[whisperx.__main__.cli] --> T[transcribe_task]
 T --> V[VAD + faster-whisper ASR]
 V --> A[language alignment / word timestamps]
 A --> D[pyannote diarization optional]
 D --> W[assign_word_speakers]
 W --> O[JSON/SRT/VTT/TSV output writer]
```

## Entry Points

- Console script: `references/whisperX/pyproject.toml:32-34` maps `whisperx` to `whisperx.__main__:cli`.
- CLI: `whisperx/__main__.py:12-102`.
- Orchestration: `whisperx/transcribe.py:20-238`.
- Library ASR loader: `whisperx/asr.py:315-442`.
- Alignment: `whisperx/alignment.py:80-424`.
- Subtitle splitting: `whisperx/SubtitlesProcessor.py:33-226`.

## Workflow

`transcribe_task` extracts options and normalizes language (`transcribe.py:29-86`), builds ASR options and output writer (`:88-122`), loads faster-whisper with selected VAD/device/cache/threads (`:124-145`), transcribes each audio (`:147-157`), frees model memory (`:160-163`), loads alignment models and aligns segments to words/characters (`:165-201`), optionally runs `DiarizationPipeline` and `assign_word_speakers` (`:208-234`), and writes each result (`:235-238`). `SubtitlesProcessor` can split long segments at conjunction/comma boundaries and estimate missing word timestamps (`:47-97,141-226`).

## Important Components

- `whisperx/asr.py:31-104`: custom `WhisperModel` and encoding behavior; supports multi-GPU CPU handoff.
- `whisperx/asr.py:106-312`: `FasterWhisperPipeline`, VAD segmentation, batched transcribe.
- `whisperx/asr.py:315-442`: model/VAD factory, compute type defaults (float16 CUDA, float32 CPU), model cache/local-only operation, thread configuration.
- `whisperx/alignment.py:80-114,117-424`: alignment model factory and forced alignment output with `word_segments`.
- `whisperx/diarize.py`: pyannote pipeline and speaker assignment.
- `whisperx/SubtitlesProcessor.py:33-226`: subtitle line splitting and timestamp interpolation.
- `whisperx/schema.py`: typed result structures for segments/words.

## Providers

ASR model is Whisper through faster-whisper/CTranslate2, local after model download. VAD is Silero or pyannote. Alignment models are local Hugging Face/PyTorch assets. Diarization is pyannote and requires a Hugging Face token for model access. No LLM, translation, TTS, image, video, or rendering provider.

## What We Can Reuse

- **DIRECTLY REUSABLE:** package/library and BSD-2-Clause license allow integration with attribution; wrap `load_model`, `align`, `DiarizationPipeline`, and schema outputs rather than copy internals.
- **DIRECTLY REUSABLE concept:** segment/word/speaker timing contract for a future `ASRProvider` and subtitle engine.
- **REFERENCE ONLY:** CLI orchestration; a studio needs durable jobs and artifact manifests around these synchronous model calls.
- **NOT USEFUL:** its output writers as the whole subtitle system; they do not solve translated subtitles, style/layout, or final burn-in.

## Strengths

Best timing quality among the references; staged ASR → alignment → diarization; local cache/offline options; batching, GPU/CPU controls, word/character timestamps, and clear output schema.

## Weaknesses

Model memory and dependency footprint are high; pyannote token/model access complicates completely offline use; no translation/dubbing/render workflow; no persistent job/resume layer. Alignment is language-model dependent and can fail or require fallback when language coverage is missing.

## Ideas Worth Copying

Treat timed words and speaker labels as canonical timeline evidence; free GPU models between phases; expose compute type, device, batch, and cache controls; and make alignment/diarization optional stages with explicit quality/failure states.
