# Image consistency

How reference conditioning interacts with fingerprints, staleness, and current selection.

## Fingerprint inputs

Every Scene image generation's `inputFingerprint` is computed over:

- the Visual Prompt Package fingerprint,
- image generation settings fingerprint,
- the actual workflow template (`text-to-image-v1` or `reference-character-v1`),
- the full provider request - including `conditioning.mode` and each conditioned character's `{ characterId, referenceAssetId, referenceSha256, profileRevision }`,
- the concrete seed.

Determinism: same inputs -> same fingerprint. Changing the mode, the bound reference asset, the seed, or the structured review feedback changes the fingerprint. Candidate-set identifiers, candidate indexes, and review state never enter fingerprints.

`requireImageApproval` and candidate grouping are deliberately excluded from both fingerprints: they are product policy, not generation input.

`conditioningMode` itself is deliberately NOT part of the settings fingerprint: it is a schedule-time input (like seed mode), and the derived workflow travels inside the persisted request. Settings-row fingerprints remain stable across the upgrade.

## What a reference change does

1. Approve/attach/reorder/remove writes a new Character Visual Profile revision.
2. `invalidateDependency(CHARACTER_PROFILE)` marks CURRENT packages that depend on that profile revision `STALE`.
3. Rebuilding a package gives it a new fingerprint; its generated images report `STALE` freshness. Images from packages that do not depend on the character are unaffected, as are Story, TTS, subtitles, backgrounds, and renders.
4. No reference-change path deletes anything. Historical generations and assets remain addressable.

## In-flight safety

`executeStep` re-validates the package fingerprint and settings fingerprint before submission and again at publish (`commitGenerated` guarded by fingerprints/lease). A conditioned generation whose reference (or profile) changed while ComfyUI was running completes into history with `STALE_INPUT` handling: it is stored or failed honestly, and it never replaces the Scene's current image.

## Comparison and review

For one Scene the UI can generate both modes (project default + per-request override) and compare any two completed generations side by side with persisted metadata (mode, workflow, seed, conditioned character ids). Review status, current selection, and freshness remain independent signals, unchanged from the text-only model.

## What reference conditioning does NOT guarantee

- Not pixel-perfect identity. Klein's official positioning covers face, clothing, proportions, and style, but drift is expected and must be reviewed manually.
- Multi-character binding relies on the explicit persisted mapping plus per-subject prompt text; upstream does not quantify identity-swap risk for two conditioned people in one frame. See `conditioning-benchmark.md` for the measured verdict.
- Conditioning may pull composition toward the reference pose; the benchmark records whether this is material.

## Prompt #11 additions

- Structured review (scores/issues/notes), atomic Accept-to-current, and bounded candidate sets: see `image-quality.md` and `candidate-generation.md`.
- Feedback-aware regeneration re-resolves reference bindings from the CURRENT package and changes only the new candidate's fingerprint: see `regeneration-feedback.md`.
- The composition-bleed limitation above is exactly the failure Prompt #11 mitigates through candidate selection and feedback; the adopted advanced-control decision is `NONE` (see `advanced-image-control.md`).
