## Context

See `proposal.md` for motivation. The repository is an empty workspace and must host only parent-repository metadata and documentation; the requested upstream projects are research inputs, not source owned by this repository.

## Goals / Non-Goals

**Goals:**

- Keep the ten upstream repositories discoverable at stable, user-specified paths.
- Preserve clone history and upstream identity for local inspection.
- Ensure parent-repository version control excludes the reference trees.
- Document project mapping and future research intent.

**Non-Goals:**

- Implementing, configuring, or modifying an AI video application.
- Vendoring dependencies or copying upstream source into parent-owned files.
- Adding research conclusions before the repositories are analyzed.

## Decisions

- Prefer ordinary full Git clones so each reference retains its `.git` history and upstream metadata; use a depth-1 clone only when a full clone is impractical within the available transfer time.
- Use the exact directory names requested by the user, even when repository names differ in case or punctuation.
- Put one root-level `/references` ignore rule in the parent `.gitignore`; explicitly allow the catalog README while ignoring all cloned project trees.
- Keep `docs/` available for later workflow notes and include `.gitkeep` so the expected directory survives a parent-repository checkout.
- Describe purposes at the workflow level in `references/README.md`, avoiding claims that require executing or modifying upstream projects.

## Risks / Trade-offs

- Full clones consume more disk space than shallow clones, but preserve the requested history for research.
- Upstream repositories can change or disappear; the catalog records URLs while local Git metadata preserves the fetched state.
- Some upstream repositories may have nested submodules or large assets; clone failures must be surfaced rather than silently replaced with incomplete directories.
