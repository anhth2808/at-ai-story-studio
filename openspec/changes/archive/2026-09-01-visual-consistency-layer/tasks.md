## 1. Shared contracts and prompt vocabulary

- [x] 1.1 Add bounded visual profile payload schemas for characters, locations, and objects; verify valid fields parse and unknown/unbounded fields fail.
- [x] 1.2 Add Style Bible fields, presets, statuses, update/approval/reference requests, and DTOs; verify provider-specific image settings are rejected.
- [x] 1.3 Add Scene visual-state variant and explicit appearance override fields without duplicating canonical profile data; verify existing Scene fixtures still parse.
- [x] 1.4 Add Visual Prompt Package, dependency, consistency issue, and list/detail DTO schemas; verify strict status and issue values.
- [x] 1.5 Add visual profile-generation/refinement envelopes, workflow step types, and generation operations; verify legacy Story and Scene contracts still parse.
- [x] 1.6 Define `visual-prompt-v1` stable serialization, fingerprint inputs, and canonical prompt ordering; verify identical structured inputs produce identical hashes and text.

## 2. Additive persistence and repositories

- [x] 2.1 Add migration 0009 for character/location/object profile revisions and prompt packages; verify an existing database migrates without resets and preserves Scene/Story rows.
- [x] 2.2 Extend `visual_style_settings` for Style Bible fields and reference asset roles; verify old style rows receive safe defaults and current pointers remain valid.
- [x] 2.3 Add `scene_object_resolutions` and indexed package dependency tables; verify foreign keys, filtered current indexes, and dependency-kind constraints.
- [x] 2.4 Mirror migration 0009 in the Drizzle schema; verify table columns, indexes, status checks, and project ownership relations match SQL.
- [x] 2.5 Implement revision repositories for character, location, and object profiles; verify current-pointer, optimistic-concurrency, candidate, approval, and historical revision behavior.
- [x] 2.6 Implement Style Bible read/write/preset persistence by extending the existing style repository; verify edits create revisions and preserve prior styles.
- [x] 2.7 Implement explicit Scene object-resolution persistence and conservative normalized matching; verify exact matches reuse one profile and ambiguity stays unresolved.
- [x] 2.8 Implement Visual Prompt Package persistence with atomic dependency rows; verify package revisions survive reload and package dependencies are queryable by kind/key.
- [x] 2.9 Validate reference asset IDs against project ownership and allowed asset types; verify invalid or cross-project references cannot be persisted.

## 3. Deterministic visual resolution

- [x] 3.1 Add bounded character, location, object, and Style Bible resolver queries; verify a single Scene read does not load unrelated projects or all historical rows.
- [x] 3.2 Resolve canonical character profiles with selected variants and Scene visual state; verify canonical fields remain unchanged after temporary injury, clothing, expression, or action state.
- [x] 3.3 Resolve locations from canonical visual profiles plus Scene time, weather, lighting, and environment state; verify unresolved locations remain visible.
- [x] 3.4 Resolve recurring objects through explicit mapping then exact normalized keys; verify casing variants reuse one object and ambiguous names warn.
- [x] 3.5 Implement deterministic negative-prompt merge and bounded deduplication; verify style, profile, and Scene negatives retain distinct values without duplicates.
- [x] 3.6 Implement fixed Visual Prompt Package assembly order; verify action, characters, location, objects, camera/composition, lighting/mood, Style Bible, and suffix appear predictably.
- [x] 3.7 Implement deterministic consistency checks for missing profiles, conflicts, unresolved references, stale dependencies, and style mismatches; verify PASS/WARN/FAIL and bounded issue payloads.
- [x] 3.8 Implement package fingerprint calculation from Scene/profile/variant/style/object revisions, state, and template version; verify profile and template changes alter the hash.
- [x] 3.9 Persist current package snapshots and dependency rows from the resolver; verify rebuilding identical inputs is idempotent and does not change Scene or chapter revisions.
- [x] 3.10 Implement optional character variant selection and future-compatible location variant keys; verify base identity plus variant plus Scene state ordering and unknown-variant warnings.

## 4. OMP profile generation and refinement

- [x] 4.1 Add versioned prompt modules for character, location, object profile generation, and optional prompt refinement; verify bounded context and provider-neutral instructions.
- [x] 4.2 Compile bounded generation context from Story definitions, StoryState, locations, relevant scenes, and Style Bible; verify late-story requests exclude full novel prose.
- [x] 4.3 Implement candidate generation with strict structured validation and provenance; verify valid candidates persist as DRAFT and invalid output preserves approved profiles.
- [x] 4.4 Implement explicit profile approval, manual edit, and creative regeneration semantics; verify approved/manual revisions are never silently overwritten.
- [x] 4.5 Implement optional prompt refinement against canonical package constraints; verify conflicting refined text is rejected/flagged and deterministic text remains usable.
- [x] 4.6 Extend the isolated OMP protocol allowlist and operation mapping; verify SDK types, credentials, arbitrary tools, and filesystem paths do not cross the Node boundary.

## 5. Visual workflow and scoped invalidation

- [x] 5.1 Add persisted profile-generation, single-package-build, chapter-package-build, and optional refinement step handling; verify workflow status, progress, and durable IDs.
- [x] 5.2 Schedule missing/stale package builds for one chapter and selected chapters with bounded SQL selection; verify no all-project payload is materialized.
- [x] 5.3 Integrate visual steps into the existing worker executor and cancellation/deadline path; verify no second queue or image-provider job is created.
- [x] 5.4 Commit validated profile/package data before completing workflow steps; verify worker restart reuses matching committed fingerprints instead of duplicating OMP calls.
- [x] 5.5 Preserve technical retry versus creative regeneration semantics; verify technical retry keeps inputs and creative regeneration creates a new profile/package revision.
- [x] 5.6 Invalidate package dependencies when character, location, object, or Style Bible revisions change; verify only matching current packages become STALE.
- [x] 5.7 Keep visual invalidation isolated from Scene structure and media descendants; verify chapter, StoryState, TTS, subtitle, background, render, and unrelated-project records remain unchanged.

## 6. API and selective reads

- [x] 6.1 Add paginated character/location/object profile list and detail endpoints; verify project ownership, bounded payloads, and historical/current status fields.
- [x] 6.2 Add Style Bible read/update/preset endpoints with optimistic revision handling; verify invalid updates preserve the current revision.
- [x] 6.3 Add profile generate, approve, edit, regenerate, and reference-slot endpoints; verify actions return durable operation identifiers where work is asynchronous.
- [x] 6.4 Add Scene object-resolution and Visual Prompt Package read/rebuild/refine endpoints; verify rebuild uses the current Scene revision without replanning.
- [x] 6.5 Add consistency result and selected-chapter prompt-build APIs; verify warnings are returned explicitly and list responses exclude full chapter prose.
- [x] 6.6 Keep Fastify routes thin and shared-schema validated; verify resolver/workflow decisions remain outside route handlers.

## 7. Visual Bible and Scene UI

- [x] 7.1 Add Visual Bible navigation beside Story, Scenes, Audio, Video, and Render; verify Vietnamese labels and persisted empty states.
- [x] 7.2 Build character profile list/detail/edit/approve/regenerate views; verify canonical fields, status, revision, prompt fragment, variants, references, and errors are visible.
- [x] 7.3 Build location and recurring-object profile views with explicit resolution controls; verify ambiguous/missing references show actionable Vietnamese warnings.
- [x] 7.4 Build Style Bible editor and provider-neutral preset preview; verify medium, style, palette, lighting, camera, aspect ratio, suffix, and negative prompt fields.
- [x] 7.5 Extend Scene detail with resolved package, canonical/state separation, dependency revisions, prompt, negatives, and consistency status; verify rebuild does not regenerate Scene structure.
- [x] 7.6 Add bounded pagination and persisted polling for profile/package jobs; verify reload after restart reflects database state rather than optimistic-only state.
- [x] 7.7 Add optional manual reference image controls only if the existing Asset upload path supports them without duplicate storage; verify empty slots remain valid otherwise.

## 8. Documentation and permanent boundaries

- [x] 8.1 Add `visual-consistency.md` documenting canonical identity, statuses, revisions, invalidation, and provider boundary; verify links from the implementation index.
- [x] 8.2 Add `character-visuals.md` documenting profile fields, scene state, variants, approval, and fingerprints; verify examples distinguish canonical and temporary data.
- [x] 8.3 Add `location-visuals.md` and `visual-objects.md` documenting profile resolution, normalization, ambiguity, and manual mapping.
- [x] 8.4 Add `style-bible.md` and `visual-prompt-package.md` documenting provider-neutral style, assembly order, negatives, consistency checks, and fingerprints.
- [x] 8.5 Update `architecture.md`, `workflow.md`, and `known-limitations.md` with visual dependency scope, restart semantics, optional references, OMP limitations, and no-pixel boundary.
- [x] 8.6 Add only the permanent rules that canonical visual identity belongs in profiles and future image providers consume structured packages; verify no future image features are implied.

## 9. Behavioral and scale verification

- [x] 9.1 Test canonical character consistency across multiple Scenes and chapters; verify approved identity is present unless explicit Scene state overrides it.
- [x] 9.2 Test canonical location consistency across multiple chapters; verify the same profile revision and landmarks recur in packages.
- [x] 9.3 Test Style Bible consistency across many packages; verify the same style language and revision are applied.
- [x] 9.4 Test character, location, object, and Style Bible invalidation scope; verify only dependent packages stale and narrative/media state remains current.
- [x] 9.5 Test package fingerprints for identical inputs, profile revisions, Scene revisions, and template versions; verify all expected changes are detectable.
- [x] 9.6 Test Scene-specific appearance conflicts, object ambiguity, missing profiles, unresolved locations, and consistency PASS/WARN/FAIL results.
- [x] 9.7 Test character variant resolution when implemented; verify base identity, variant, and Scene state all appear without mutating the profile.
- [x] 9.8 Test profile/package persistence after API and worker restart; verify current pointers, revisions, fingerprints, statuses, and warnings survive.
- [x] 9.9 Test 100-chapter multi-scene pagination, selected-chapter builds, and indexed invalidation; verify responses and single-profile updates remain bounded.
- [x] 9.10 Run Scene Engine, Story/Long Story Engine, workflow, migration, TTS, subtitle, render, typecheck, and lint regression checks; verify the first-working-video path is unchanged.

## 10. Real OMP and quality verification

- [x] 10.1 Run OMP readiness/authentication/model checks before live testing; verify missing readiness fails safely without claiming profile success.
- [x] 10.2 Generate and persist one real Character Visual Profile candidate; verify structured validation, DRAFT status, provenance, and canonical prompt fragment.
- [x] 10.3 Generate and persist one real Location Visual Profile candidate; verify structured validation, DRAFT status, provenance, and location resolution.
- [x] 10.4 Build real Scene Visual Prompt Packages from the persisted candidates; verify fingerprints, dependency rows, warnings, and deterministic prompt ordering.
- [x] 10.5 Manually inspect generated profiles and prompts for identity stability, location/style continuity, explicit state overrides, contradictions, verbosity, and visible Scene action; record weaknesses.
- [x] 10.6 Review every success criterion and confirm no image provider, pixel generation, automatic media handoff, placeholder, or fake completion claim remains before reporting readiness.
