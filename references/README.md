# AI Video Workflow References

These upstream repositories are local, read-only references for studying open-source AI video-generation workflows. Their source trees are intentionally ignored by the parent repository; use each project’s own Git history and documentation when researching it.

| Directory | GitHub | Primary purpose |
| --- | --- | --- |
| `MoneyPrinterTurbo/` | [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | Automated short-video production from scripts, including media search, narration, subtitles, and rendering. |
| `pyvideotrans/` | [jianchang512/pyvideotrans](https://github.com/jianchang512/pyvideotrans) | Video translation and localization workflows, including transcription, translation, dubbing, and subtitle processing. |
| `NarratoAI/` | [linyqh/NarratoAI](https://github.com/linyqh/NarratoAI) | AI-assisted creation of narrated videos from a topic or script, with story, voice, visuals, and assembly steps. |
| `MoneyPrinter/` | [FujiwaraChoki/MoneyPrinter](https://github.com/FujiwaraChoki/MoneyPrinter) | Automated faceless-video generation workflow combining text, voice, images, and video composition. |
| `ShortGPT/` | [RayVentura/ShortGPT](https://github.com/RayVentura/ShortGPT) | Framework for programmatically generating short-form videos from scripts and reusable media-generation agents. |
| `whisperX/` | [m-bain/whisperX](https://github.com/m-bain/whisperX) | Fast speech-to-text transcription with word-level timestamps, alignment, and speaker diarization support. |
| `edge-tts/` | [rany2/edge-tts](https://github.com/rany2/edge-tts) | Python interface and command-line tooling for Microsoft Edge’s online text-to-speech service. |
| `F5-TTS/` | [SWivid/F5-TTS](https://github.com/SWivid/F5-TTS) | Zero-shot text-to-speech and voice-cloning research implementation based on flow-matching models. |
| `GPT-SoVITS/` | [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | Few-shot and zero-shot voice-cloning and text-to-speech toolkit with speech preprocessing and inference tooling. |
| `story-claw/` | [ZC89757/story-claw](https://github.com/ZC89757/story-claw) | Story and content-generation workflow reference for developing narrative-driven media. |

## Handling rules

- Treat every directory in this folder as an upstream, read-only reference.
- Do not commit files from the cloned project directories; the parent repository ignores those trees. This catalog README is the intentional exception and may be tracked.
- Make research notes and architecture conclusions in the parent repository’s `docs/` directory, not inside upstream clones.
