# ai-story-studio-v1-design Specification

## Purpose
Define the externally reviewable architecture package for AI Story Studio V1 so implementation can begin from explicit product behavior, persistence, workflow, provider, media, and evolution contracts without introducing application code.

## Requirements

### Requirement: Complete V1 design package
The design package SHALL contain every document listed in the proposal under `docs/design-v1/`, with `README.md` providing an executive summary and navigation.

#### Scenario: Reviewer opens the design package
- **WHEN** a reviewer starts at `docs/design-v1/README.md`
- **THEN** the reviewer can navigate to product scope, architecture, domain, story, workflow, provider, asset, TTS, subtitle, render, database, job, UI, stack, reference, roadmap, and risk decisions

### Requirement: Small local-first architecture
The design SHALL specify a TypeScript-first modular monolith suitable for a personal/local application and SHALL exclude microservices, distributed brokers, Kubernetes, event sourcing, mandatory cloud infrastructure, and a mandatory Python backend from V1.

#### Scenario: Developer selects the V1 deployment model
- **WHEN** a developer reviews the system and technology decisions
- **THEN** the selected baseline uses a pnpm workspace with Node.js, TypeScript, React, Vite, Fastify, SQLite, Drizzle ORM, a database-backed Node.js worker, local filesystem assets, provider interfaces, and FFmpeg/ffprobe
- **AND** Python is limited to an optional explicit sidecar or subprocess boundary when native Node integration, an external HTTP API, or an existing service API is not practical
- **AND** the architecture preserves the approved V1 product scope and introduces no application code

### Requirement: Durable dependency-aware workflow
The design SHALL define persisted workflow steps with PENDING, RUNNING, COMPLETED, FAILED, INVALIDATED, and CANCELLED states, independent retry, restart recovery, checkpoints, progress, errors, cancellation, and dependency-based invalidation.

#### Scenario: A chapter changes after audio exists
- **WHEN** chapter 5 text is saved as a new revision
- **THEN** chapter 5 TTS, chapter 5 subtitles, and final render become invalidated
- **AND** analysis, blueprint, chapters 1-4, and chapters 6 onward remain current

### Requirement: Long-story context is bounded
The story-engine design SHALL generate a chapter from a bounded context containing the global blueprint, relevant characters, the current chapter plan, selected prior summaries, and important unresolved events rather than all preceding chapter text.

#### Scenario: Chapter 27 is generated
- **WHEN** the story engine builds chapter 27 context
- **THEN** it records the selected context items and their revisions
- **AND** it does not require chapters 1-26 in full

### Requirement: Provider-independent orchestration
The design SHALL define capability-based interfaces for LLM, TTS, ASR, image, video, and translation providers and SHALL keep provider-specific request, authentication, retry, and process behavior outside workflow orchestration.

#### Scenario: The user changes TTS provider
- **WHEN** a compatible provider configuration is selected for future TTS work
- **THEN** workflow definitions remain unchanged
- **AND** only outputs whose input fingerprint includes the previous provider configuration are stale or regenerated

### Requirement: Recoverable long-form media processing
The TTS, subtitle, asset, job, and render designs SHALL make long operations resumable at the smallest practical unit, including individual TTS chunks, while producing deterministic manifests for retries.

#### Scenario: One TTS chunk fails
- **WHEN** a chapter contains completed chunks and one failed chunk
- **THEN** the user can retry the failed chunk without synthesizing completed unchanged chunks again

### Requirement: Reference use is classified and license-aware
The reference design SHALL classify recommendations for all ten researched projects using LEARN FROM, WRAP, REIMPLEMENT, OPTIONAL, or DO NOT USE and SHALL explain relevant license boundaries.

#### Scenario: A reference is GPL or LGPL licensed
- **WHEN** architecture draws on that reference
- **THEN** the design distinguishes learning from architecture, external-process wrapping, and direct source reuse
- **AND** it does not recommend copying source without an explicit compatible licensing decision

### Requirement: Incremental implementation path
The executive summary SHALL answer the requested final question with the smallest milestone sequence from an empty repository to an automatically generated YouTube-ready story video.

#### Scenario: One developer begins implementation
- **WHEN** the developer follows the milestones in order
- **THEN** each milestone produces a testable vertical capability and avoids dependencies on future image or video generation
