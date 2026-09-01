## Context

See `proposal.md` for motivation and user-visible scope. The repository already has a TypeScript modular monolith with a React/Vite web app, Fastify API, one SQLite-backed lease worker, revisioned story settings/blueprints/plans/summaries, StoryState/CharacterState, existing chapter revisions, and an isolated Bun OMP host. `StoryEngine` already owns bounded context compilation, prompt versioning, structured parsing, generation metadata, usage persistence, workflow execution, and scoped invalidation. The current OMP SDK package is pinned in `apps/omp-agent` and the requested SDK URL currently resolves to the OMP site landing page rather than a richer SDK reference, so the design reuses the repository's verified protocol/session pattern and does not add new SDK assumptions.

Scene generation must consume the exact current chapter text because source offsets are part of the result. It may select bounded continuity context, but it must never assemble the full novel. Existing chapter edits already create revisions and invalidate chapter media; scene descendants must attach to that same chapter revision boundary without changing TTS, subtitle, render, or StoryState semantics.

## Goals / Non-Goals

**Goals:**

- Add a provider-neutral, revisioned scene-plan and scene-revision model with explicit source, character, location, style, prompt, and provenance links.
- Keep chapter-level OMP planning as the default cost/continuity boundary, then persist each scene independently for review and single-scene operations.
- Make source ranges, controlled enums, references, density, prompts, retries, invalidation, and current pointers deterministic and testable.
- Reuse the existing SQLite migration, workflow claim/lease, AI attempt, usage, error, and restart-recovery mechanisms.
- Keep scene UI/API reads selective and make manual scene editing and one-scene regeneration first-class.
- Preserve a clean boundary for future image assets without creating an image provider or pixel job now.

**Non-Goals:**

- No image/video provider, pixel generation, character reference images, scene graph, shot/timeline editor, animation, parallax, or image-to-video work.
- No full world bible, canonical object inventory, character visual-profile editor, embeddings, vector retrieval, or autonomous quality/regeneration loop.
- No new queue, broker, worker pool, or parallel execution infrastructure.
- No automatic scene generation after chapter creation and no automatic TTS/subtitle/render handoff.
- No silent acceptance of ambiguous character or location identity.

## Decisions

### 1. Add one Scene Engine beside StoryEngine, not a second application service

Add a feature-owned scene orchestration module in `packages/workflow` with a public engine/factory, a pure context compiler, and scene prompt renderers. It will use the existing `AiAgent`, `StoryRepository`, `ChapterRepository`, and `WorkflowRepository` contracts. Shared AI attempt/retry/metadata mechanics should be extracted into a small internal helper only if needed to avoid duplicating behavior; the scene feature must not import OMP SDK types or bypass the existing workflow runner.

This keeps scene-specific validation and context selection out of the chapter engine while preserving one application AI boundary and one durable workflow implementation. It also makes a later image-planning feature additive rather than forcing scene fields into chapter-generation code.

### 2. Use two durable layers: chapter ScenePlan revisions and current Scene revisions

A `scene_plan_revisions` table represents one chapter-level planning result and a `scene_revisions` table represents each ordered scene in that plan. A plan revision stores project/chapter IDs, exact source chapter revision, density and optional target bounds, style revision used, input fingerprint, generation metadata reference, lifecycle status, current marker, and timestamps. A scene revision stores a stable scene ID, revision number, plan revision link, scene number, narrative fields, source offsets, the exact source-content snapshot used by those offsets, location snapshot/reference, camera/composition JSON, prompt fields/status, continuity notes, and current marker.

Use stable IDs for scene concepts and separate revision rows for immutable generated/manual evidence. Current uniqueness is enforced for one plan per chapter and one current scene revision per scene stable ID. A whole-chapter replan creates a new current plan revision and a new ordered scene set; one-scene regeneration creates only the next revision for the selected stable scene. Historical rows remain queryable. Scene list reads join current plan/current scene rows and never need historical payloads.

The minimum scene fields are:

- narrative: `sceneNumber`, `title`, `summary`, controlled `purpose`, `sourceStartOffset`, `sourceEndOffset`;
- setting: `locationId?`, `locationNameSnapshot`, `timeOfDay`, `weather`, `mood`;
- visual planning: `visualDescription`, `camera` (`framing`, optional `angle`, optional `movementIntent`), `composition` (`subjectFocus`, `foreground`, `midground`, `background`, `characterPositions`), `lighting`, `colorMood`;
- future execution: `imagePrompt`, nullable `negativePrompt`, `promptStatus`, `continuityNotes`;
- provenance: source chapter revision, style revision, input fingerprint, prompt/schema versions, generation record, revision, status, current marker, timestamps.

Camera and composition are bounded JSON values validated before SQL writes. This avoids promoting every future cinematography field to a column while keeping review-critical narrative and reference fields queryable.

### 3. Store scene-character snapshots relationally, but do not create a character aggregate

Add `scene_characters` keyed by scene revision with nullable `character_id`, bounded `display_name`, `role_in_scene`, `visual_state` JSON, and an explicit resolution status. Known blueprint IDs are checked against the project before persistence. Name matching is normalized only for resolution; an unmatched name is stored as a bounded unresolved candidate with a visible warning (or fails when the operation supplied an invalid canonical ID). No new canonical Character or CharacterState row is created.

The snapshot contains scene-specific clothing, injury, expression, pose, action, position, and held objects. It is reproducibility data, not a write path into StoryState. Store the source character revision/state fingerprint used so a future character visual-profile change can mark only dependent prompts stale.

### 4. Add lightweight locations with conservative normalized identity

Add `locations` with project ID, display name, normalized lookup key, bounded description/type/visual description/environment/architecture/important-objects/lighting-defaults fields, lifecycle (`DRAFT` or `ACTIVE`), row version, and timestamps. A focused repository resolves within one project using a documented normalization function: trim, Unicode-normalize, lowercase, remove a leading definite article where safe, collapse whitespace, and normalize punctuation. It does not use fuzzy similarity or substring matching.

One exact normalized match is reused. A collision or multiple plausible candidates is returned as ambiguous and remains unresolved; the workflow creates or returns a draft candidate only when it has an unambiguous genuinely new name. Updating a location uses optimistic concurrency and marks prompts that reference its visual fields stale. There is deliberately no general StoryObject table in this milestone: `importantObjects` and scene-specific object snapshots are bounded JSON/string values, leaving a clean future stable-ID seam without an inventory system.

### 5. Revision visual style separately from render configuration

Add `visual_style_settings` with project ID, revision, canonical bounded payload, input fingerprint, current marker, row version, and timestamps. The payload includes style name/description, medium, realism, color palette, cinematic style, aspect ratio, and prompt suffix. A current style revision is selected for scene planning and prompt refresh and is captured in plan/scene provenance. Style edits create a new revision and mark dependent prompt status stale; they do not invalidate source ranges or narrative scene structure.

Do not store image provider, model, sampler, seed, dimensions, or ComfyUI settings here. Aspect ratio remains a validated style value for prompt planning only.

### 6. Compile a dedicated bounded SceneGenerationContext

Implement a pure scene context compiler with this selection order:

1. exact chapter title, full current chapter content, chapter ID, revision, and content length;
2. available chapter plan item and current chapter summary;
3. applicable current arc and its bounded goal/conflict/outcome;
4. blueprint characters named by the plan, summary, state, or chapter mentions, paired with current CharacterState when available;
5. active relevant threads and important facts, selected by character/plan overlap and importance;
6. the current visual style;
7. for independent regeneration, the target scene source excerpt/range, previous and next scene summaries, and neighboring visual snapshots.

The compiler returns canonical serialized context, source revision IDs, a bounded diagnostics object, and an input fingerprint. It never loads all historical chapter prose. The exact chapter content is not silently truncated because offsets would become invalid; if it exceeds the configured safe OMP input ceiling, the operation fails with an actionable context error rather than producing incorrect traceability. Optional continuity records may be omitted whole with diagnostics. Missing plan/summary/state for manual chapters uses an explicit empty/fallback section and does not fabricate state.

### 7. Use one structured chapter plan call and strict boundary validation

Add versioned prompt renderers for scene planning, single-scene regeneration, and image-prompt refresh. Reuse the existing stable serializer/fingerprint convention and untrusted-story-data delimiters. The planning contract is an object with a bounded `scenes` array; each item has the narrative, source range, location/time/mood, character mentions and snapshots, objects, visual description, camera, composition, lighting/color mood, prompt, and negative prompt fields. Regeneration returns one item. Prompt refresh returns only prompt fields and the source scene revision it used.

Application validation enforces:

- at least one scene and configured upper bound;
- scene numbers exactly `1..N` in narrative order;
- UTF-16 offsets `0 <= start < end <= chapter.content.length`, sorted and non-overlapping;
- controlled purposes (`INTRODUCTION`, `ESTABLISHING`, `DIALOGUE`, `ACTION`, `DISCOVERY`, `EMOTIONAL`, `TRANSITION`, `REVEAL`, `CLIMAX`, `ENDING_HOOK`);
- controlled framing (`EXTREME_WIDE`, `WIDE`, `FULL`, `MEDIUM`, `CLOSE_UP`, `EXTREME_CLOSE_UP`, `OVER_THE_SHOULDER`, `POV`);
- bounded arrays/strings and strict object keys;
- known canonical IDs, explicit unresolved names, and safe project ownership;
- prompts that remain separate from visual descriptions.

The application does not ask the model to generate one call per scene. It persists all validated scenes in one short SQLite transaction after resolution. This gives global segmentation and continuity while leaving scene rows independently editable.

### 8. Keep prompt generation independently refreshable

The initial scene plan stores both `visualDescription` and `imagePrompt`. The prompt refresh operation receives the current scene domain fields, scene-character snapshots, location visual data, style revision, and optional user instruction, then returns a replacement prompt/negative prompt. It never changes source offsets, purpose, scene number, or canonical story state.

Prompt status values are separate from scene structure status, at minimum `CURRENT`, `STALE`, and `MISSING`. A style/location/character visual dependency change marks prompt status stale. A manual image-prompt edit is current user-authored data but remains linked to the style/location/character inputs so a later dependency change can mark it stale visibly.

### 9. Resolve workflow semantics through existing durable steps

Use existing `workflow_executions`, `workflow_steps`, `workflow_step_dependencies`, attempts, leases, and jobs. Add workflow types `GENERATE_SCENES`, `REGENERATE_SCENE`, and `GENERATE_SCENE_PROMPT`; add generation operation identities for scene planning, scene regeneration, and prompt refresh. A chapter scene-plan step is keyed by project/chapter/current chapter revision and density request. A single-scene step is keyed by project/scene stable ID/current scene revision. Prompt refresh is keyed by scene stable ID and current visual dependency fingerprint.

The worker dispatches scene steps to the Scene Engine only after updating the running input fingerprint. Completion is ordered: parse/validate all output, resolve references, commit revisions/locations/scene characters/metadata/usage atomically, then let the worker mark the step completed. Technical retries keep the same operation/input identity and reuse a matching committed result on recovery. Creative regeneration is an explicit new request and increments only the selected scene revision. Cancellation never commits partial scenes.

Selected-chapter batch generation uses one existing workflow execution with one chapter scene step per selected chapter, in simple sequential claim order. The API supports a range/selection and a no-current-plan filter; it does not materialize every chapter by default and does not add parallel infrastructure.

### 10. Extend invalidation at the smallest visual scope

Extend the existing chapter invalidation path so a chapter content/title revision change marks its current scene plan and scene revisions stale/invalidated by chapter ID and source revision, while preserving historical scenes and all existing media/StoryState behavior. Do not make scene status a substitute for workflow or chapter continuity status.

Add focused visual invalidation operations:

- style revision change: mark current scene prompts stale for the project;
- location visual edit: mark prompts stale for current scene revisions referencing that location;
- future character visual-profile edit: use stored character dependency fingerprints to mark only matching scene prompts stale;
- visual prompt refresh: update only prompt fields and provenance after successful validation.

No invalidation path deletes scene revisions, changes chapter text, starts image work, or invalidates unrelated chapters. If a chapter is manually edited, scene source validity is tied to the new chapter revision and requires explicit re-planning; no StoryState delta is inferred.

### 11. Provide selective API and UI surfaces

Add thin Fastify routes under the project/chapter story surface, with request validation and service calls only:

- `GET /api/projects/:projectId/scenes` with chapter/status/page filters for metadata;
- `GET /api/chapters/:chapterId/scenes` for paginated current scene summaries;
- `GET /api/scenes/:sceneId` for one current scene plus a bounded source excerpt;
- `POST /api/chapters/:chapterId/scenes/generate` for density/target settings;
- `POST /api/scenes/:sceneId/regenerate` for one creative revision;
- `POST /api/scenes/:sceneId/prompt` for explicit prompt refresh;
- `PATCH /api/scenes/:sceneId` for optimistic manual edits;
- `GET/PUT /api/projects/:projectId/visual-style` for current style revisions;
- `GET/POST/PUT /api/projects/:projectId/locations` for safe location review/editing;
- selected-chapter scene batch scheduling through the existing story workflow surface.

Responses use shared Zod DTOs and expose machine statuses, revision/provenance, prompt status, unresolved-reference warnings, and durable operation IDs. List responses exclude full chapter content, full source excerpts, and historical revisions; detail retrieves only one bounded excerpt. Routes do not call OMP directly.

Extend the existing Story workspace with a Scenes tab/area rather than a second app. Use Vietnamese copy and the existing polling/error conventions. Show chapter cards/counts, density controls, style controls, scene cards, source excerpt, edit controls, and independent regenerate/prompt-refresh actions. Keep Story, chapter editing, Audio, Video, and Render actions untouched.

### 12. Add additive migrations and preserve existing installations

Add `0007_scene_engine.sql` after the current migration list and register it in `migrateDatabase`. Create scene plan/revision, scene-character, location, visual-style, and required indexes with foreign keys and safe status checks. Use additive DDL only; do not rebuild or reset existing chapter, asset, workflow, or story tables. Existing projects begin with no current visual-style row and no scenes; the API supplies documented defaults for style/density without an OMP call.

Add `0008_scene_source_snapshot.sql` as a follow-up additive migration for the exact source-content snapshot used by scene offsets. The Drizzle schema mirrors both migrations. Migration coverage opens an existing database, applies the migrations, verifies old rows remain readable, and verifies source snapshots and foreign-key/current-pointer constraints.

### 13. Prove the contract with deterministic and real checks

Add deterministic fake-agent coverage for:

- location/dialogue/action/reveal splitting and persisted ordered scenes;
- offset boundaries, UTF-16 behavior, overlap/order/range rejection;
- known-character ID resolution and unresolved-name visibility;
- normalized location reuse and ambiguity preservation;
- scene/style/chapter invalidation scope;
- one-scene revision regeneration with neighboring scenes unchanged;
- manual scene edits, optimistic conflict, technical retry, cancellation, and restart recovery;
- selected chapter batches and 20/100-chapter pagination without giant responses;
- existing Story, long-story, TTS, subtitle, and render regression suites.

Run a real OMP smoke path against an existing generated chapter only when readiness/authentication/model checks pass: generate scenes, inspect the persisted structured result and metadata, then regenerate one scene and inspect the new revision. Record exact observed quality issues in implementation limitations; never claim real success from a fake agent or from host readiness alone.

## Risks / Trade-offs

- **Full chapter input can exceed an OMP context window.** Refusing over-limit source text preserves correct offsets and avoids silently corrupting traceability; chunked scene planning is a later capability.
- **Strict scene contracts can reject useful creative output.** Controlled enums and range checks prevent unreviewable downstream data; bounded technical retry remains available, while unresolved references are explicit rather than silently merged.
- **Whole-chapter re-planning changes scene identity.** Stable IDs are preserved for independent edits/regeneration, while a new plan revision is an intentional new segmentation and keeps all prior plans inspectable.
- **Location normalization can under-merge or over-merge.** Conservative exact normalization plus ambiguity warnings is safer than fuzzy merging; users can review draft candidates.
- **Prompt staleness may be mistaken for scene invalidation.** Separate plan/scene status from prompt status and show both in API/UI; style changes never destroy narrative structure.
- **Existing `StoryEngine` invalidation is broad.** Add scene-specific branches with chapter/style/location keys and test unrelated chapter/media preservation before changing common paths.
- **The current web entry point is large.** Add bounded scene components/data reads and avoid a broad refactor during this milestone; UI correctness is validated through the actual browser surface.
- **Real OMP quality and telemetry depend on configured SDK/provider state.** Keep usage nullable, validate the returned structure locally, and document observed weaknesses rather than fabricating cost or quality guarantees.
- **Scene JSON can grow with long chapters.** Keep relational query fields narrow, bound serialized arrays/text, paginate all list endpoints, and retain complete scene payload only in revision detail rows.
