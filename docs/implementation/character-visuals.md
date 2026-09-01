# Character visuals

Character visual profiles are bounded, revisioned records keyed by the stable
Story character ID. They preserve visual identity without copying the full
Story into every prompt.

## Canonical fields

A profile may describe age and presentation, body type, height, face, skin,
hair, eyes, distinctive features, default expression, clothing, accessories,
color identity, visual keywords, negative traits, style notes, variants, and
reference asset IDs. Provider-specific image settings do not belong here.

The profile payload is strict and bounded. Unknown fields, oversized strings,
too many list entries, and invalid reference IDs fail at the boundary.

## Scene state

Scene visual state is temporary and additive:

- clothing
- injuries
- expression
- pose
- action
- position
- held objects
- optional `variantKey`
- optional `appearanceOverride`

The resolver emits canonical appearance first, selected variant second, and
Scene state last. A temporary injury or costume change therefore cannot rewrite
the canonical profile.

## Variants

A variant has a stable key, revision, description, bounded prompt overrides,
and no independent identity. An unknown key remains visible as a consistency
warning. Variant selection changes a package fingerprint, not the profile row.

## Approval and edits

Generated candidates are persisted with status `DRAFT`, generation provenance,
a prompt fragment, and an input fingerprint. Approval is explicit and uses an
expected revision. Approved rows are historical; a later approved revision
moves the current pointer and marks the prior approved row stale.

Manual edits use optimistic revision checks. Editing a draft keeps it a draft;
editing an approved profile creates a new approved revision and clears generated
lineage. Existing prompt packages depending on the approved revision become
stale. Failed generation never replaces an approved profile.

## Fingerprints

The profile-generation fingerprint includes the profile operation, subject,
bounded Story/StoryState context, Style Bible snapshot, relevant Scenes, and
prompt/schema versions. The package fingerprint includes the profile revision,
variant, Scene revision/state, Style Bible revision, dependencies, and template
version. Identical structured inputs produce identical fingerprints.
