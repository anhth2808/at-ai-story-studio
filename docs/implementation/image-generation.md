# Image generation

Scene images are an explicit authoring step after a current Visual Prompt Package exists:

```text
CURRENT Visual Prompt Package -> GENERATE_SCENE_IMAGE -> validate -> Asset -> Scene current image
```

The image service reads the package `fullPrompt`, `negativePrompt`, reference Asset identifiers, and dependency fingerprint. It does not rebuild Story context or mutate canonical visual profiles.

## Generations and seeds

Each creative attempt creates an immutable Scene image generation revision with its own provider prompt UUID, workflow step, job, concrete seed, settings snapshot, and fingerprint. `RANDOM` resolves through Node crypto before scheduling. `FIXED` uses the configured seed.

Technical retry reuses the same generation, seed, fingerprint, and provider prompt UUID. It first checks ComfyUI history and queue state to avoid duplicate submission. Creative regeneration creates a new revision:

- Same seed keeps the previous concrete seed.
- New seed resolves and persists a new concrete seed.

## Freshness, review, and current selection

Generated freshness is derived from the current Visual Prompt Package and current image settings fingerprints. A result that finishes after either input changes is retained as historical output but is not selected current. Manual images are validated independently and are not stale because provider settings changed.

Review state is `UNREVIEWED`, `ACCEPTED`, or `REJECTED`. Review never changes current selection. Set Current changes the Scene image and Asset role pointers transactionally without changing Scene or chapter revisions.

## Batch behavior

The API supports an explicit bounded Scene selection and one Chapter's missing or stale eligible Scenes. It skips duplicate successful or pending work. There is no action that silently schedules every Scene in a project.

## Deliberate limits

`text-to-image-v1` records reference Asset identifiers but does not condition on them. The result reports `REFERENCE_IMAGES_UNUSED`. Character identity and faces can drift. No image-to-video, video provider, generic workflow JSON, best-image selection, or automatic render handoff is implemented.
