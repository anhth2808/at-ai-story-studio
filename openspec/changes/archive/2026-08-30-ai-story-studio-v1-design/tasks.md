## 1. Research Grounding

- [x] 1.1 Inventory aggregate and per-project research documents; verify all ten requested references have source-grounded notes.
- [x] 1.2 Extract license and reuse boundaries; verify GPL/LGPL and permissive-license implications are distinguished.

## 2. Product and Core Architecture

- [x] 2.1 Define V1 scope, non-goals, success criteria, and creation modes; verify both generate and adapt flows are covered.
- [x] 2.2 Define modular-monolith modules and deployment/data boundaries; verify V1 has no required distributed infrastructure.
- [x] 2.3 Define revisioned project/story domain entities and invariants; verify every required domain model is named.
- [x] 2.4 Define bounded chapter-context selection and adaptation transformation; verify chapter 27 does not require full prior prose.

## 3. Durable Production Pipeline

- [x] 3.1 Define workflow states, attempts, dependencies, retry, invalidation, checkpoints, errors, leases, and recovery; verify chapter 5 invalidation is scoped.
- [x] 3.2 Define provider interfaces, cost tiers, secrets, local-process boundaries, and first adapters; verify workflow definitions contain no provider branches.
- [x] 3.3 Define immutable asset metadata, lineage, fingerprints, commit protocol, and reconciliation; verify stale output remains explainable.
- [x] 3.4 Define text cleaning, segment/chunk TTS, independent retry, validation, and merge; verify one failed chunk can retry alone.
- [x] 3.5 Define known-text SRT generation and optional WhisperX alignment; verify future word/karaoke timing has a structured model.
- [x] 3.6 Define V1 visual sources, neutral timeline, FFmpeg execution/progress/cancellation, and ffprobe validation; verify no AI video dependency exists.

## 4. Platform and Product Surface

- [x] 4.1 Propose SQLite/EF Core tables, keys, relationships, and indexes; verify all minimum requested entities are represented.
- [x] 4.2 Define SQLite-backed worker claiming, batching, progress, retry, cancellation, logging, and restart recovery; verify no broker is required.
- [x] 4.3 Define minimum project/story/chapter/audio/video/render/settings UI; verify failed/stale units expose retry and impact details.
- [x] 4.4 Select .NET, React, SQLite, BackgroundService, filesystem, and FFmpeg stack; verify Python is restricted to AI adapters.

## 5. Evolution and Review

- [x] 5.1 Classify every reference recommendation as LEARN FROM, WRAP, REIMPLEMENT, OPTIONAL, or DO NOT USE; verify all ten projects and licenses appear.
- [x] 5.2 Define additive V1–V5 evolution and scaling triggers; verify scenes/images/video/evaluation extend existing seams.
- [x] 5.3 Record decisions, alternatives, rationale, trade-offs, future impact, and risks; verify legal, cost, storage, concurrency, media, and secret risks are present.
- [x] 5.4 Publish executive navigation and M0–M7 implementation milestones; verify all requested documents and links resolve.
