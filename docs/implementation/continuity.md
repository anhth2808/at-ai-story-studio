# Continuity review

Continuity status is separate from workflow and media status. A chapter can have playable media while its narrative lineage is stale.

## Statuses

- `CURRENT`: the chapter is based on the current accepted StoryState lineage.
- `CONTINUITY_STALE`: a prior chapter changed or a reusable delta is missing; later generated content is preserved but requires review.
- `NOT_ANALYZED`: a manual or legacy chapter has no accepted structured delta.
- `continuity_check_status`: an independent `PASS`, `WARN`, or `FAIL` result. A warning or failed check does not masquerade as a failed workflow step.

## User choices

When an older chapter changes, the application preserves the suffix and pauses affected pending batch work. The user can:

1. Keep the stale suffix for review. This changes the review disposition only; the stale marker remains visible.
2. Rebuild continuity from the last valid checkpoint before a selected chapter. The application applies only deltas whose chapter revision and source state revision still match. It stops at the first missing or unsafe delta and leaves the remaining suffix stale.
3. Regenerate the selected chapter. The new revision is accepted against the checkpoint before that chapter, and later generated chapters remain preserved but stale.
4. Analyze a manual chapter. The model returns a bounded proposal containing summary, StateDelta, and continuity issues. Nothing mutates until the user explicitly accepts the proposal.

There is no autonomous continuity-failure regeneration loop. Explicit action is required before applying a manual analysis or rebuilding a stale suffix.

## Endpoints

The API exposes chapter analysis, continuity-check scheduling/results, manual-analysis acceptance, and rebuild routes under `/api/projects/:projectId/story`. Rebuild responses report the applied chapter numbers, the first blocked chapter, and a safe reason. Context diagnostics expose gap markers and omitted sections used by subsequent generation.

Continuity rebuilding is application-owned and deterministic. OMP only supplies validated proposals and checks; it never stores or mutates project state.
