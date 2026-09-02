# Image generation

Scene images are an explicit authoring step after a current Visual Prompt Package exists:

```text
CURRENT Visual Prompt Package -> GENERATE_SCENE_IMAGE -> validate -> Asset -> Scene current image
```

The image service reads the package `fullPrompt`, `negativePrompt`, reference Asset identifiers, and dependency fingerprint. It does not rebuild Story context or mutate canonical visual profiles.

## Generations, candidates, and seeds

Each creative attempt creates an immutable Scene image generation revision with its own provider prompt UUID, workflow step, job, concrete seed, settings snapshot, and fingerprint. `RANDOM` resolves through Node crypto before scheduling. `FIXED` uses the configured seed.

Prompt #11 adds bounded candidate sets: one Scene can generate 1-4 candidates in one request (`candidateCount`), grouped by a persisted candidate set with common provenance. Multi-candidate seeds are unique (fixed-seed sets use the configured seed for Candidate 1, deterministic successors after). Candidate grouping never enters fingerprints; candidates are independently retryable.

Current-image safety: completing candidates never silently replaces an existing current image. Multi-candidate results always wait for explicit Accept (which atomically sets review ACCEPTED + current pointers). A single fresh completion may keep the legacy first-image behavior only when no current image exists and `requireImageApproval` is off.

Multi-candidate batches are hard-limited to 40 total jobs, validated before any write.

Technical retry reuses the same generation, seed, fingerprint, and provider prompt UUID. It first checks ComfyUI history and queue state to avoid duplicate submission. Creative regeneration creates a new revision:

- Same seed keeps the previous concrete seed.
- New seed resolves and persists a new concrete seed.

## Freshness, review, and current selection

Generated freshness is derived from the current Visual Prompt Package and current image settings fingerprints. A result that finishes after either input changes is retained as historical output but is not selected current. Manual images are validated independently and are not stale because provider settings changed.

Review state is `UNREVIEWED`, `ACCEPTED`, or `REJECTED` plus a structured review (1-5 scores, issue tags, notes) documented in `image-quality.md`. Review never changes current selection by itself; `Accept` atomically sets `ACCEPTED` and makes the candidate the Scene's current image. Set Current remains available for explicit history management. The optional `requireImageApproval` policy gates downstream production readiness without affecting generation.

The API supports an explicit bounded Scene selection and one Chapter's missing or stale eligible Scenes. It skips duplicate successful or pending work. There is no action that silently schedules every Scene in a project.

## Conditioning

Reference conditioning is documented in `reference-conditioning.md` and `image-consistency.md`. `text-to-image-v1` remains the default and unchanged path.
Feedback-aware regeneration is documented in `regeneration-feedback.md`.
