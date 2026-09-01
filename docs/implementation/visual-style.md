# Visual style

Visual style is a project-level revision chain consumed by Scene Engine planning and image-prompt refresh. It is descriptive planning data, not an image-provider configuration.

## Fields

- `styleName`: short human-readable label.
- `styleDescription`: editorial description of the visual direction.
- `medium`: medium or rendering family, such as cinematic illustration.
- `realism`: intended realism level.
- `colorPalette`: preferred palette and contrast.
- `cinematicStyle`: lens, film, or visual language guidance.
- `aspectRatio`: bounded `width:height` text, default `16:9`.
- `promptSuffix`: trusted suffix applied to generated prompts.

Each save creates a new immutable revision and uses optimistic `expectedRevision` checking. The current style revision is recorded on scene plans and scene revisions. Changing style marks current scene prompts stale, but does not invalidate scene structure, source ranges, chapter text, audio, subtitles, or renders.

The API requires all style fields at the boundary and returns a safe revision conflict when another client has saved first. Prompt refresh is explicit; no automatic image generation follows a style change.
