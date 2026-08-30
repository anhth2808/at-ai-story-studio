## Context

The repository contains ten independent upstream projects under `references/`, spanning automatic video creation, dubbing, ASR/alignment, TTS, voice cloning, and story-video workflows. Their frameworks, maturity, coupling, and licenses differ. README descriptions are insufficient evidence; current source is authoritative.

## Goals / Non-Goals

**Goals:**
- Trace real entry points and end-to-end workflows from source.
- Use a common comparison vocabulary across projects.
- Preserve evidence through source-path and symbol citations.
- Separate reusable concepts from code that is too coupled or license-constrained.
- Derive a local-first staged architecture and explicit gap analysis.

**Non-Goals:**
- Implementing the future studio.
- Modifying, normalizing, or executing destructive operations in reference repositories.
- Treating aspirational README content as implemented behavior.
- Recommending direct code reuse without checking the repository license.

## Decisions

### Inspect by execution path
For each project, start with application and CLI/API entry points, follow orchestration into services and providers, then inspect persistence, temporary assets, and rendering. This prevents isolated utility modules from being mistaken for integrated features.

### Use three evidence states
Cross-project matrices use supported, partial, and unsupported. “Supported” requires an integrated source path; “partial” covers primitives, optional/example paths, incomplete integration, or a narrower implementation than the matrix label.

### Keep citations repository-relative
Technical claims cite paths beginning with `references/<project>/` and name functions/classes where practical. This keeps documents navigable without external links.

### Prefer architectural reuse
Reuse recommendations prioritize adapters, data contracts, and workflow ideas. Direct reuse is reserved for cohesive code with compatible licensing and manageable dependencies.

### Write overview last
Per-project evidence and comparison documents are completed before `docs/overview.md`, so the final architecture and progression are synthesis rather than assumptions.

## Risks / Trade-offs

- Large repositories contain optional or legacy paths; integrated entry-point tracing mitigates false positives but cannot prove every runtime combination.
- Provider availability and pricing change over time; the provider matrix records likely cost class and API requirements, not contractual pricing.
- Some projects combine incompatible copyleft and permissive licenses; license findings constrain code reuse even when architecture is useful.
- GPU-heavy projects may be inspectable but not runnable on available hardware; source-grounded analysis remains valid while runtime claims are limited to exercised checks.
