# Workflow Comparison

These diagrams describe workflows found in source, not proposed future workflows. A box marked “optional” is an actual optional branch in the cited implementation.

## MoneyPrinterTurbo: topic to stock/generated-material short

Source: `references/MoneyPrinterTurbo/app/services/task.py:1242-1503`.

```mermaid
flowchart LR
 A[Topic + VideoParams] --> B[LLM generate_script]
 B --> C[LLM generate_terms]
 C --> D[TTS narration]
 D --> E[Subtitle from TTS cues]
 C --> F[Pexels/Pixabay/Coverr or WaveSpeed/Seedance materials]
 D --> G[MoviePy/FFmpeg composition]
 E --> G
 F --> G
 G --> H[Optional BGM/SFX]
 H --> I[MP4 + optional cross-post]
```

Not present: novel memory, character bible, shot planning, reference-conditioned image generation, or a general storyboard graph.

## pyvideotrans: video dubbing/translation

Source: `references/pyvideotrans/videotrans/task/job.py:71-206`; stage mixins.

```mermaid
flowchart LR
 A[Video or source SRT] --> B[Prepare: probe/extract/separate]
 B --> C[ASR recognition]
 C --> D[Speaker diarization optional]
 D --> E[Translate SRT]
 E --> F[Role-aware TTS / voice clone]
 F --> G[Align audio to timing]
 G --> H[Second ASR optional]
 H --> I[FFmpeg assemble video + audio + subtitles]
```

This is the strongest real dubbing workflow. It is not an image/video-generation workflow.

## NarratoAI: documentary understanding to narrated video

Source: `references/NarratoAI/app/services/documentary/frame_analysis_service.py:37-179`; `app/services/task.py:644-1003`.

```mermaid
flowchart LR
 A[Input video] --> B[Extract/cache keyframes]
 B --> C[Concurrent vision batches]
 C --> D[Analysis JSON/Markdown artifact]
 D --> E[Text LLM narration script]
 E --> F[OST-aware TTS]
 F --> G[Unified video clipping]
 G --> H[Merge audio + generated subtitles]
 H --> I[Mix BGM/SFX and render FFmpeg]
 I --> J[Optional final ASR and subtitle burn]
```

The unified render path can also start with a pre-authored JSON script rather than generated documentary analysis.

## MoneyPrinter: minimal local-first automatic video

Source: `references/MoneyPrinter/Backend/pipeline.py:35-365`.

```mermaid
flowchart LR
 A[Subject] --> B[Ollama script]
 B --> C[Ollama search terms]
 C --> D[Pexels stock downloads]
 B --> E[Sentence-level TikTok TTS]
 E --> F[Local or AssemblyAI SRT]
 D --> G[MoviePy concatenate/crop]
 E --> G
 F --> H[Subtitle burn + audio]
 G --> H
 H --> I[Optional local BGM]
 I --> J[Optional YouTube upload]
```

The worker/API/job database is real (`Backend/worker.py:35-76`, `models.py:20-79`), but the pipeline has no stage resume or retry implementation.

## ShortGPT: step engine and JSON editing schema

Source: `references/ShortGPT/shortGPT/engine/content_video_engine.py:32-159`; `editing_framework/editing_engine.py:17-103`.

```mermaid
flowchart LR
 A[Script] --> B[VoiceModule TTS]
 B --> C[Whisper/audio caption timing]
 C --> D[LLM timed video searches]
 D --> E[Pexels URLs]
 E --> F[Asset duration + optional BGM]
 F --> G[JSON EditingEngine steps]
 C --> G
 B --> G
 G --> H[CoreEditingEngine render]
 H --> I[Metadata + videos/]
```

The numbered engine persists `_db_last_completed_step` and assets, enabling restart from the last completed step (`abstract_content_engine.py:60-75`).

## whisperX: ASR/alignment/diarization utility

Source: `references/whisperX/whisperx/transcribe.py:124-238`.

```mermaid
flowchart LR
 A[Audio] --> B[VAD]
 B --> C[faster-whisper batched ASR]
 C --> D[Forced alignment]
 D --> E[Word/character timestamps]
 E --> F[Optional pyannote diarization]
 F --> G[assign_word_speakers]
 G --> H[SRT/VTT/JSON/TSV writer]
```

## edge-tts: streamed speech with cue metadata

Source: `references/edge-tts/src/edge_tts/communicate.py:425-658`; `submaker.py:19-57`.

```mermaid
flowchart LR
 A[Text] --> B[UTF-8 chunking + SSML]
 B --> C[Edge WebSocket]
 C --> D[MP3 chunks]
 C --> E[Word/Sentence boundaries]
 D --> F[save/save_sync]
 E --> G[SubMaker → SRT]
```

## F5-TTS: local reference-conditioned cloning

Source: `references/F5-TTS/src/f5_tts/infer/infer_cli.py:307-384`; `infer/utils_infer.py:298-458`.

```mermaid
flowchart LR
 A[Reference audio/text] --> B[Trim/hash/cache]
 B --> C[Optional reference ASR]
 D[Model + vocoder] --> E[infer_process]
 C --> E
 F[Generation text] --> E
 E --> G[Chunked flow matching inference]
 G --> H[Concatenate/cross-fade WAV]
```

## GPT-SoVITS: local training and API inference

Source: `references/GPT-SoVITS/api_v2.py:305-445`; `GPT_SoVITS/TTS_infer_pack/TTS.py:421-475,997-1085`.

```mermaid
flowchart LR
 A[Raw voice data] --> B[UVR5/slice/ASR/labels]
 B --> C[GPT + SoVITS training]
 C --> D[Weights]
 E[Text + reference audio/prompt] --> F[TTS.run]
 D --> F
 F --> G[Semantic model]
 G --> H[SoVITS/VITS/vocoder]
 H --> I[WAV or streamed response]
```

## story-claw: novel episode to panel video

Source: `references/story-claw/runner/solo.ts:60-277`; `runner/render.ts:1416-1695`.

```mermaid
flowchart TD
 A[Novel chapter] --> B[Clean text]
 B --> C[Visual preset]
 C --> D[Archive characters/scenes/stages/voices]
 D --> E[Scene segmentation]
 E --> F[Storyboard JSONL]
 F --> G[Global order]
 G --> H[TTS group duration]
 F --> I[Reference selection]
 I --> J[Image generation]
 J --> K[ComfyUI LTX image-to-video]
 H --> L[Subtitle/SFX/group mux]
 K --> L
 L --> M[Global align + merge]
 M --> N[Title/speed/BGM postprocess]
 N --> O[Episode MP4]
```

This is the only reference with an integrated novel → story asset archive → storyboard → generated image/video path.
