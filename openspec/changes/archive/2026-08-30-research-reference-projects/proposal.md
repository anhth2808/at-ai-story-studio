## Why

The repository needs source-grounded comparative research before designing an AI Video Studio. The research must distinguish implemented capabilities from aspirational ones and identify reusable architecture without modifying the reference repositories.

## What Changes

- Add per-project technical analyses for all ten repositories under `references/`, citing actual source files and symbols.
- Add cross-project feature, provider, workflow, architecture, reusable-component, and lessons/gap comparisons.
- Add five workflow-level documents that separate currently implemented steps from missing capabilities.
- Add a final recommendation for what to reuse, wrap, reimplement, or ignore, with a local-first architecture direction.
- Do not implement the AI Video Studio or modify any source under `references/`.

## Capabilities

### New Capabilities
- `reference-research`: Source-grounded documentation of existing AI video, speech, translation, and rendering systems.
- `studio-recommendation`: Evidence-based reuse decisions, gap analysis, workflow progression, and target architecture for a future AI Video Studio.

### Modified Capabilities
- None.

## Impact

- Adds research documentation under `docs/` and planning artifacts under `openspec/changes/research-reference-projects/`.
- Reads but does not modify the repositories under `references/`.
- Introduces no runtime dependencies, APIs, or product implementation.
