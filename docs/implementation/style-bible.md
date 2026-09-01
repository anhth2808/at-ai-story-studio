# Style Bible

The Style Bible is a project-level, revisioned visual language. It is
provider-neutral and may be selected through a preset or edited manually.

## Fields

The persisted contract covers:

- medium and realism
- overall and cinematic style
- cinematic language
- palette
- lighting and texture
- environment and character rendering
- camera and composition
- mood keywords
- aspect ratio
- positive prompt suffix
- negative prompt
- optional project-owned style reference asset IDs

All strings and arrays are bounded. Reference IDs must be `READY`, belong to
the project, and use the `STYLE_REFERENCE_IMAGE` role. No provider model,
endpoint, sampler, seed, or image-generation setting is stored.

Presets are normal writes, not hidden configuration. Each preset creates a new
revision, preserves prior revisions, and uses optimistic revision checks for
manual updates. A Style Bible revision change marks only dependent Visual
Prompt Packages stale. It does not change Scene structure or media outputs.
