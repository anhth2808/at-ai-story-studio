# Provider Architecture

## Principle

Workflow steps request capabilities; adapters translate them into Node-native SDK, HTTP, existing service API, or external-process behavior. Provider IDs, models, credentials, limits, transient errors, and response formats never appear in workflow definitions.

The main application remains TypeScript-first. A feature being AI-related is not sufficient reason to add Python.

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

Common request envelope: project ID, attempt/idempotency key, model/voice choice, normalized settings, input asset references, timeout, `AbortSignal`, and trace context. Common result: normalized output payload or asset candidates, timing/usage/cost metadata, provider request ID, warnings, and a raw diagnostic reference when safe.

Provider adapters classify errors (`Transient`, `RateLimited`, `Authentication`, `InvalidInput`, `ContentPolicy`, `ResourceExhausted`, `Unavailable`, `Unknown`) and state whether retry may help. The workflow engine owns scheduling and durable attempt policy; the adapter owns provider semantics.

## TypeScript interfaces

Conceptual contracts, not implementation code:

- **`LLMProvider`** - `generateText`, `generateStructured(schema)`, model/capability listing, token estimates where available. Structured generation returns validated data or a normalized validation failure.
- **`TTSProvider`** - `listVoices`, `synthesize(TtsRequest)`. The result supplies audio plus optional word/sentence boundaries. Capability flags cover SSML, voice cloning, streaming, languages, and formats.
- **`ASRProvider`** - `transcribe(AsrRequest)`. The result contains language, segments, optional word/character timings, and speakers.
- **`ImageProvider`** - `generate(ImageRequest)` with dimensions, prompt, seed/reference capabilities; not required in V1.
- **`VideoProvider`** - `generate(VideoRequest)` and optional asynchronous remote-job resume; not required in V1.
- **`TranslationProvider`** - text/segment translation preserving IDs and optional glossary; not required in V1.

Provider-facing request and result schemas may use Zod for runtime validation, especially across HTTP, sidecar, or external-process boundaries. Internal domain and persistence types are not part of these contracts.

FFmpeg is a media tool adapter behind the centralized process runner, not an AI provider. Uploaded backgrounds are assets, not providers.

## Registration and selection

Compile explicit adapters into the application; do not create a runtime plugin loader in V1. A registry maps provider kind + ID to a factory and descriptor. `ProviderConfiguration` names the adapter, model/voice defaults, non-secret settings, secret references, enabled flag, and cost tier. Project configuration pins a provider-configuration revision.

Selection is explicit by default. Optional fallback chains must be user-configured and become part of the input fingerprint; the attempt records the adapter actually used. Never silently move from local/free to a paid provider.

## Implementation forms and preference order

Provider implementations may be Node-native, remote HTTP APIs, existing service APIs, isolated Python sidecars, or controlled subprocesses. Choose in this order:

1. **Native TypeScript/Node integration.** Use a mature Node SDK or protocol implementation when it provides the required capability without compromising the boundary.
2. **External HTTP API.** Prefer a stable provider API over embedding another runtime.
3. **Existing service API.** Integrate services such as ComfyUI through their supported API rather than embedding them in the Node.js process.
4. **Small isolated Python sidecar.** Use for stateful models or libraries that are substantially easier or only practical in Python.
5. **Python subprocess.** Use for bounded one-shot work when process startup cost, cancellation, and file-based results are appropriate.

Node.js always owns project state, workflow state, retries, job claiming, provider selection, asset tracking, lineage, and orchestration. A Python component owns only model loading, inference, and model-specific preprocessing/postprocessing.

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

1. **Ollama LLM - first local LLM.** Simple local HTTP, no cloud key, validates provider separation. Quality/model availability varies.
2. **OpenAI-compatible LLM - second.** One adapter can cover DeepSeek and many hosted/self-hosted endpoints when their behavior is genuinely compatible. Provider quirks belong in configuration or focused sub-adapters, not provider checks in story code.
3. **Edge TTS external adapter - first narration path.** Fast, no local GPU, useful boundary timing. Treat it as an unofficial remote dependency with service/terms risk; wrap the installed tool or process rather than copying implementation.
4. **FFmpeg/ffprobe local adapter.** Required media boundary and health diagnostics.

### V1 optional / next

5. **F5-TTS Python sidecar** for private zero-shot narration and voice conditioning. Use a pinned, versioned local HTTP service so model lifetime stays outside Fastify and the Node.js worker.
6. **WhisperX Python sidecar** for optional alignment/ASR quality mode. Not required for default subtitles.
7. **GPT-SoVITS local service** for users who need mature multilingual voice cloning; heavier setup makes it optional after F5-TTS.

### Later

Add Gemini/OpenAI native adapters where structured output or multimodal capabilities justify them; add `ImageProvider` for ComfyUI and `VideoProvider` for image-to-video. Implement native adapters when OpenAI-compatible emulation loses required semantics.

## Versioned sidecar contract

A long-lived Python sidecar exposes an explicit versioned HTTP contract, for example:

```text
Node workflow
  -> POST /v1/synthesize
     request: attemptId, input asset references, voice/model settings
  <- result: audio asset candidate, duration, model/version metadata, warnings
```

Contract rules:

- version request and response schemas independently from the provider implementation package;
- validate request and response bodies at both boundaries;
- exchange managed workspace file references or streamed bytes, never arbitrary filesystem paths supplied by a user;
- expose health, readiness, model/version, and capability discovery;
- propagate correlation and idempotency keys;
- support cancellation when the model/runtime permits it and report unsupported cancellation explicitly;
- keep stdout/stderr and model diagnostics bounded, structured where practical, and separate from domain data.

One-shot Python tools use the same versioned JSON manifest principles through the centralized shell-free process runner. Ad-hoc stdout parsing is not a domain protocol.

## ComfyUI integration

ComfyUI normally runs as an external service. A future `ImageProvider` or `VideoProvider` submits a versioned workflow through the ComfyUI API, records the remote prompt/job identifier as a checkpoint, polls or receives completion, imports produced files into the managed asset store, and normalizes errors and progress.

Do not embed ComfyUI, its Python runtime, or model lifecycle into the API or worker process. Do not make ComfyUI node graphs part of provider-independent workflow definitions.

## External process pattern

- Adapter owns executable path or base URL and health/version discovery.
- Processes launch through the centralized runner with an executable and separate argument array; shell mode remains disabled.
- Inputs and outputs use JSON manifests and managed file references.
- Stdout/stderr are captured separately, bounded, and redacted before attempt logging.
- Timeout and `AbortSignal` terminate the process tree gracefully, then force termination after a bounded grace period.
- Model sidecars may be long-lived and resource-leased; one-shot CLIs are acceptable only when their startup/lifecycle cost fits the operation.

## Secret and network policy

Non-secret configuration is stored in SQLite. Secret values live in an OS-protected secret store; database rows contain secret keys or references. API responses return only `isConfigured`. Logs redact headers, tokens, signed URLs, and source prose. Each provider descriptor declares whether network access is required.

## Decision: narrow adapters, explicit runtime boundaries

- **Alternatives:** provider logic in workflow services; dynamic plugin framework; Python-first backend; separate service per provider.
- **Why:** explicit TypeScript contracts keep workflow orchestration consistent while allowing the best practical runtime behind each adapter.
- **Trade-offs:** adding a provider requires a build; common contracts can hide unique features; sidecars require version and lifecycle management.
- **Future impact:** adapters can move between Node-native, external API, ComfyUI, or Python sidecar implementations without changing workflow definitions.
