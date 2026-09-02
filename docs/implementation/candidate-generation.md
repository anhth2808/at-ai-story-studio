# Candidate generation

Prompt #11 adds bounded multi-candidate generation for one Scene. GPU work stays explicit, bounded, and independently retryable.

## Candidate sets

A `scene_image_candidate_sets` row groups candidates created together. It stores the common provenance: Scene revision, Visual Prompt Package, effective conditioning mode, workflow template, package/settings fingerprints, requested count, optional source generation (regeneration), instructions, and metadata (conditioning warnings, structured review feedback).

Every candidate remains a normal `scene_image_generations` row with the complete scheduled request snapshot, its own concrete seed, provider prompt UUID, workflow step, job, Asset, status, review, and immutable history. Retry/restart recovery works per candidate without touching the set.

## API

- `POST .../scenes/:id/images/generate` with `{ "instructions": "...", "conditioningMode": "...", "candidateCount": 1|2|4 }` - creates one set and one job per candidate. Default `candidateCount` is 1.
- Batch endpoints (`/images/generate-batch`, chapter batch) accept the same `candidateCount`.
- `GET .../scenes/:id/images/candidate-sets` - bounded candidate-set listing (limit/offset).

## Seed strategy

- 1 candidate: existing `RANDOM`/`FIXED` behavior unchanged.
- Multi-candidate RANDOM: distinct random seeds, persisted before job creation.
- Multi-candidate FIXED: Candidate 1 uses the configured fixed seed exactly; later candidates take deterministic successors (seed + n, wrapped in the safe range). Every concrete seed is displayed and persisted.
- Candidate set membership and index are grouping metadata and never enter fingerprints. Seed, guidance, workflow, package/settings fingerprints, and explicit reference mappings do.

## Current-image protection

Completing candidates never silently replaces the Scene image:

- Multi-candidate results: never auto-selected. Review and accept explicitly.
- Any new completion beside an existing current image (accepted or not): stays non-current history.
- A single fresh completion may keep the legacy first-image behavior only when no current image exists and `requireImageApproval` is off.

`Accept` is the atomic promote-to-current action (see image-quality.md).

## Guardrails

- Per Scene: max 4 candidates (schema-enforced).
- Multi-candidate batches: max 40 total jobs, checked BEFORE any Scene read or write - an oversized request leaves zero sets, generations, steps, or jobs.
- Single-candidate batches keep the existing explicit 200-Scene bound.
- Effective concurrency stays 1 (existing durable worker claim model). No new queue.
