# Location visuals

Location visual profiles are revisioned by project location ID. The canonical
record stores environment type, description, architecture, terrain, vegetation,
weather, lighting defaults, palette, landmarks, recurring objects, atmosphere,
keywords, negative traits, style notes, and optional reference asset IDs.

The resolver combines the approved location profile with Scene time of day,
weather, lighting, visual description, and other environment state. Scene state
is temporary; it does not overwrite landmarks or canonical environment facts.

## Resolution

A Scene location ID is preferred. When a Scene has only a name, the resolver
performs a bounded normalized project-local match:

- one match resolves the location;
- multiple matches remain unresolved and produce a visible `FAIL` issue;
- no match remains visible in the package with an unresolved or missing status.

A missing or draft-only location profile is not used as canonical appearance.
The package reports an actionable missing-profile or awaiting-approval issue.

Generated location profiles are `DRAFT` candidates with provenance. Reviewers
approve a selected revision explicitly. Manual edits use expected revisions and
preserve historical rows. Approved profile changes stale only prompt packages
that depend on that location; narrative and media descendants stay current.
