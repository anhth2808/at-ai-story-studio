# Provider Matrix

Cost labels are operational guidance, not pricing guarantees: **free/local** means no per-call API charge after hardware/model access; **freemium** means a service may offer limited quota; **paid** means a key/account is normally required. All providers remain subject to their current terms and model licenses.

## LLM

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| Ollama | MoneyPrinter, MoneyPrinterTurbo | Local | Local HTTP, no cloud key | Free/local | Ollama client in `MoneyPrinter/Backend/gpt.py:15-21`; registry ID in `MoneyPrinterTurbo/app/models/llm_provider.py:385-406` |
| OpenAI | MoneyPrinterTurbo, NarratoAI, story-claw | Cloud | Key | Paid | OpenAI-compatible adapters; story-claw `agent.ts:30-37` |
| Anthropic Claude | MoneyPrinterTurbo, NarratoAI, story-claw | Cloud | Key | Paid | Provider registry / agent model format |
| Google Gemini | MoneyPrinterTurbo, NarratoAI, story-claw | Cloud | Key | Freemium/paid | Protocol adapter; `NarratoAI/app/services/llm/manager.py` |
| DeepSeek | MoneyPrinterTurbo, NarratoAI, pyvideotrans | Cloud | Key | Paid/low-cost | OpenAI-compatible or named adapter |
| Qwen/Alibaba | MoneyPrinterTurbo, NarratoAI, pyvideotrans | Cloud | Key | Paid | Named adapter or OpenAI-compatible gateway |
| Moonshot/Kimi | MoneyPrinterTurbo, NarratoAI | Cloud | Key | Paid | Registry endpoint metadata (`app/models/llm_provider.py:187-227`) |
| Azure OpenAI | MoneyPrinterTurbo, pyvideotrans | Cloud | Key/endpoint | Paid | Named adapter/translator channel |
| VolcEngine/Doubao Ark | MoneyPrinterTurbo | Cloud | Ark key | Paid | LLM provider registry and Seedance material service |
| Grok/xAI | MoneyPrinterTurbo | Cloud | Key | Paid | OpenAI-compatible registry entry |
| MiniMax / MiMo | MoneyPrinterTurbo | Cloud | Key | Paid | Registry entries and dedicated TTS branches |
| OpenRouter | MoneyPrinterTurbo, NarratoAI, pyvideotrans | Cloud gateway | Key | Paid/freemium models | OpenAI-compatible adapter/translator registry |
| LiteLLM | MoneyPrinterTurbo, pyvideotrans | Local gateway or cloud | Optional key | Free/local or pass-through paid | Named adapter/translator backend |
| Groq | MoneyPrinterTurbo | Cloud | Key | Freemium/paid | OpenAI-compatible registry entry |
| ModelScope | MoneyPrinterTurbo | Cloud | Key | Paid/limited | Named adapter |
| Cloudflare AI Gateway | MoneyPrinterTurbo | Cloud gateway | Key/account/gateway IDs | Paid/pass-through | Dedicated adapter with extra fields |
| SiliconFlow | NarratoAI, pyvideotrans | Cloud | Key | Paid/low-cost | OpenAI-compatible provider |
| TwelveLabs Pegasus | NarratoAI | Cloud video understanding | Key | Freemium/paid | `create_vision_analyzer` native provider (`frame_analysis_service.py:137-143`) |

## TTS

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| Edge TTS / Microsoft Edge service | MoneyPrinterTurbo, pyvideotrans, NarratoAI, ShortGPT, edge-tts | Cloud service | No conventional key; network required | Freemium/service-dependent | `edge_tts.Communicate`; wrappers in project voice modules |
| Azure Speech | MoneyPrinterTurbo, pyvideotrans, NarratoAI | Cloud | Speech key/region | Paid | Dedicated voice functions/provider branches |
| OpenAI TTS | MoneyPrinterTurbo, pyvideotrans | Cloud | Key | Paid | TTS registry/HTTP SDK |
| Gemini TTS | MoneyPrinterTurbo, pyvideotrans | Cloud | Key | Paid | Voice prefix dispatch / registry |
| ElevenLabs | MoneyPrinterTurbo, pyvideotrans, ShortGPT | Cloud | Key | Paid/freemium | Dedicated API voice modules |
| MiniMax TTS | MoneyPrinterTurbo, pyvideotrans | Cloud | Key | Paid | Dedicated HTTP branch |
| Qwen TTS | MoneyPrinterTurbo, pyvideotrans, NarratoAI | Cloud or local pack | Key for cloud; local endpoint otherwise | Paid or local | TTS registry/configured HTTP endpoint |
| Doubao TTS | pyvideotrans, NarratoAI, story-claw | Cloud | Key/resource ID | Paid | Provider branch; story-claw `render.ts:826-887` |
| Tencent TTS | pyvideotrans, NarratoAI | Cloud | Secret ID/key | Paid | Named TTS provider |
| F5-TTS | pyvideotrans, F5-TTS | Local | No runtime API key; checkpoints | Free/local | CLI/inference functions; pyvideotrans registry |
| GPT-SoVITS | pyvideotrans, GPT-SoVITS | Local HTTP/process | No cloud key; local model | Free/local | FastAPI `/tts` (`api_v2.py:455-515`) |
| CosyVoice | pyvideotrans | Local/API | Local endpoint/model | Free/local | TTS registry |
| Chatterbox | MoneyPrinterTurbo, pyvideotrans | Local/API | Local service/model | Free/local | Voice prefix / TTS registry |
| Fish Audio | MoneyPrinterTurbo, pyvideotrans | Cloud/API | Key for hosted API | Paid/freemium | Dedicated HTTP branch |
| Kokoro, Piper, ChatTTS, OmniVoice, Supertonic, VITS, VoxCPM, IndexTTS | pyvideotrans, NarratoAI for several packs | Local or local HTTP | Usually none; model/pack | Free/local | TTS registry and HTTP adapter branches |
| TikTok voice | MoneyPrinter | Cloud/service endpoint | Service-dependent | Service-dependent | `Backend/tiktokvoice.py` direct implementation |

## ASR

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| faster-whisper / Whisper | whisperX, pyvideotrans, ShortGPT, F5-TTS optional reference ASR | Local | Model download/cache | Free/local | `whisperX/asr.py:315-442`; project wrappers |
| WhisperX alignment + pyannote | whisperX, pyvideotrans optional | Local model; HF access | HF token may be required | Free/local after access | `transcribe_task` staged ASR/alignment/diarization |
| FunASR/Paraformer/FireRed/Parakeet/Qwen ASR | pyvideotrans | Local | Model/cache | Free/local | Numeric recognition registry |
| FunASR/FireRed local packs | NarratoAI | Local HTTP | Local endpoint | Free/local | `fun_asr_subtitle.py` and config |
| OpenAI Whisper API | pyvideotrans | Cloud | Key | Paid | Recognition provider registry |
| Gemini/Google/Deepgram/ElevenLabs/Xiaomi/GLM/AI302/custom APIs | pyvideotrans | Cloud | Provider key | Paid/freemium | Recognition registry adapters |
| AssemblyAI | MoneyPrinter | Cloud | Key | Paid/freemium | `Backend/video.py:49-78` optional subtitle branch |

## Translation

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| Google/Microsoft | pyvideotrans | Cloud | Key or public service | Paid/freemium | Translator registry |
| DeepL/DeepLX | pyvideotrans | Cloud/self-hosted gateway | Key for DeepL; endpoint for DeepLX | Paid or local gateway | Named translator adapters |
| OpenAI/ChatGPT, DeepSeek, Gemini, Qwen, OpenRouter, LiteLLM | pyvideotrans | Cloud/gateway | Usually key | Paid/freemium | LLM-backed translation registry |
| LibreTranslate/M2M100 | pyvideotrans | Self-hosted/local or cloud | Optional endpoint/key | Free/local or paid | Translator adapters |
| Tencent/Baidu/Ali/MiniMax/Xiaomi/VolcEngine | pyvideotrans | Cloud | Key | Paid | Named adapters |
| NarratoAI subtitle translator | NarratoAI | Configured LLM/cloud | Text LLM key | Paid or gateway | `app/services/subtitle_translator.py` plus LLM manager |

## Image Generation

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| GPT image helper | story-claw | Cloud | Key | Paid | Python helper `utils/gpt-image-gen.py`, called by `runner/render.ts:612-678` |
| Gemini image helper | story-claw | Cloud | Key | Paid/freemium | `utils/gemini-image-gen.py` fallback |
| Local reference images | story-claw | Local | None | Free/local | Workspace character/scene catalog |

## Video Generation

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| ComfyUI + LTX workflow | story-claw | Local or remote GPU | ComfyUI endpoint; model workflow | Free/local or GPU cost | Workflow JSON injection/history polling (`render.ts:687-755`) |
| WaveSpeed text-to-video | MoneyPrinterTurbo | Cloud | API key | Paid | `material.py:608-989` returns `MaterialInfo` |
| Volcano Seedance/Ark | MoneyPrinterTurbo | Cloud | Ark key | Paid | `material.py:1362-1472` on-demand material path |
| Stock video APIs | MoneyPrinterTurbo, MoneyPrinter, ShortGPT | Cloud download | Pexels/Pixabay/Coverr key as configured | Freemium/paid terms | Material/search adapters |

## Music

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| Local BGM/song directories | MoneyPrinter, MoneyPrinterTurbo, NarratoAI, story-claw | Local | None | Free/local | Filesystem selection and FFmpeg/MoviePy mixing |
| ElevenLabs Music | MoneyPrinterTurbo | Cloud | Key | Paid | `elevenlabs_music.py` provider interface |
| Sonilo BGM/SFX | NarratoAI | Cloud | Key | Paid/freemium | `sonilo.py`, task-level fallback |
| story-claw BGM generator | story-claw | Local/external helper depending config | Configured helper | Variable | `utils/generate-bgm.ts` and postprocess |

## Stock Media

| Provider | Projects | Local/cloud | API required | Cost class | Abstraction |
|---|---|---|---|---|---|
| Pexels | MoneyPrinter, MoneyPrinterTurbo, ShortGPT | Cloud | API key | Freemium/terms | Search adapters (`MoneyPrinter/Backend/search.py`, `MoneyPrinterTurbo/app/services/material.py`) |
| Pixabay | MoneyPrinterTurbo | Cloud | API key | Freemium/terms | `material.py:378-501` |
| Coverr | MoneyPrinterTurbo | Cloud | API/service access | Freemium/terms | `material.py:504-605` |
| Local uploaded materials | MoneyPrinterTurbo, NarratoAI | Local | None | Free/local | Material/task directories and validation |
