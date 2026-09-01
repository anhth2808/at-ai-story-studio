## Why

The completed Scene Engine describes scene-specific visual beats, but it does not retain canonical visual identity for recurring characters, locations, objects, or the project style. Without that layer, every future image prompt must reconstruct identity from scene text and can drift across chapters. Prompt #8 adds the durable, provider-neutral visual memory now, before image generation enters scope.

## What Changes

- Add revisioned, project-scoped `CharacterVisualProfile`, `LocationVisualProfile`, `VisualObjectProfile`, and Style Bible records with editable draft/approved/stale status, optimistic updates, and stable current revisions.
- Keep canonical visual identity separate from scene-local visual state. Resolve canonical profiles, optional visual variants, and temporary scene conditions into a structured visual prompt package without mutating StoryState or Scene narrative data.
- Add optional reference-asset slots that reuse the existing Asset system; manual reference uploads remain optional and no reference image generation is introduced.
- Add structured OMP candidate-generation operations for character, location, and object profiles. Validate candidates with Zod, persist them as drafts, and never silently overwrite approved or manually edited profiles. Keep OMP prompt modules source-controlled and versioned.
- Add deterministic resolvers and prompt assembly for style, characters, locations, recurring objects, camera, lighting, composition, mood, and negative prompts. Persist the structured package separately from optional refined prompt text.
- Add deterministic consistency checks for missing, unresolved, conflicting, or stale visual references and expose `PASS`, `WARN`, or `FAIL` results to API and UI clients.
- Add prompt fingerprints containing scene and dependency revisions plus the prompt-template version. Changing a character, location, object, or Style Bible revision marks only dependent visual prompt packages stale; it never invalidates narrative, TTS, subtitles, or render outputs.
- Add persisted workflow steps for profile generation and chapter/selected-chapter prompt builds, including missing/stale filtering, retry/resume, cancellation, and restart recovery through the existing SQLite workflow.
- Add paginated Visual Bible APIs and a Vietnamese Visual Bible workspace for style, characters, locations, objects, profile editing/approval/regeneration, reference slots, prompt previews, scene packages, and visible consistency warnings.
- Add additive Drizzle/SQLite migrations, regression/scale/fingerprint/invalidation tests, implementation documentation, and useful permanent architecture boundaries.
- **Out of scope:** pixel or image generation, ComfyUI, Stable Diffusion, Flux, image APIs, reference-image generation, vision evaluation, video generation, timeline work, or a second job system.

## Capabilities

### New Capabilities

- `visual-consistency`: Canonical visual profiles, Style Bible, variants, reference slots, deterministic resolution, Visual Prompt Packages, consistency checks, fingerprints, and visual dependency invalidation.

### Modified Capabilities

- `scene-engine`: Resolve canonical visual identities and scene-specific state into independently rebuildable prompt packages while preserving scene structure and source traceability.
- `story-ai-generation`: Add bounded structured profile-generation and optional prompt-refinement contracts through the existing OMP boundary.
- `durable-workflow-jobs`: Persist profile-generation and visual-prompt build steps with existing retry, cancellation, dependency, and restart semantics.
- `story-engine-ui`: Add the Visual Bible and scene visual-package review surfaces with Vietnamese copy and selective reads.
- `project-and-chapter-management`: Keep visual-profile and prompt invalidation scoped to dependent scenes without touching story or media descendants.
- `omp-integration`: Add allowlisted visual-profile operations while retaining the isolated Bun adapter and provider-neutral Node contracts.

## Impact

Affected areas are `packages/shared` visual schemas, DTOs, statuses, and operation contracts; `packages/database` additive tables, migrations, repositories, indexes, and visual dependency queries; `packages/workflow` profile generation, resolvers, deterministic prompt assembly, consistency checks, workflow execution, and tests; `apps/api` thin Visual Bible and scene-package routes; `apps/web` Vietnamese Visual Bible and scene detail UI; `apps/worker` existing durable step dispatch; `apps/omp-agent` operation allowlisting; and `docs/implementation` visual consistency, architecture, workflow, limitations, and profile documentation.

The current Scene Engine, Story/Long Story Engine, workflow persistence, retry/resume behavior, TTS, subtitles, and render pipeline remain intact. Existing databases migrate in place. The requested OMP SDK URL currently resolves to the OMP site landing page, so implementation will reuse the repository's pinned `@oh-my-pi/pi-coding-agent` Bun boundary and verify the installed SDK behavior rather than inventing undocumented APIs.
