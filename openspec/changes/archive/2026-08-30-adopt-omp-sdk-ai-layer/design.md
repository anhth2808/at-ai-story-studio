## Context

The current V1 design has two conflicting directions. Story features call a generic `LLMProvider`, while provider architecture recommends first-party Ollama and OpenAI-compatible implementations. The new decision requires OMP SDK to supply primary LLM and agent execution without giving OMP ownership of durable product state or coupling feature code to SDK types.

Research used the current published `@oh-my-pi/pi-coding-agent` package at version 18.0.11 and its SDK examples. The published surface uses `createAgentSession()`, model/auth discovery or explicit `AuthStorage` and `ModelRegistry`, session events, `session.prompt()`, `session.abort()`, and `session.dispose()`. Current session creation options expose an absolute `deadline`, OpenTelemetry configuration, and structured completion options (`outputSchema`, enforcement mode, and yield behavior). The package currently declares Bun 1.3.14 or later as its runtime, while AI Story Studio's primary backend remains Node.js LTS.

## Goals / Non-Goals

**Goals:**

- Establish one thin application-owned AI execution contract and one OMP-backed adapter.
- Preserve AI Story Studio as the source of truth for durable workflow state, retries, dependencies, invalidation, assets, and project persistence.
- Define safe structured-output, timeout, cancellation, configuration, observability, and error boundaries.
- Remove architecture text that directs the application to build provider-specific LLM adapters.
- Make the current Bun runtime constraint visible rather than assuming Node compatibility.

**Non-Goals:**

- Implement the future AI boundary or add the OMP dependency in this documentation change.
- Define a generic agent framework, prompt DSL, plugin system, or application-owned model catalog.
- Route deterministic or specialized media operations through OMP.
- Move advanced story generation into the current FIRST WORKING VIDEO implementation milestone.
- Make OMP session storage authoritative for product workflows or project state.

## Decisions

### 1. Use a narrow feature-facing `AiAgent` contract

Application features depend on a small operation contract that accepts a feature-owned instruction/context payload, an optional structured-output schema, execution configuration, a deadline, an `AbortSignal`, and trace metadata. It returns validated feature data plus safe execution metadata or a normalized application error.

The only primary implementation is `OmpAgent`, which translates that request to OMP SDK. Feature code does not import OMP models, sessions, events, errors, tools, auth types, or provider identifiers.

Alternatives considered:

- Domain code calling OMP SDK directly. Rejected because it spreads volatile SDK types and makes testing, cancellation, error translation, and future replacement expensive.
- A broad `LLMProvider` hierarchy with OpenAI, Gemini, Anthropic, DeepSeek, Ollama, and similar adapters. Rejected because it duplicates OMP's provider/model layer.
- A second generic agent framework around OMP. Rejected because the boundary only needs application policy and translation.

### 2. Keep specialized provider contracts separate

`TTSProvider`, `ASRProvider`, `ImageProvider`, `VideoProvider`, and `TranslationProvider` remain explicit specialized contracts. FFmpeg/ffprobe, ComfyUI execution, filesystem, database, workflow engine, and job worker remain deterministic infrastructure or dedicated provider integrations.

`LLMProvider` is removed from the common specialized-provider list. Cost-tier examples and first implementation recommendations no longer name application-owned Ollama or OpenAI-compatible LLM adapters. OMP configuration supplies LLM provider/model selection.

Alternative considered: route every AI-branded integration through OMP. Rejected because orchestration agents do not replace media APIs, model-specific inference services, binary process control, or durable state machines.

### 3. One OMP session belongs to one durable AI attempt

The worker remains authoritative for the attempt ID, status, retry count, deadline, cancellation, input fingerprint, and result commit. `OmpAgent` creates or resumes only the SDK state needed for that attempt, observes execution, extracts the result, and disposes the session.

OMP session history may be retained as a bounded diagnostic artifact when policy permits, but it is not the source of truth for project or workflow state. Automatic OMP retries or fallback behavior must not create hidden durable attempts or silently cross a user cost boundary. The application records the effective model/provider/configuration identity made available by OMP in the attempt metadata and input fingerprint.

Alternative considered: model the project workflow as a long-lived OMP conversation. Rejected because restart recovery, exact invalidation, independent retry, and asset lineage belong to AI Story Studio.

### 4. Structured output is mandatory where domain state is updated

Each intelligent feature owns a Zod schema and a versioned prompt/output contract. `OmpAgent` requests structured completion through the current supported OMP SDK surface when applicable, rejects permissive or incomplete results for state-changing operations, and validates the returned value with Zod before returning it to application code.

A model repair turn may be used only when the feature explicitly allows a bounded repair attempt. Invalid JSON, schema mismatch, missing terminal result, truncation, content-policy refusal, or deadline expiry becomes a normalized failed attempt. Raw model content is never treated as valid domain data merely because parsing succeeded.

Alternative considered: prompt for JSON and parse in each story service. Rejected because it duplicates failure handling and lets unvalidated data cross the boundary.

### 5. Restrict ambient OMP capabilities per feature

Application AI runs headlessly with an explicit system prompt, explicit context, and the minimum tool set required by that feature. Ambient project skills, context files, slash commands, custom tools, MCP servers, LSP, shell, filesystem mutation, subagent spawning, and interactive prompts are disabled unless a reviewed feature explicitly needs them.

This prevents an analysis or writing operation from acquiring application authority through OMP's coding-agent defaults. Secrets remain in the approved credential mechanism and are never copied into prompts, persisted diagnostics, or application logs.

Alternative considered: use `createAgentSession()` defaults. Rejected because discovery and tool defaults are appropriate for a coding harness, not automatically appropriate for product features.

### 6. Translate lifecycle and observability at the adapter

The worker's deadline maps to the SDK session deadline and an application timer. Cancellation calls the supported session abort path, then bounded disposal. The adapter translates SDK/provider errors into stable application categories such as timeout, cancelled, authentication, rate limited, invalid output, content policy, unavailable, and unknown.

SDK events and telemetry feed structured attempt observations: effective model/provider where exposed, duration, usage/cost where exposed, terminal reason, tool activity summary, and correlation IDs. Prompt content, source prose, credentials, and raw provider payloads are excluded from normal logs. Raw diagnostics require an explicit bounded and access-controlled policy.

Alternative considered: expose SDK events and errors directly. Rejected because provider and SDK changes would leak through API and persistence contracts.

### 7. Isolate the current Bun runtime requirement

Node.js LTS remains the API, worker, workflow, database, and orchestration runtime. Because the currently published OMP SDK declares Bun 1.3.14 or later and uses Bun APIs, the architecture documents an isolated Bun-hosted OMP adapter process as the safe baseline unless a version-pinned compatibility spike proves in-process Node execution is supported.

The process boundary remains thin and local: typed versioned request/result envelopes, separate arguments without shell interpolation, bounded diagnostics, deadline and cancellation propagation, health/version reporting, and no durable workflow authority. This is not a general AI sidecar framework. If a future supported OMP SDK runs safely in the Node worker, the same `AiAgent` contract allows moving `OmpAgent` in-process.

Alternatives considered:

- Run the entire worker under Bun. Rejected for now because it silently changes the approved Node.js runtime baseline.
- Import the SDK in Node despite its declared engine. Rejected because compatibility must be demonstrated, not assumed.
- Invoke only the OMP CLI. Rejected because the decision is specifically to use the SDK and retain typed lifecycle integration.

### 8. Pin and verify the SDK integration surface

Implementation will pin a reviewed OMP SDK version and record its package license. A focused compatibility test must cover session creation, explicit model configuration, restricted tools/discovery, structured terminal output, deadline expiry, cancellation, disposal, event/telemetry capture, and error translation. Upgrade work reviews the SDK changelog and reruns this contract test before changing the pin.

Alternative considered: floating to the newest package. Rejected because a fast-moving agent SDK is load-bearing at the application boundary.

## Risks / Trade-offs

- [OMP SDK API or behavior changes quickly] -> Pin a version, keep one adapter, review changelogs, and run boundary compatibility tests on upgrades.
- [Current Bun requirement adds a second JavaScript runtime] -> Isolate it to one local adapter process and preserve Node.js ownership of all durable orchestration.
- [OMP defaults expose coding tools or ambient configuration] -> Use explicit restricted headless configuration and feature-level allowlists.
- [Structured completion still returns invalid, partial, or semantically wrong data] -> Enforce terminal completion, validate with Zod, bound repair attempts, and fail visibly.
- [OMP internal retries or model fallback obscure cost and attempt identity] -> Configure behavior explicitly, record effective execution metadata, and forbid silent paid fallback.
- [Cancellation stops the application wait but leaves OMP work running] -> Map deadlines into SDK configuration, call abort, await bounded disposal, and terminate the isolated process when graceful shutdown fails.
- [Telemetry leaks story text or credentials] -> Capture metadata by default, redact provider payloads, and require explicit policy for raw diagnostics.
- [Thin abstraction grows into another framework] -> Keep only the operations required by application features and reject provider-specific implementation classes above OMP.
- [OMP outage or incompatibility blocks intelligent features] -> Preserve the narrow contract as an escape hatch, but add no second implementation until a concrete failure justifies it.

## Migration Plan

1. Update `03-story-engine.md` so its generation flow depends on `AiAgent`, compiles bounded deterministic context before invocation, validates Zod outputs at the boundary, and leaves future AI work outside the current video milestone.
2. Update `05-provider-architecture.md` to separate the OMP-backed AI boundary from specialized media provider contracts, delete first-party LLM adapter recommendations, and document lifecycle, configuration, observability, and error ownership.
3. Update `13-technology-stack.md` to name OMP SDK as the primary LLM/agent layer, retain Node.js as the primary runtime, and document the current isolated Bun-hosted adapter baseline.
4. Update `16-risks-and-decisions.md` with a new ADR titled "Use OMP SDK as the primary LLM/agent execution layer," revise ADR-006 so it no longer promises an application-owned LLM provider family, and add OMP-specific dependency, tool-authority, runtime, output, cancellation, and observability risks.
5. Check all four documents for consistent terminology and remove contradictory recommendations for Ollama, OpenAI-compatible, Gemini, Anthropic, DeepSeek, or other application-owned LLM provider implementations.
6. Validate the OpenSpec delta and documentation links. No runtime rollback is needed because this change updates architecture documents only; reverting the document changes restores the previous design.
