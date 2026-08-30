# Feature Matrix

Legend: ✅ integrated in a current source path; ⚠️ primitive, optional, narrower, or not integrated end-to-end; ❌ not found in the inspected source. “Generation” means an actual provider call, not just composition.

| Feature | MoneyPrinterTurbo | pyvideotrans | NarratoAI | MoneyPrinter | ShortGPT | whisperX | edge-tts | F5-TTS | GPT-SoVITS | story-claw |
|---|---|---|---|---|---|---|---|---|---|---|
| AI script generation | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Story understanding | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Scene splitting | ⚠️ | ❌ | ✅ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Shot planning | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Image prompt generation | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Image generation | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Image reference support | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Video generation | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Image-to-video | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Stock footage search | ✅ | ❌ | ⚠️ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| TTS | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Voice cloning | ⚠️ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Multiple character voices | ⚠️ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ | ✅ | ⚠️ | ✅ |
| ASR | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ❌ |
| Subtitle generation | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Word-level subtitle | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Subtitle translation | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Dubbing | ❌ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Background music | ✅ | ⚠️ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Sound effects | ⚠️ | ⚠️ | ✅ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Timeline generation | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Video composition | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| FFmpeg | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| MoviePy | ✅ | ❌ | ⚠️ | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Remotion | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ComfyUI | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Batch generation | ⚠️ | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| Job queue | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ |
| Retry/resume | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| Caching | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ✅ |
| Web UI | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ⚠️ |
| API | ✅ | ⚠️ (CLI) | ⚠️ (service functions) | ✅ | ❌ | ❌ | ❌ | ⚠️ | ✅ | ⚠️ (helpers, not studio API) |
| Local AI support | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | ✅ | ⚠️ |
| Cloud provider support | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |

## Evidence notes

- MoneyPrinterTurbo: `references/MoneyPrinterTurbo/app/services/task.py:1242-1503`, `app/services/material.py:296-605,699-989`, `app/services/video.py:332-762,991-1297`, and `app/services/voice.py:455-553`.
- pyvideotrans: `references/pyvideotrans/videotrans/task/job.py:71-206`, stage mixins, and registries in `videotrans/recognition/__init__.py`, `tts/__init__.py`, and `translator/`.
- NarratoAI: `references/NarratoAI/app/services/task.py:644-1003`, `documentary/frame_analysis_service.py:37-179`, `llm/manager.py:15-225`, and `generate_video.py:1339-1751`.
- MoneyPrinter: `references/MoneyPrinter/Backend/pipeline.py:35-365`, `video.py:49-345`, `worker.py:35-76`.
- ShortGPT: `references/ShortGPT/shortGPT/engine/content_video_engine.py:19-159`, `engine/abstract_content_engine.py:48-92`, and `editing_framework/editing_engine.py:17-103`.
- whisperX: `references/whisperX/whisperx/transcribe.py:20-238`, `asr.py:315-442`, `alignment.py:80-424`.
- edge-tts: `references/edge-tts/src/edge_tts/communicate.py:321-658`, `submaker.py:10-57`.
- F5-TTS: `references/F5-TTS/src/f5_tts/infer/infer_cli.py:307-384`, `infer/utils_infer.py:298-458`.
- GPT-SoVITS: `references/GPT-SoVITS/api_v2.py:305-445`, `GPT_SoVITS/TTS_infer_pack/TTS.py:421-475,997-1085`.
- story-claw: `references/story-claw/runner/solo.ts:45-300`, `runner/pipeline.ts:493-1024`, `runner/render.ts:612-1695,1738-1930`.

Rows marked ⚠️ are intentionally conservative. For example, MoneyPrinterTurbo has generated-video material providers but not a general scene-level image-to-video planner; pyvideotrans has many ASR/TTS channels but no visual generation path; story-claw has parallel work and persistent stage state but no database-backed multi-user queue.
