## Context

See `proposal.md` for motivation. The repository already has a TypeScript modular monolith with a React/Vite web app, Fastify API, one SQLite-backed worker, an isolated Bun OMP host, revisioned story settings/blueprints/StoryState, and a revisioned Scene Engine. The current Scene Engine stores scene-local character snapshots, location references, visual descriptions, image prompts, and a revisioned `visual_style_settings` row, but it has no canonical visual-profile records or persisted prompt package.

Existing Scene records are the source of narrative visual planning, not canonical appearance. Blueprint characters and dynamic CharacterState are stored by the Story Engine, while Scene character IDs are validated snapshots. Existing workflow steps, generation records, and dependency invalidation already provide durable retry/resume semantics. The requested OMP SDK URL currently resolves to the public site landing page; the installed `@oh-my-pi/pi-coding-agent` package and existing Bun NDJSON host are the verified integration boundary.

## Goals / Non-Goals

**Goals:**

- Persist project-scoped canonical identity for characters, locations, recurring objects, and Style Bible revisions.
- Resolve canonical identity plus Scene-local state into deterministic, reproducible Visual Prompt Packages.
- Make profile edits, approval, variants, references, package staleness, and consistency warnings reviewable.
- Preserve exact Scene revisions and keep visual invalidation separate from StoryState, TTS, subtitles, backgrounds, and renders.
- Reuse the existing SQLite, workflow, OMP, Asset, API, and UI patterns with bounded reads.
- Leave a structured, provider-neutral handoff boundary for a future image provider.

**Non-Goals:**

- No pixel/image/video generation, image provider abstraction, ComfyUI, model-specific parameters, image evaluation, embeddings, graph storage, or generated reference images.
- No replacement of the Scene Engine's source ranges or narrative planning model.
- No full character/location inventory system, generic prompt DSL, editorial workflow, or autonomous regeneration loop.
- No second queue, broker, worker pool, or automatic media handoff.

## Decisions

### 1. Add one visual feature service beside Scene Engine

Add a feature-owned visual consistency module in `packages/workflow` with one orchestration service for profile generation, deterministic package building, optional refinement, and workflow-step execution. Keep pure resolver and consistency functions close to that module. Use existing Story/Scene repositories and the existing `AiAgent` contract; do not import OMP SDK types into Node feature code.

Do not make Scene Engine perform ad-hoc profile lookups. Scene prompt/package commands call the visual service, which obtains a complete bounded resolution input from repository methods. Existing Scene generation and regeneration remain responsible for scene structure and continue to persist their scene-local state.

### 2. Extend existing visual style storage into the Style Bible

Keep `visual_style_settings` as the persisted table and extend its typed payload/columns for overall style, texture, environment rendering, character rendering, camera/composition language, mood keywords, and negative prompt. The existing style name, description, medium, realism, palette, cinematic style, aspect ratio, suffix, revision, current pointer, and optimistic row version remain compatible.

Expose a Style Bible DTO and preset constants in shared contracts. Presets are editable input values, not provider configurations. Do not create a parallel `visual_style_bibles` table or store seeds, samplers, CFG, nodes, dimensions, model IDs, or ComfyUI data.

### 3. Use revision rows keyed by stable domain identity

Add additive migration `0009_visual_consistency.sql` with one revision row per current/historical identity:

- `character_visual_profiles`: project ID plus Story blueprint character ID, revision, status, canonical payload, deterministic prompt fragment, input fingerprint, generation provenance, optional bounded reference asset IDs, row version, current marker, and timestamps.
- `location_visual_profiles`: project ID plus existing `locations.id`, revision, status, canonical payload, deterministic prompt fragment, fingerprint, provenance, optional references, row version, current marker, and timestamps.
- `visual_object_profiles`: project ID plus stable normalized `object_key`, revision, status, canonical payload, deterministic prompt fragment, fingerprint, provenance, optional references, row version, current marker, and timestamps.
- `visual_prompt_packages`: project ID plus exact `scene_revisions.id`, package revision, status, structured package JSON, full/negative/refined prompt fields, consistency status/issues, fingerprint, template version, generation provenance, current marker, and timestamps.

The blueprint character ID is text because blueprint characters are currently JSON-backed rather than rows with foreign keys. Every write and read validates that the ID belongs to the current project blueprint. Location profiles reference the existing location registry. Objects intentionally do not reference a new inventory aggregate.

Use filtered unique indexes for one current revision per `(project_id, character_id)`, `(project_id, location_id)`, `(project_id, normalized_object_key)`, and `scene_revision_id`. Mark superseded profile revisions `STALE` where useful; package statuses remain independent. Historical rows are retained.

Do not add a standalone `visual_consistency_checks` table. Consistency is a deterministic snapshot of one package revision and is stored as bounded status plus issue JSON in `visual_prompt_packages`, which avoids another lifecycle and join model while preserving API/UI review data.

### 4. Store explicit object resolution and package dependencies relationally

Keep existing Scene `importantObjects` strings as narrative input. Add `scene_object_resolutions` with exact Scene revision ID, source label/normalized label, nullable selected object profile ID, resolution status, and timestamps. The resolver first honors this explicit choice, then performs conservative exact normalized-key matching; zero/multiple matches stay unresolved and visible.

Add `visual_prompt_package_dependencies` with package ID, dependency kind, stable dependency key, exact profile/style revision ID, and dependency fingerprint. Supported kinds are `STYLE_BIBLE`, `CHARACTER_PROFILE`, `LOCATION_PROFILE`, and `OBJECT_PROFILE`. This is the small relational dependency index used for exact invalidation and scale-safe lookups; the complete resolved snapshot remains in the package JSON.

Use existing `scene_characters` and `scene_revisions` only as scene inputs. Do not copy canonical appearance into Scene records. Add `variantKey` and bounded explicit appearance override data to Scene character visual state only if needed by the current schema; these remain temporary Scene inputs.

### 5. Keep variants lightweight

Represent character variants inside the character profile payload as bounded named entries with a key, revision, description, and prompt overrides. A Scene character state may select a variant key. The resolved package records the selected key and profile revision, then assembles base identity, variant override, and Scene state in that order. An unknown key becomes an unresolved warning.

Do not add a separate variant aggregate or location-variant matrix. The package resolver accepts an optional future location variant key and keeps location profile payloads extensible, but Prompt #8 implements character variant selection only.

### 6. Define simple shared contracts and bounded DTOs

Extend `packages/shared` with strict schemas and inferred DTOs for:

- Character, location, object visual profile payloads and status values.
- Style Bible fields, preset IDs, update/approval/reference requests.
- Visual package status, dependency entries, resolved character/location/object values, consistency status/issue types, and package detail/list DTOs.
- Profile-generation/refinement requests and structured envelopes.
- Visual workflow step types and OMP generation operations.

Keep fields bounded and provider-friendly. Use flat object envelopes for OMP profile results rather than nested unions or provider-specific enums. Validate uploaded reference asset IDs against project ownership and allowed asset types at the application boundary.

### 7. Build a deterministic resolution pipeline

For a current Scene, the visual service performs these explicit stages:

1. Load one current Scene and its bounded Scene character/object resolution snapshots.
2. Resolve the current Style Bible revision.
3. Resolve each known Scene character ID to its current profile, selected variant, and Scene visual state.
4. Resolve the current location profile from the Scene location ID; retain unresolved location warnings.
5. Resolve explicit or conservative object profile matches.
6. Assemble the structured package in fixed order: scene subject/action, characters, location, objects, camera/composition, lighting/mood, Style Bible language, positive suffix.
7. Combine style, profile, and Scene negative inputs with case-insensitive bounded deduplication.
8. Run deterministic consistency checks and attach bounded issues.
9. Compute the package fingerprint from canonical serialized direct inputs.
10. Persist the package and dependency rows atomically.

The Scene action and visual description stay ahead of identity/style support text so canonical memory does not hide the actual beat. Style camera language augments the Scene camera rather than replacing its shot choice.

Reuse the existing stable serialization/fingerprint convention from `story-prompts.ts` by making the helper available to the visual module rather than introducing a second incompatible hash format. Use template version `visual-prompt-v1` initially. Deterministic rebuilds with identical inputs produce identical structured fields, prompt text, negatives, and fingerprint.

### 8. Separate deterministic build from optional OMP refinement

The normal package build makes no OMP call. It stores `structuredPackage`, `fullPrompt`, `negativePrompt`, and a nullable `refinedPrompt` separately. Optional refinement receives the structured package and canonical constraints, returns only bounded prompt text fields plus the source package fingerprint, and is accepted only after schema and contradiction checks. A failed or rejected refinement leaves the deterministic package current and usable.

Profile generation is the only required OMP-backed visual operation. Character context includes the bounded blueprint character, current CharacterState, genre/world essentials, Style Bible, and a capped selection of relevant scene evidence. Location context includes the existing location record, bounded relevant facts/scenes, and Style Bible. Object context includes the explicit object key, bounded referring scenes, and Style Bible. No profile operation serializes the full novel.

### 9. Use candidate-first profile lifecycle

A generated profile is persisted as `DRAFT` with generation metadata. Approval is explicit. Manual edit and accepted candidate create the next immutable revision and move the current pointer transactionally; an existing approved row is never overwritten. Profile-specific fingerprints include canonical payload, prompt fragment inputs, selected source revisions, and profile prompt version.

On profile creation/update, validate project ownership, character existence where applicable, references, bounds, and optimistic row version in one short SQLite transaction. Mark dependent packages stale using `visual_prompt_package_dependencies`; do not mutate Scene rows or story/media descendants.

### 10. Invalidate at visual scope only

All profile and Style Bible edits share one transaction with current-pointer movement and package staleness:

- Character profile: exact `CHARACTER_PROFILE` dependency key only.
- Location profile: exact location profile dependency key only.
- Object profile: exact object profile dependency key only.
- Style Bible: all package dependencies for the project.

Only current package rows with matching dependencies become `STALE`. Historical package revisions remain inspectable. A Scene revision change naturally requires a package for its new exact `scene_revision_id`; it does not replan or modify the old package. No visual invalidation touches chapter revision, StoryState, TTS, subtitles, backgrounds, renders, or unrelated projects.

### 11. Reuse durable workflow semantics

Extend shared workflow step and generation-operation enums with profile-generation types, `BUILD_VISUAL_PROMPT`, and optional `REFINE_VISUAL_PROMPT`. The visual service executes profile OMP steps through the existing attempt/retry/cancellation path and executes deterministic package builds through persisted steps without invoking an image provider.

Use stable keys containing project/entity identity, source revision, and input fingerprint. A single-scene package step targets one Scene revision. A chapter batch materializes bounded per-scene steps or one chapter coordinator with persisted child scopes, whichever matches the existing worker API without loading all scenes. Missing/stale filters are computed in SQL. Commit validated profile/package/dependency rows before worker completion; matching committed fingerprints are reused after restart. Technical retry and creative regeneration remain distinct.

### 12. Add selective API and UI surfaces

Add thin API routes under the existing project/scene surface for paginated profile lists/details, profile create/edit/approve/generate, Style Bible read/update/preset, object resolution, package read/rebuild/refine, consistency results, and selected chapter prompt scheduling. Routes parse shared schemas and call the visual service; they do not contain resolver or workflow logic.

Extend the existing web workspace with a Visual Bible area using Vietnamese copy. Keep profile list reads to metadata pages and load one profile/package detail at a time. Show status, revision, fields, prompt fragment, references, actions, package dependencies, and consistency warnings. Add scene detail package fields and rebuild/refine controls without changing existing Story, Scenes, Audio, Video, or Render actions.

If the existing multipart Asset path can accept a bounded reference role without a second storage mechanism, add the three reference asset types and attach IDs to profile revisions. Otherwise retain empty reference slots and report the omission; profile and prompt functionality must not depend on manual uploads.

### 13. Verify with behavioral and regression coverage

Add deterministic fake-agent coverage for profile schema rejection, candidate approval/edit, canonical character/location/object consistency, temporary state and variant resolution, prompt ordering/negative deduplication, package fingerprints, all invalidation scopes, missing/ambiguous warnings, selective pagination, batch retry/restart, and no media/image work.

Run existing Scene, Story, long-story, TTS, subtitle, render, migration, typecheck, and lint checks. Run a real OMP character and location candidate smoke only when readiness/authentication/model checks pass; persist and inspect the draft candidates and build deterministic packages from them. Record provider quality or quota limitations without treating readiness as successful domain validation.

## Risks / Trade-offs

- **Existing blueprint characters are JSON-backed.** Text IDs require application ownership validation instead of foreign keys. This preserves the current Story schema and can migrate to a character table later.
- **Scene object names are inherently ambiguous.** Conservative exact matching plus a persisted explicit resolution prevents silent merges at the cost of occasional manual review.
- **Package dependency rows add write volume.** They make character/location/object invalidation indexed and bounded instead of scanning package JSON or all scenes, which matters for hundreds of chapters.
- **Profile payloads are JSON-backed.** This keeps the physical schema small while shared Zod contracts provide field-level validation. Promote a field only when a real filter or uniqueness constraint requires it.
- **Approved identity and scene exceptions can conflict.** Deterministic checks warn on simple contradictory terms; they do not infer whether a story event legitimately changes appearance. Explicit scene overrides and user review remain authoritative.
- **OMP quality depends on the configured model and strict contract.** The application owns validation and canonical persistence; provider output is always a draft candidate and usage remains nullable.
- **Optional reference upload may be deferred.** Empty validated slots preserve the future provider seam without duplicating Asset storage or blocking the milestone.
- **Prompt text is not an image guarantee.** The package is a reproducible provider input, but pixel consistency cannot be assessed until a later image-provider milestone.
