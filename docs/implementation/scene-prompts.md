# Scene prompts

Scene prompts are a separate, versioned output from scene structure. A scene plan describes what happens and where its source text lives; an image prompt describes how the reviewed scene may be visualized.

## Operations

- `SCENE_PLANNING` returns the complete ordered scene envelope, including source ranges and visual fields.
- `SCENE_REGENERATION` returns one complete replacement scene while preserving its scene number and source range.
- `SCENE_PROMPT` returns only `imagePrompt` and `negativePrompt` for an independent prompt refresh.

All responses pass strict Zod validation at the OMP boundary. Prompt and schema versions, input fingerprints, source chapter revision, visual-style revision, provider/model, and nullable usage are persisted with the accepted revision.

## Staleness

Prompt status is independent from scene status:

- `CURRENT`: prompt matches the current known style/location/character dependencies.
- `STALE`: a dependency or relevant visual field changed; the user should review or refresh it.
- `MISSING`: the scene has no usable prompt.

Changing chapter text or Story settings marks the scene plan and current scene structure stale and prompts stale. Changing visual style, a referenced location, or a future canonical character dependency marks only dependent prompts stale. No automatic prompt refresh or image generation occurs.

## Provider boundary

Scene Engine owns context selection, visual vocabulary, strict output validation, and durable provenance. The isolated OMP agent owns the OMP call. Image/video providers are not part of this change, and prompts are not automatically handed to media rendering.
