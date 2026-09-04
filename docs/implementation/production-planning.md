# Production Planning

Planning has two separate operations:

1. **Preflight** checks project and provider readiness.
2. **Plan** classifies bounded work and calculates estimates.

Both operations are read-only. They do not insert workflow executions, jobs,
provider prompts, Assets, revisions, or media files.

## Scope

A request is `FULL_PROJECT` or an inclusive `CHAPTER_RANGE`. The planner reads
only selected chapter and Scene identities plus bounded revision/status fields.
It does not load full novel prose, media bytes, raw provider graphs, or every
historical revision into the response. Plan units are capped at 100 per stage.

## Classifications

- `REUSE`: a current canonical record or Asset matches the expected fingerprint
  and quality/currentness policy.
- `BUILD`: required work is missing or stale and an existing service can create
  it.
- `REVIEW`: output exists but a configured human gate is required.
- `BLOCKED`: a required input, provider, resource, or continuity condition is
  unavailable.

Every unit includes a stable key, stage, optional entity ID, bounded message,
and named dependencies. Stage counts include reuse, build, review, and blocked
work. A plan never implies that a provider has been called.

## Preflight checks

Preflight validates project/scope and checks Story, chapter, continuity, media,
OMP, TTS, image, AI-video, FFmpeg, ffprobe, model, and disk readiness through
existing boundaries. It reports blocking issues separately from warnings.
Optional AI-video absence is warning-only when the selected profile explicitly
enables Ken Burns fallback. A required provider or resource failure blocks the
run before executable work is created.

## Fingerprints and estimates

The planner fingerprint includes project, normalized scope, profile revision,
canonical revision identifiers, Asset hashes, and relevant settings. Repeated
preflight/plan calls with unchanged inputs return stable fingerprints and do
not mutate current pointers.

Duration, cost, GPU, storage, token, and remaining-work values are nullable or
marked unknown when no historical metric supports them. Estimates are never
reported as exact, free, or completed work.

## Invalidation

Dependency changes invalidate only descendants in the selected scope. A
chapter edit does not stale unrelated chapters. A background change invalidates
render descendants, not narration. Timing or subtitle changes invalidate the
affected timeline/render descendants, not reusable raw AI motion. Manual
replacement remains authoritative and is reflected by a new fingerprint.
