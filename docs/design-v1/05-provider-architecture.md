# Provider Architecture

## Principle

Application features request capabilities through narrow application contracts. LLM and agent work follows one dedicated path:

```text
Application feature
  -> AiAgent
    -> OmpAgent
      -> OMP SDK
        -> configured model/provider
```

AI Story Studio does not build an application-owned family of `OpenAIProvider`, `GeminiProvider`, `AnthropicProvider`, `DeepSeekProvider`, `OllamaProvider`, or similar LLM implementations when OMP already supplies the required provider and model capability. Domain, workflow, and feature code never depend directly on OMP SDK types.

Specialized media capabilities remain separate provider contracts. OMP does not replace TTS, ASR/WhisperX, image or video generation APIs, ComfyUI execution, FFmpeg/ffprobe, filesystem, database, job execution, or the workflow state machine.

The main application remains TypeScript-first. A feature being AI-related is not sufficient reason to add Python.

## Thin application AI contract

`AiAgent` is an application boundary, not another generic LLM framework. A request contains the feature operation, versioned instructions, deterministic context, optional feature-owned structured-output schema, execution-configuration revision, deadline, `AbortSignal`, and trace context. A result contains Zod-validated feature data plus safe effective model/provider, timing, usage/cost, terminal reason, and trace metadata when OMP exposes them.

`OmpAgent` is the primary implementation. It owns:

- OMP SDK session creation and disposal;
- configured model and authentication resolution;
- restricted tools, skills, context, commands, MCP, LSP, and other ambient capabilities;
- structured completion collection and Zod validation;
- deadline and cancellation propagation;
- event and telemetry translation;
- normalized errors and bounded safe diagnostics.

The persisted worker owns the durable attempt ID, status, retries, cancellation request, dependencies, invalidation, input fingerprint, cost policy, and result commit. One OMP session belongs to one durable AI attempt. OMP history may be retained only as a bounded diagnostic artifact; it is never project or workflow state.

State-changing AI operations require a terminal structured result validated by the feature's Zod schema. Invalid JSON, schema mismatch, missing terminal output, truncation, content-policy refusal, timeout, or cancellation becomes a normalized failed attempt. A bounded repair turn is allowed only when the feature explicitly defines it.

Headless application sessions use explicit configuration and the minimum reviewed tool set. OMP SDK discovery defaults are not the application security policy. Ambient project skills, context files, slash commands, extensions, custom tools, MCP servers, LSP, shell, filesystem mutation, subagent spawning, and interactive prompts remain disabled unless the feature deliberately requires them. Secrets and source prose never enter ordinary logs.

## OMP SDK runtime boundary

The current official OMP SDK documentation requires Bun 1.3.14 or newer and explicitly states that it is not a Node.js SDK. Node.js LTS remains authoritative for the API, worker, workflow, persistence, and orchestration layers. Until a pinned compatibility spike establishes another supported option, a small isolated Bun-hosted `OmpAgent` process imports and runs OMP SDK in-process while the Node.js worker calls the thin adapter through a typed, versioned local protocol.

This process is not a provider framework or a second workflow engine. It exposes only execute, cancel, health/version, and bounded diagnostic behavior; accepts no arbitrary user filesystem paths or shell command strings; and owns no durable application state. If a future OMP SDK officially supports the Node.js runtime, `OmpAgent` may move in-process without changing `AiAgent`.

Pin the OMP SDK version and record its license. Before an upgrade, review the SDK changelog and run a boundary compatibility check covering session creation, explicit model configuration, restricted discovery/tools, structured terminal output, deadline expiry, cancellation, disposal, event capture, and error translation.

## Specialized provider contracts

Specialized providers expose a descriptor and health operation:

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

Specialized provider adapters classify errors (`Transient`, `RateLimited`, `Authentication`, `InvalidInput`, `ContentPolicy`, `ResourceExhausted`, `Unavailable`, `Unknown`) and state whether retry may help. The workflow engine owns scheduling and durable attempt policy; the adapter owns provider semantics.

## TypeScript interfaces

Conceptual specialized contracts, not implementation code:

- **`TTSProvider`** - `listVoices`, `synthesize(TtsRequest)`. The result supplies audio plus optional word/sentence boundaries. Capability flags cover SSML, voice cloning, streaming, languages, and formats.
- **`ASRProvider`** - `transcribe(AsrRequest)`. The result contains language, segments, optional word/character timings, and speakers.
- **`ImageProvider`** - `generate(ImageRequest)` with dimensions, prompt, seed/reference capabilities; not required in V1.
- **`VideoProvider`** - `generate(VideoRequest)` and optional asynchronous remote-job resume; not required in V1.
- **`TranslationProvider`** - text/segment translation preserving IDs and optional glossary; not required in V1.

Provider-facing request and result schemas use Zod where runtime validation matters, especially across HTTP, sidecar, or external-process boundaries. Internal domain and persistence types are not part of these contracts.

FFmpeg is a media tool adapter behind the centralized process runner, not an AI provider. Uploaded backgrounds are assets, not providers.

## Registration and selection

Compile explicit specialized adapters into the application; do not create a runtime plugin loader in V1. A registry maps provider kind + ID to a factory and descriptor. `ProviderConfiguration` names the adapter, model/voice defaults, non-secret settings, secret references, enabled flag, and cost tier. Project configuration pins a provider-configuration revision.

OMP owns its provider/model catalog and execution details. AI Story Studio stores an application-safe OMP execution-configuration revision and the effective model/provider identity needed for fingerprints, cost display, audit, and retry decisions. It does not mirror OMP's provider implementations into application classes.

Selection is explicit by default. Optional fallback chains must be user-configured and become part of the input fingerprint; the attempt records the implementation and effective model/provider actually used. Never silently move from local/free to a paid provider.

## Implementation forms and preference order

Specialized provider implementations may be Node-native, remote HTTP APIs, existing service APIs, isolated Python sidecars, or controlled subprocesses. Choose in this order:

1. **Native TypeScript/Node integration.** Use a mature Node SDK or protocol implementation when it provides the required specialized capability without compromising the boundary.
2. **External HTTP API.** Prefer a stable provider API over embedding another runtime.
3. **Existing service API.** Integrate services such as ComfyUI through their supported API rather than embedding them in the Node.js process.
4. **Small isolated Python sidecar.** Use for stateful models or libraries that are substantially easier or only practical in Python.
5. **Python subprocess.** Use for bounded one-shot work when process startup cost, cancellation, and file-based results are appropriate.

Node.js always owns project state, workflow state, retries, job claiming, provider selection policy, asset tracking, lineage, and orchestration. A Python component owns only model loading, inference, and model-specific preprocessing/postprocessing. The Bun-hosted OMP adapter owns only OMP SDK execution and translation.

## Cost tiers

| Tier | Behavior | Examples |
|---|---|---|
| Local | no per-call fee; hardware/setup cost; may be slow | F5-TTS, GPT-SoVITS, WhisperX, future ComfyUI |
| Free remote | no configured charge, but network/terms/quota risk | Edge TTS |
| Cheap API | explicit budget/usage display and caps | economical voice, image, or video APIs |
| Premium API | opt-in per project/operation; estimate before batch | premium voice, image, or video APIs |

OMP-configured LLM models follow the same Local -> Free remote -> Cheap API -> Premium API preference and explicit cost policy without application-owned provider implementations. Before a large AI batch, the UI shows the effective OMP model/provider, count, and an estimate when calculable. Unknown cost is displayed as unknown, never as free.

## First implementations

### V1 required

1. **Edge TTS external adapter - first narration path.** Fast, no local GPU, useful boundary timing. Treat it as an unofficial remote dependency with service/terms risk; wrap the installed tool or process rather than copying implementation.
2. **FFmpeg/ffprobe local adapter.** Required media boundary and health diagnostics.

No LLM or agent integration is required before FIRST WORKING VIDEO. When an intelligent story feature enters scope, its first and primary execution implementation is the OMP-backed `OmpAgent`, not an application-owned model-provider adapter.

### V1 optional / next

3. **F5-TTS Python sidecar** for private zero-shot narration and voice conditioning. Use a pinned, versioned local HTTP service so model lifetime stays outside Fastify and the Node.js worker.
4. **WhisperX Python sidecar** for optional alignment/ASR quality mode. Not required for default subtitles.
5. **GPT-SoVITS local service** for users who need mature multilingual voice cloning; heavier setup makes it optional after F5-TTS.

### Later

Use OMP-configured models for story analysis, adaptation, blueprint generation, character extraction, chapter planning and writing, summarization, continuity analysis, scene and shot planning, prompt generation, and quality evaluation. Add `ImageProvider` for ComfyUI and `VideoProvider` for image-to-video when those specialized capabilities enter scope.

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

Non-secret specialized-provider and OMP execution configuration is stored in SQLite. Secret values live in an OS-protected secret store or OMP's supported credential storage; database rows contain only secret keys, references, or safe configuration identifiers. API responses return only `isConfigured`. Logs redact headers, tokens, signed URLs, source prose, and raw provider payloads. Each specialized provider descriptor and OMP execution configuration declares whether network access is required.

## Decision: OMP for agents, narrow adapters for specialized media

- **Alternatives:** provider logic in workflow services; an application-owned LLM provider hierarchy; direct OMP SDK imports throughout feature code; dynamic plugin framework; Python-first backend; separate service per specialized provider.
- **Why:** OMP already owns broad model/provider execution, while the thin `AiAgent` boundary protects application code and explicit specialized TypeScript contracts keep media orchestration consistent.
- **Trade-offs:** OMP becomes a load-bearing pinned dependency; the current Bun-only SDK requires an isolated host; common specialized contracts can hide unique features; sidecars require version and lifecycle management.
- **Future impact:** OMP models/providers can change without workflow rewrites; specialized adapters can move between Node-native, external API, ComfyUI, or Python sidecar implementations; the thin boundary preserves an escape hatch if OMP later stops meeting a concrete requirement.
