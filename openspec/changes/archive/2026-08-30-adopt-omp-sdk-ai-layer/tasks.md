## 1. Confirm Current OMP SDK Contract

- [x] 1.1 Re-check the current official OMP SDK documentation and published package metadata for session creation, model/auth configuration, structured completion, deadlines, telemetry, abort/disposal, package version, and runtime requirements; verify every SDK-specific claim planned for the design documents is source-backed and record no unsupported API assumptions.

## 2. Update Feature and Provider Boundaries

- [x] 2.1 Update `docs/design-v1/03-story-engine.md` to route intelligent story operations through the thin `AiAgent` -> `OmpAgent` -> OMP SDK boundary, require Zod validation before state changes, preserve deterministic context compilation and application-owned workflow state, and verify the document does not make advanced story generation part of the FIRST WORKING VIDEO milestone.
- [x] 2.2 Update `docs/design-v1/05-provider-architecture.md` to remove the application-owned `LLMProvider` hierarchy and first-party Ollama/OpenAI-compatible/Gemini/Anthropic/DeepSeek implementation direction, define the OMP adapter boundary and lifecycle responsibilities, preserve specialized media provider contracts outside OMP, and verify no remaining section contradicts this split.

## 3. Update Technology and Runtime Direction

- [x] 3.1 Update `docs/design-v1/13-technology-stack.md` to name OMP SDK as the primary LLM/agent execution layer, keep Node.js LTS authoritative for durable application orchestration, document the current Bun runtime constraint and isolated adapter-process baseline, and verify workspace/package guidance remains a modular-monolith boundary rather than a generic sidecar framework.

## 4. Update Decisions and Risks

- [x] 4.1 Revise ADR-006 and the risk register in `docs/design-v1/16-risks-and-decisions.md` so specialized providers remain capability-based outside OMP while OMP dependency churn, Bun isolation, ambient tool authority, structured-output failure, cancellation, cost visibility, and telemetry leakage have explicit mitigations; verify the revised decision no longer promises application-owned LLM provider adapters.
- [x] 4.2 Add the ADR-level decision "Use OMP SDK as the primary LLM/agent execution layer" to `docs/design-v1/16-risks-and-decisions.md`, covering the thin boundary, alternatives, trade-offs, future escape hatch, and AI Story Studio ownership of durable state; verify ADR numbering and terminology are consistent with the existing register.

## 5. Verify the Architecture Package

- [x] 5.1 Search the four affected documents for contradictory LLM adapter recommendations and inconsistent `AiAgent`, `OmpAgent`, OMP SDK, specialized-provider, Node.js, and Bun terminology; resolve all findings and verify all relative document links still point to existing files.
- [x] 5.2 Run strict OpenSpec validation for `adopt-omp-sdk-ai-layer` and inspect the final document diff to verify the specification scenarios, all four requested documents, and the new ADR are complete without unrelated architecture expansion.
