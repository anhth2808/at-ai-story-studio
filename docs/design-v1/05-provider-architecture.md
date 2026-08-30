# Provider Architecture

## Principle

Workflow steps request capabilities; adapters translate them into provider SDK, HTTP, or external-process behavior. Provider IDs, models, credentials, limits, transient errors, and response formats never appear in workflow definitions.

## Common contracts

All providers expose a descriptor and health operation:

```text
ProviderDescriptor
- id, displayName, kind, version
- locality: Local | FreeRemote | PaidRemote
- capabilities and supported languages/formats
- limits: max characters/tokens/bytes/duration, concurrency
- cost metadata: Free | Cheap | Premium + optional estimate unit
- requiresNetwork, requiresGpu, supportsCancellation
```

Common request envelope: project ID, attempt/idempotency key, model/voice choice, normalized settings, input asset references, timeout, cancellation token, and trace context. Common result: normalized output payload/asset candidates, timing/usage/cost metadata, provider request ID, warnings, and raw diagnostic reference when safe.

Provider adapters classify errors (`Transient`, `RateLimited`, `Authentication`, `InvalidInput`, `ContentPolicy`, `ResourceExhausted`, `Unavailable`, `Unknown`) and state whether retry may help. The workflow engine owns scheduling; the adapter owns provider semantics.

## Interfaces

Conceptual C# contracts, not implementation code:

- **`ILLMProvider`** — `GenerateText`, `GenerateStructured(schema)`, model/capability listing, token estimates where available. Structured generation returns validated JSON or a normalized validation failure.
- **`ITTSProvider`** — `ListVoices`, `Synthesize(TtsRequest)`. Result supplies audio plus optional word/sentence boundaries. Capability flags cover SSML, voice cloning, streaming, languages, and formats.
- **`IASRProvider`** — `Transcribe(AsrRequest)`. Result contains language, segments, optional word/character timings and speakers.
- **`IImageProvider`** — `Generate(ImageRequest)` with dimensions, prompt, seed/reference capabilities; not required in V1.
- **`IVideoProvider`** — `Generate(VideoRequest)` and optional asynchronous remote-job resume; not required in V1.
- **`ITranslationProvider`** — text/segment translation preserving IDs and optional glossary; not required in V1.

FFmpeg is a media tool adapter (`IMediaTool`/process runner), not an AI provider. Uploaded backgrounds are assets, not providers.

## Registration and selection

Compile explicit adapters into the application; do not create a runtime plugin loader in V1. A registry maps provider kind + ID to a factory and descriptor. `ProviderConfiguration` names the adapter, model/voice defaults, non-secret settings, secret references, enabled flag, and cost tier. Project configuration pins a provider-configuration revision.

Selection is explicit by default. Optional fallback chains must be user-configured and become part of the input fingerprint; the attempt records the adapter actually used. Never silently move from local/free to a paid provider.

## Cost tiers

| Tier | Behavior | Examples |
|---|---|---|
| Local | no per-call fee; hardware/setup cost; may be slow | Ollama, F5-TTS, GPT-SoVITS, WhisperX, future ComfyUI |
| Free remote | no configured charge, but network/terms/quota risk | Edge TTS |
| Cheap API | explicit budget/usage display and caps | DeepSeek or compatible economical LLM endpoints |
| Premium API | opt-in per project/operation; estimate before batch | OpenAI/Gemini and premium voice/image/video APIs |

Before a 100-chapter batch, the UI shows provider, model, count, and an estimate when calculable. Unknown cost is displayed as unknown, never as free.

## First implementations

### V1 required

1. **Ollama LLM — first local LLM.** Simple local HTTP, no cloud key, validates provider separation. Quality/model availability varies.
2. **OpenAI-compatible LLM — second.** One adapter can cover DeepSeek and many hosted/self-hosted endpoints when their behavior is genuinely compatible. Provider quirks belong in configuration/sub-adapters, not `if provider == ...` in story code.
3. **Edge TTS external adapter — first narration path.** Fast, no local GPU, useful boundary timing. Treat it as an unofficial remote dependency with service/terms risk; wrap the installed tool/process rather than copying LGPL implementation.
4. **FFmpeg/ffprobe local adapter.** Required media boundary and health diagnostics.

### V1 optional / next

5. **F5-TTS local sidecar** for private zero-shot narration/voice conditioning. Wrap a pinned Python environment/HTTP service; process startup and model lifetime stay outside .NET request handling.
6. **WhisperX local sidecar** for optional alignment/ASR quality mode. Not required for default subtitles.
7. **GPT-SoVITS local service** for users who need mature multilingual/Chinese voice cloning; heavier setup makes it optional after F5-TTS.

### Later

Gemini/OpenAI native adapters where structured output or multimodal capabilities justify them; `IImageProvider` for ComfyUI; `IVideoProvider` for image-to-video. Implement native adapters when OpenAI-compatible emulation loses required semantics.

## External Python process/service pattern

- Adapter owns executable/base URL and health/version discovery.
- Inputs/outputs use JSON manifests and managed file paths, never ad-hoc stdout parsing for domain data.
- Process launched without a shell, with explicit environment and working directory.
- Stdout/stderr captured as bounded/redacted attempt logs.
- Model sidecars may be long-lived and resource-leased; one-shot CLIs are acceptable for Edge TTS.
- Cancellation terminates the process tree or calls the remote job cancel endpoint.

## Secret and network policy

Non-secret configuration is stored in SQLite. Secret values live in an OS-protected secret store; database rows contain secret keys/references. API responses return only `isConfigured`. Logs redact headers, tokens, signed URLs, and source prose. Each provider descriptor declares whether network access is required.

## Decision: narrow compiled adapters, no plugin platform

- **Alternatives:** provider logic in services; dynamic assembly/Python plugins; separate microservice per provider.
- **Why:** explicit adapters keep contracts testable and deployment understandable for one developer.
- **Trade-offs:** adding a provider requires a build; capability negotiation must be designed carefully.
- **Future impact:** adapters can move out of process later without changing application-facing contracts.
