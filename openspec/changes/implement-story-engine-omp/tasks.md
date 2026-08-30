## 1. OMP Runtime Spike and Boundary Contract

- [x] 1.1 Verify the current OMP SDK package, Bun 1.3.14+ runtime, documented session APIs, model discovery, and authentication flow with a minimal Bun host; verify by running one authenticated structured prompt and recording the exact tested versions.
- [x] 1.2 Define and schema-test the versioned newline-delimited JSON request, progress, terminal result, and terminal error envelopes; verify malformed versions, duplicate terminal messages, oversized lines, and missing correlation IDs are rejected.
- [x] 1.3 Pin the tested OMP package/runtime requirements and add the isolated Bun host entrypoint without importing OMP SDK types into Node or domain packages; verify dependency boundaries with the workspace typecheck/build.
- [x] 1.4 Extend the existing safe process runner contract for the OMP host's separate executable arguments, bounded stdout/stderr, deadline, AbortSignal, and process-tree termination; verify a fake host covers success, timeout, cancellation, invalid protocol, and unexpected exit.
## 2. Story Domain Schemas and Persistence

- [x] 2.1 Add shared English-compatible runtime schemas and DTOs for story settings, blueprint, characters, plan revisions/items, threads, summaries, chapter generation envelopes, generation metadata, and safe readiness/errors; verify invalid enum, bound, identifier, and payload cases fail without unsafe coercion.
- [x] 2.2 Add the SQLite/Drizzle migration for settings revisions, blueprint revisions, plan revisions/items, threads/thread revisions, chapter summaries, generation records, and optional chapter story lineage; verify foreign keys, cascade behavior, current-pointer uniqueness, stable plan-item IDs, and existing V1 database upgrade.
- [x] 2.3 Add repositories for revision creation, current selection, lineage reads, compact thread/summary reads, generation metadata, and atomic current-pointer promotion; verify prior revisions remain queryable and failed validation cannot replace current state.
- [x] 2.4 Extend chapter persistence with generated/manual origin and plan/generation lineage while preserving existing chapter ownership, ordering, revision, and editor contracts; verify legacy chapters remain manual and existing chapter APIs still return valid DTOs.
- [x] 2.5 Implement transactional scoped invalidation for settings, blueprint, plan item, generated chapter, summary, narration, subtitle, and render descendants; verify changing one plan item does not invalidate unrelated chapters or assets.

## 3. Story Engine Core

- [x] 3.1 Add the application-owned `AiAgent` request/result contract and one Node-side `OmpAgent` adapter that knows only the local protocol and safe application error categories; verify a fake agent can be substituted without OMP imports.
- [x] 3.2 Add versioned pure prompt renderers for blueprint, chapter plans, chapter generation, and summary generation with explicit trusted-context and untrusted-story-data sections; verify prompt versions and input fingerprints are deterministic.
- [x] 3.3 Add strict runtime output schemas and parsers for blueprint, plan, chapter envelope, summary, events, character changes, thread transitions, used/introduced characters, unresolved threads, warnings, and usage metadata; verify malformed/free-form model output never commits.
- [x] 3.4 Implement deterministic bounded GenerationContext compilation from current blueprint, selected characters, plan item, prior/recent summaries, relevant facts, open threads, and instructions; verify default 5,000-token-equivalent bounds, stable ordering, omitted-context diagnostics, and no full-history prose assembly.
- [x] 3.5 Implement Story Engine application services for blueprint, plan, chapter, and summary operations with prerequisite checks, context fingerprints, validation, atomic revision commits, provenance, and retryable failures; verify successful chapter generation creates an ordinary reviewable chapter and does not enqueue media.
- [x] 3.6 Implement explicit manual-edit conflict handling for generated chapters, stale summaries, continuity warnings, and replacement of newer manual revisions; verify later generation cannot silently overwrite manual content.

## 4. Isolated Bun OMP Host

- [x] 4.1 Implement the Bun host's request loop using the documented OMP SDK session lifecycle, request-scoped/in-memory sessions, explicit model/auth wiring, progress reduction, and `dispose` cleanup; verify success, provider error, and cleanup on thrown failure.
- [x] 4.2 Configure the OMP host with MCP/LSP and arbitrary host tools disabled or restricted, no custom story tools, bounded working state, and prompt/data separation; verify a tool-like story instruction cannot execute a command or access project files.
- [x] 4.3 Implement host-side deadline, AbortSignal/cancellation handling, bounded structured response parsing, credential/error redaction, and terminal protocol behavior; verify timeout and cancellation terminate the session/process without returning partial success.
- [x] 4.4 Implement safe OMP readiness/configuration reporting for authenticated model availability, runtime health, selected model, and setup guidance without returning credentials; verify API/client/log output contains no API key, token, or credential-file contents.

## 5. Durable Story Workflow Integration

- [x] 5.1 Add the four Story AI workflow step types and shared step DTOs for `GENERATE_STORY_BLUEPRINT`, `GENERATE_CHAPTER_PLANS`, `GENERATE_CHAPTER`, and `GENERATE_CHAPTER_SUMMARY`; verify existing V1 step types and status transitions remain compatible.
- [x] 5.2 Add scheduling/application services that persist staged executions and dependencies before work begins, including blueprint-to-plan and plan-to-chapter prerequisites; verify blocked chapters do not call the AI boundary.
- [x] 5.3 Register Story Engine executors in the existing worker and persist progress, operation stage, attempt, model, prompt version, safe diagnostics, and terminal output lineage; verify status remains visible after the initiating API request ends.
- [x] 5.4 Implement chapter generation commit semantics so a validated chapter envelope promotes chapter content and its initial summary together, while explicit summary regeneration is an independently retryable step; verify summary recovery does not rerun chapter content or sibling chapters.
- [x] 5.5 Integrate Story AI input fingerprints with existing retry, lease, restart-recovery, cancellation, and worker-lost handling; verify completed story steps are not rerun after restart and lost OMP work is never promoted.
- [x] 5.6 Enforce no automatic TTS, subtitle, background, or render enqueue from any Story AI executor; verify only the existing explicit narration action creates downstream media work.

## 6. API and Project Integration

- [x] 6.1 Add validated API routes for story snapshot/settings, current revisions, blueprint/character reads, chapter plans/items, summaries/threads/warnings, generation requests, durable status, retry, cancel, and OMP readiness; verify routes remain thin and return client-safe errors.
- [x] 6.2 Add explicit story settings update behavior with supported V1 `IDEA_TO_STORY` mode, normalized values, revision creation, scoped invalidation, and no implicit generation; verify adaptation/import requests are rejected.
- [x] 6.3 Add API actions for per-chapter generation and summary regeneration with optimistic-concurrency/source-revision checks; verify a stale request cannot replace a newer manual or plan revision.
- [x] 6.4 Connect approved generated/current chapters to the existing narration endpoint/action without changing TTS segmentation, subtitle, background, or render ownership; verify the handoff uses the selected chapter revision fingerprint.
- [x] 6.5 Expose safe generation provenance and readiness data while redacting secrets, full prompts, full source prose, raw provider payloads, and stack traces; verify representative provider errors are translated consistently.

## 7. Story Workspace UI

- [x] 7.1 Add typed Story API clients/hooks and persisted snapshot loading with explicit loading, empty, stale, failed, cancelled, and retry states; verify a reload after worker/API restart reflects database state.
- [x] 7.2 Add the Story tab/settings form for idea, language, genre, tone, audience, target chapters, length, pacing, content boundaries, character/world notes, plot requirements, and generation settings; verify field-level validation and safe OMP readiness display.
- [x] 7.3 Add blueprint and character review cards showing premise, themes, world rules, plot direction, required character fields, revisions, and provenance; verify manual edits create a new revision and expose dependent stale state.
- [x] 7.4 Add chapter-plan list and per-item generation controls with stable ordering, plan fields, current/stale/failed state, progress, retry, and cancellation; verify retrying one failed chapter does not rerun completed siblings.
- [x] 7.5 Integrate generated chapter content, summary, threads, continuity warnings, generated/manual lineage, and explicit replacement confirmation into the existing chapter editor; verify editing does not auto-start TTS.
- [x] 7.6 Add the explicit Vietnamese narration handoff action and preserve existing media tabs/flows; verify approved chapter narration status is displayed separately from Story AI status.

## 8. Behavioral Verification

- [x] 8.1 Add fake-agent tests for schema validation, provider-independent contracts, deterministic prompt/context fingerprints, 5,000-token-equivalent context bounds, selected-character/thread ordering, and missing-summary diagnostics; verify plausible malformed outputs fail.
- [x] 8.2 Add database/workflow tests for revision lineage, current-pointer promotion, scoped invalidation, manual-edit conflict, independent summary retry, cancellation, lease recovery, and restart recovery; verify completed expensive units are not regenerated.
- [x] 8.3 Add protocol/OMP-host integration tests for model-unavailable, tool restriction, redaction, timeout, cancellation, malformed response, provider failure, host exit, session disposal, and bounded diagnostics; verify no secret crosses persistence or logs.
- [x] 8.4 Add an end-to-end fake-agent smoke path for idea settings -> blueprint -> plans -> chapter 1/2/3 -> manual edit -> explicit TTS, and verify no automatic media workflow appears after Story generation.
- [ ] 8.5 Run the real OMP-backed three-chapter smoke path with supported authentication/model configuration, including worker restart between chapters and explicit TTS for one generated chapter; verify the observed result and record safe diagnostics.
- [x] 8.6 Exercise context sizing for 50, 100, and 200 planned chapters and verify bounded context construction, compact summaries/threads, no full-history prompt, and no vector/embedding dependency.

## 9. Documentation and Release Gate

- [x] 9.1 Update implementation architecture, setup, workflow, and known-limitations documentation with the Story Engine boundary, Bun/OMP prerequisites, configuration/readiness steps, secret handling, and review-first media handoff; verify docs contain no unsupported SDK API claims.
- [x] 9.2 Document the exact tested OMP package/runtime/model setup and the local protocol troubleshooting path; verify a clean local setup can reach readiness without exposing credentials.
- [x] 9.3 Preserve V1 regression coverage and run the repository's typecheck, build, lint, and test commands after Story Engine verification; verify existing manual project -> TTS -> subtitle -> background -> render behavior remains green.
- [x] 9.4 Record `READY_FOR_LONG_STORY = YES` only if the real OMP smoke, restart recovery, explicit TTS handoff, bounded 50/100/200 context checks, and secret-safety checks all pass; otherwise record `NO` with the failing gate and do not claim readiness.
