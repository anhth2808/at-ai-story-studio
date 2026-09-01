## 1. Shared contracts and configuration

- [x] 1.1 Add strict scene enums, schemas, and DTOs; verify shared package typechecks and rejects unsupported purpose/camera values.
- [x] 1.2 Add scene-density, target-range, visual-style, location, scene-edit, and regeneration request schemas; verify boundary validation preserves current revisions on invalid input.
- [x] 1.3 Extend generation and OMP protocol operation contracts for scene planning, scene regeneration, and prompt refresh; verify legacy operations still parse unchanged.

## 2. Additive persistence and repositories

- [x] 2.1 Create and register migration 0007 for scene plans, scene revisions, scene characters, locations, and visual styles; verify an existing database migrates without reset.
- [x] 2.2 Extend the Drizzle schema with current-pointer, foreign-key, status, revision, and query indexes; verify schema declarations match migration columns.
- [x] 2.3 Implement repositories for scene plans, scene revisions, scene characters, locations, and visual-style revisions; verify transactional current-pointer and optimistic-concurrency behavior.
- [x] 2.4 Implement UTF-16 source-range validation and bounded excerpt reads; verify negative, reversed, overlapping, and out-of-bounds ranges are rejected.
- [x] 2.5 Implement conservative location normalization, reuse, ambiguity, and draft-candidate behavior; verify casing/article/punctuation variants do not duplicate unambiguous locations.
- [x] 2.6 Extend chapter/style/location dependency invalidation for scene and prompt scopes; verify unrelated chapters, media, StoryState, and historical revisions remain available.

## 3. Bounded context and OMP prompts

- [x] 3.1 Implement dedicated bounded SceneGenerationContext selection; verify late chapters exclude complete historical prose and expose selected/omitted diagnostics.
- [x] 3.2 Implement versioned scene-planning, scene-regeneration, and image-prompt templates; verify stable fingerprints include source, style, density, and prompt versions.
- [x] 3.3 Implement strict planning, regeneration, and prompt-refresh output validation; verify scene order, controlled values, references, field bounds, and prompt separation.
- [x] 3.4 Implement known-character resolution and unresolved-reference warnings; verify canonical Character and StoryState rows never change during scene generation.
- [x] 3.5 Implement scene continuity checks using bounded neighboring visual context; verify object/state contradictions become review warnings rather than canonical mutations.

## 4. Scene orchestration and workflow integration

- [x] 4.1 Implement chapter-level Scene Engine generation with one OMP call and atomic multi-scene persistence; verify deterministic fake output creates ordered current scenes.
- [x] 4.2 Implement one-scene creative regeneration with revision increments; verify neighboring scenes, chapter text, and media remain unchanged.
- [x] 4.3 Implement independent image-prompt refresh and stale prompt status; verify style/location dependency changes preserve scene structure.
- [x] 4.4 Materialize scene workflow steps and selected-chapter batch scheduling on existing workflow tables; verify no second queue or image job is created.
- [x] 4.5 Dispatch scene steps through the existing worker, retry, cancellation, lease, and restart paths; verify technical retries reuse valid inputs and completed scenes are not duplicated.
- [x] 4.6 Add idempotent committed-result recovery for scene workflow steps; verify worker death after scene commit does not call OMP again.

## 5. API surfaces and selective reads

- [x] 5.1 Add thin endpoints for scene generation, listing, detail, edit, regeneration, and prompt refresh; verify routes validate input and return durable operation identifiers.
- [x] 5.2 Add paginated project/chapter scene metadata and bounded detail source excerpts; verify large projects do not return all prose, scenes, or history in one response.
- [x] 5.3 Add visual-style and location read/write endpoints with safe revision/concurrency responses; verify edits mark only dependent prompts stale.
- [x] 5.4 Add selected chapter and no-current-plan scene batch controls; verify explicit selections schedule only requested chapters with per-chapter status.

## 6. Scenes review UI

- [x] 6.1 Add a Vietnamese Scenes area with chapter counts, statuses, Generate Scenes actions, and persisted polling; verify it coexists with Story, Audio, Video, and Render areas.
- [x] 6.2 Add scene detail cards with purpose, location, characters, mood, camera, composition, visual description, prompt, and source excerpt; verify bounded detail loading.
- [x] 6.3 Add manual scene editing with optimistic revision handling; verify edits preserve historical evidence and never modify chapter text.
- [x] 6.4 Add independent scene regeneration and prompt refresh controls; verify only the selected scene updates and technical failures remain retryable.
- [x] 6.5 Add density, target-range, and project visual-style controls; verify invalid values show Vietnamese errors and style changes surface prompt staleness.

## 7. Documentation and permanent boundaries

- [x] 7.1 Document scene data model, UTF-16 source traceability, splitting/density strategy, and revision semantics in scene-engine.md.
- [x] 7.2 Document visual-style fields, location normalization/resolution, and prompt separation/versioning in visual-style.md, locations.md, and scene-prompts.md.
- [x] 7.3 Update architecture.md, workflow.md, and known-limitations.md with scene dependency boundaries, invalidation, real OMP caveats, and no-pixel-generation scope.
- [x] 7.4 Add only the useful permanent rule that Scene Engine owns visual planning, not image-provider behavior; verify no future-stage provider rules are introduced.

## 8. Automated verification

- [x] 8.1 Add deterministic scene split/persistence tests covering location change, dialogue, action, and reveal beats; verify structured scenes survive reload.
- [x] 8.2 Add source traceability tests covering UTF-16 offsets, excerpt extraction, ordering, overlap, and range-boundary rejection.
- [x] 8.3 Add character-reference and location-deduplication tests covering known IDs, unresolved names, normalized variants, and ambiguity.
- [x] 8.4 Add invalidation tests covering chapter edits, visual-style changes, location edits, and future character dependency fingerprints.
- [x] 8.5 Add single-scene regeneration, manual edit, technical retry, cancellation, optimistic conflict, and restart tests; verify sibling scenes remain unchanged.
- [x] 8.6 Add selected-batch and 20/100-chapter fake-agent scale tests; verify pagination, persistence, restart recovery, and bounded response sizes.
- [x] 8.7 Run existing Story Engine, long-story, TTS, subtitle, render, build, typecheck, and lint verification; verify no regression in the first-working-video path.

## 9. Real OMP and quality verification

- [x] 9.1 Run readiness/authentication checks and one real OMP scene-planning request against an existing generated chapter; verify validated scenes and provenance persist.
- [x] 9.2 Regenerate one real OMP scene independently; verify a new scene revision appears while neighboring scenes remain unchanged and usage stays honest.
- [x] 9.3 Manually inspect real scene boundaries, story beats, characters, locations, continuity, and prompt visual quality; record observed weaknesses and limitations.
- [x] 9.4 Review every success criterion and final boundary; verify no image/video provider, automatic media handoff, scraping, or unimplemented placeholder remains before reporting readiness.
