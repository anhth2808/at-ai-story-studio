## Why

The V1 architecture currently treats LLM execution as a generic provider family and recommends first-party Ollama and OpenAI-compatible adapters. That would duplicate model/provider capability already supplied by the current OMP SDK and leave intelligent application features without one controlled execution boundary.

## What Changes

- Define OMP SDK as the primary LLM and agent execution layer for intelligent application features.
- Replace the broad application-owned `LLMProvider` family with a thin `AiAgent` application contract and one `OmpAgent` adapter.
- Keep story, workflow, retry, invalidation, asset, and persistence state in AI Story Studio rather than OMP sessions.
- Keep deterministic and specialized media systems outside OMP, including TTS, ASR/WhisperX, FFmpeg/ffprobe, ComfyUI, image/video APIs, filesystem access, database access, and job execution.
- Require structured AI results to be validated with Zod before entering application or domain state.
- Define the thin boundary responsibilities: configuration, model selection, testing, observability, deadline/cancellation handling, error translation, and a future escape hatch without creating another generic LLM framework.
- Update `03-story-engine.md`, `05-provider-architecture.md`, `13-technology-stack.md`, and `16-risks-and-decisions.md`, including an ADR-level decision named "Use OMP SDK as the primary LLM/agent execution layer."
- Record the current SDK integration facts and risks discovered from the published OMP package and SDK examples, including `createAgentSession()`, model/auth discovery, session events, absolute deadlines, telemetry, structured completion support, explicit abort/disposal, and the package's current Bun runtime requirement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-story-studio-v1-design`: Revise the architecture package requirements so LLM/agent features use a thin application AI boundary backed primarily by OMP SDK while specialized media providers and durable workflow ownership remain application-controlled.

## Impact

- Documentation: `docs/design-v1/03-story-engine.md`, `docs/design-v1/05-provider-architecture.md`, `docs/design-v1/13-technology-stack.md`, `docs/design-v1/16-risks-and-decisions.md`.
- OpenSpec: one delta for `ai-story-studio-v1-design`.
- Future implementation: AI application contracts, OMP adapter composition, OMP package/runtime configuration, Zod output schemas, timeout/cancellation wiring, telemetry, and normalized errors.
- Dependencies and runtime: adoption must account for the currently published `@oh-my-pi/pi-coding-agent` SDK and its declared Bun runtime requirement without moving workflow or persistence authority into OMP.
