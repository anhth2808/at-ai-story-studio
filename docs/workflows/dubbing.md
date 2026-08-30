# Dubbing Workflow

## Real reference path

pyvideotrans provides the complete integrated dubbing path. Its stage workers and routing are in `references/pyvideotrans/videotrans/task/job.py:71-206`; preparation, recognition, translation, dubbing, and assembly are in `_stage_prepare.py`, `_stage_recogn.py`, `_stage_translate.py`, `_stage_dubbing.py`, `_stage_align.py`, and `_stage_assemble.py`.

```mermaid
flowchart LR
 A[Video + optional source SRT] --> B[Probe/extract audio]
 B --> C[Voice separation optional]
 C --> D[ASR]
 D --> E[Diarization optional]
 E --> F[Subtitle translation]
 F --> G[Role/reference-aware TTS]
 G --> H[Audio alignment]
 H --> I[Second ASR optional]
 I --> J[FFmpeg mux/burn subtitles]
```

## Capability status

| Step | Exists | Evidence |
|---|---|---|
| Audio extraction/separation | ✅ | `_stage_prepare.py:14-116` |
| ASR | ✅ | `_stage_recogn.py:20-136`; recognition registry |
| Speaker diarization | ✅ optional | `job.py:106-124`; `_stage_diariz.py` |
| Subtitle translation | ✅ | `_stage_translate.py:14-74` |
| Role-aware TTS | ✅ | `_stage_dubbing.py:38-124` |
| Voice cloning | ✅ optional/provider-dependent | TTS `SUPPORT_CLONE` and reference audio |
| Audio/video alignment | ✅ | `_stage_align.py` |
| Word-level canonical alignment | ⚠️ | provider-dependent; WhisperX integration exists but not mandatory |
| Final mux | ✅ | `_stage_assemble.py:79-444` |
| Story/scene generation | ❌ | Dubbing starts from video/SRT, not a narrative plan |

## Local-first route

Use local WhisperX/faster-whisper, local separation/diarization where models permit, local translation (M2M100/LibreTranslate), and F5-TTS/GPT-SoVITS/CosyVoice. Keep cloud ASR/translation/TTS as optional adapters. The pipeline must surface provider-specific language and clone support instead of treating all voices as interchangeable.
