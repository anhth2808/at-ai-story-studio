# Visual consistency

The Visual Consistency Layer is a review-first authoring boundary between the
Scene Engine and any future image provider:

```text
Story / Scene -> Visual Bible -> Visual Prompt Package -> explicit image handoff
```

It does not generate pixels, upload images, or start a media job. It persists
canonical visual facts and deterministic prompt packages that a future provider
can consume.

## Canonical identity

- Character identity belongs in `character_visual_profiles`.
- Location identity belongs in `location_visual_profiles`.
- Recurring object identity belongs in `visual_object_profiles`.
- Scene-specific clothing, injury, expression, pose, action, position, and held
  objects remain in Scene visual state.
- A Scene variant selects a bounded profile variant. It does not mutate the
  canonical profile.

Profiles are revisioned. The current pointer is the approved profile when one
exists. A generated candidate is stored as `DRAFT`; it is never silently used
as canonical identity until a reviewer approves the revision.

## Style Bible

`visual_style_settings` is the project Style Bible. It stores provider-neutral
medium, style language, palette, lighting, texture, environment, character
rendering, camera, composition, mood, aspect ratio, positive suffix, negative
prompt, and optional reference asset IDs. Style presets write normal Style
Bible revisions and preserve historical rows.

## Prompt packages

A Visual Prompt Package is a revisioned snapshot for one Scene revision. The
`visual-prompt-v1` resolver assembles bounded text in this order:

1. subject and action
2. canonical characters, variants, then Scene state
3. canonical location and Scene environment state
4. recurring objects
5. camera and composition
6. lighting and mood
7. Style Bible
8. positive suffix

Negative fragments are merged with bounded, case-insensitive deduplication.
Each package stores a stable fingerprint and dependency rows for the Style
Bible, profiles, and revisions used to build it.

## Statuses and invalidation

- Profile: `DRAFT`, `APPROVED`, `STALE`.
- Package: `CURRENT`, `STALE`, `FAILED`.
- Consistency: `PASS`, `WARN`, `FAIL`.

Changing a profile or Style Bible revision marks only matching current prompt
packages stale. Changing a Scene object mapping marks only that Scene package
stale. Historical packages remain queryable. Story text, StoryState, Scene
structure, TTS, subtitles, backgrounds, renders, and unrelated projects are
not invalidated by visual-only changes.

## Provider boundary

Node/TypeScript owns context compilation, schemas, fingerprints, persistence,
workflow state, retries, and dependency invalidation. The isolated OMP host
receives one bounded provider-neutral request and returns structured text plus
usage metadata. The Node boundary validates every candidate before persistence.
No SDK types, credentials, arbitrary tools, or filesystem paths cross into the
workflow layer. Future image providers consume persisted packages; this layer
never calls one.

## Reference-first quality

Character prototypes and appearance stages are revisioned candidates, while
Location references use hard geometry only. Generation is blocked on missing
exact approved references; no display-name or similar-stage substitution is
allowed. Automatic critic results remain separate from human approval and do
not mutate canonical profiles or packages.
