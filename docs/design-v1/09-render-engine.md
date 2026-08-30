# Visual and Render Engine

## V1 visual sources

The required renderer accepts:

1. uploaded background video, looped/trimmed to narration duration;
2. uploaded still image, scaled/padded/cropped, optionally with a deterministic slow pan/zoom;
3. image slideshow with ordered assets and configured/even durations;
4. one generated image asset if supplied by a future/optional provider.

AI video generation is not required. Visual choices become a `VisualPlan` and timeline clips; future scenes can produce the same clip assets.

## Timeline model

```text
Timeline
- canvas: width, height, aspect ratio, fps, pixel format
- duration/timebase
- VideoTrack[TimelineClip]
- NarrationTrack[AudioClip]
- MusicTrack[AudioClip]
- SubtitleTrack[SubtitleDocument + style]
- output profile and metadata
```

Each clip references immutable asset ID/hash plus source in/out, timeline start/duration, fit/loop/transition, gain, and fades. Time uses rational or integer media ticks internally, not floating-point accumulation.

### Timeline construction

- Concatenate current chapter audio in chapter order with configurable inter-chapter gaps.
- Offset chapter subtitle cues by measured audio/gap durations.
- Fill full duration using background loop, still, or slideshow; reject uncovered video time.
- Loop/trim optional music, apply entry/exit fades, and keep it below narration.
- Resolve subtitle style/font asset.
- Write immutable canonical timeline manifest and hash before rendering.

## Render configuration

- resolution presets plus explicit width/height;
- aspect ratio: 16:9 default, future 9:16/1:1;
- FPS: 24/25/30/60 with 30 default;
- narration volume, music volume, optional simple ducking;
- subtitle style;
- output quality: CRF/preset profile;
- codec/container: H.264 + AAC in MP4 default;
- optional hardware encoding is explicitly selected, never silently substituted.

Suggested YouTube-compatible V1 default: 1920×1080, 16:9, 30 fps, yuv420p, libx264 CRF 20–23, AAC-LC 48 kHz stereo output. Narration mono is mapped/mixed safely. Exact defaults should be validated on target FFmpeg build during implementation.

## FFmpeg compilation

The render compiler converts only a validated timeline into argument arrays/filter scripts. It never accepts raw user shell text. Complex filter graphs are written to managed script files when command length/escaping is risky. The manifest records:

- timeline/compiler version and hash;
- FFmpeg/ffprobe version;
- ordered input asset IDs/hashes/probe metadata;
- normalized argument list and filter graph hash;
- output profile, expected duration, worker platform.

Default software encoding and stripped/controlled metadata make retries operationally reproducible. Provider-generated inputs and different FFmpeg builds may prevent byte-identical MP4s; the invariant is identical timeline/arguments for identical recorded inputs/environment.

## Execution, progress, cancellation

- Render to `staging/{attemptId}/output.partial.mp4`.
- Use FFmpeg `-progress pipe:1` and parse key/value output; progress is rendered media time / expected duration, clamped below 100% until validation.
- Capture bounded stderr to a diagnostic asset.
- Cancellation sends graceful termination then kills the process tree after timeout; delete/quarantine partial output.
- On success, ffprobe checks container, streams/codecs, dimensions, duration tolerance, frame/audio presence, and decodability sample where practical.
- Only then atomically promote and register the MP4.

A retry reuses the same timeline manifest. If an input/config changed, dependency invalidation creates a new manifest/render step.

## Music and audio mix

V1 supports narration gain and music gain with fades. Optional sidechain compression/ducking may be a profile, but avoid a full DAW mixer. Prevent clipping with a deliberate mix/limiter policy and record loudness measurements when implemented. User must own/license background music.

## Future visual path

```text
Chapter → ScenePlan → Scene
Scene → ImagePrompt → ImageAsset
ImageAsset → MotionPlan or ImageToVideo → VideoAsset
VideoAsset → TimelineClip → same Render Engine
```

Scenes and shots add producers; they do not change the timeline consumer. Character/reference assets are provider inputs with lineage.

## Decision: neutral timeline compiled to FFmpeg

- **Alternatives:** ad-hoc FFmpeg strings per workflow; MoviePy composition; browser/Remotion renderer.
- **Why:** a typed timeline separates creative planning from deterministic local composition and supports hours-long output efficiently.
- **Trade-offs:** filter-graph compilation and timebase handling require care; FFmpeg errors can be opaque.
- **Future impact:** image animation and AI video become track inputs; alternative render backends can consume the timeline if justified.
