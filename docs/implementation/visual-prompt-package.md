# Visual Prompt Package

A Visual Prompt Package is the persisted, deterministic input for a future
image provider. It belongs to one Scene revision and includes the resolved
canonical profiles, selected variants, temporary Scene state, Style Bible
snapshot, camera/composition, lighting/mood, positive prompt, negative prompt,
consistency status, issues, dependencies, and input fingerprint.

## Assembly

`visual-prompt-v1` emits bounded text in this fixed order:

```text
Subject/action
Characters
Location
Objects
Camera/composition
Lighting/mood
Style Bible
Positive suffix
```

Canonical character identity is emitted before a selected variant and Scene
appearance state. Location profile facts are emitted before Scene environment
state. Object resolution is explicit before fallback matching. Negative
fragments are deduplicated case-insensitively with a bounded result.

## Consistency

- `PASS`: all required references and approved profiles resolve.
- `WARN`: the package remains usable but has ambiguity, stale, or optional
  conflicts.
- `FAIL`: required Style Bible, profile, or identity resolution is missing.

Issues are typed, bounded, and returned to the UI. A draft-only profile is not
applied as canonical identity; the package reports that approval is pending.

## Persistence and refinement

Building the same package for the same Scene revision and inputs is idempotent.
Package and dependency rows are committed together. A dependency revision or
Scene object mapping change stales only the affected current package; historical
snapshots remain queryable.

Optional OMP refinement receives the canonical package fingerprint and may only
commit a strictly validated result that returns that same fingerprint. The
refined text is an additional revision and does not replace canonical package
constraints. No package build or refinement generates pixels or starts media
rendering.

## Shot package quality

Shot packages store deterministic ordered bindings with stable entity IDs,
Asset IDs, hashes, and revisions. Prompts contain visible facts only:
Location remains available at every framing size, while off-screen identity
text is removed. Safety refinement preserves the binding placeholder
multiset; stale or missing bindings fail before provider submission.
