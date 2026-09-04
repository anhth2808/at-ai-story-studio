# Hybrid scene clips

HYBRID is the practical long-form mode: a short AI motion burst opens the
Scene, then the accepted Scene image continues with bounded Ken Burns motion.

## Duration policy: AI_THEN_KEN_BURNS

The only implemented policy (deliberately no `LOOP_AI` or `TIME_STRETCH` -
repeated diffusion motion looks unnatural and time-stretching silently changes
pace):

```text
raw AI clip (e.g. 3.4s) --plays--> [crossfade 500ms] -- Ken Burns continuation --> exact SceneTiming end
```

- Clip longer than (or equal to) the Scene: deterministic trim to the Scene
  duration. Narration timing is never altered.
- Clip shorter than the Scene: segment A = raw clip; segment B = Ken Burns
  continuation rendered from the accepted Scene image using the same bounded
  crop math as the deterministic renderer; joined with
  `xfade=transition=fade` (crossfade clamped to 1s and to half of the shorter
  overlap).
- The continuation anchors to the **accepted image**, not the AI final frame:
  the AI end frame can carry identity drift, and the original image is the
  canonical visual by definition.

## Compiler

`buildAiSceneClipArguments()` (packages/media/src/ai-clip-render.ts) compiles
pure FFmpeg argument arrays: single-input trim+normalize for long clips,
two-input `filter_complex` with `settb=AVTB`, per-branch fps/normalize, and
`xfade` for short clips. Output matches the SceneClip contract exactly:
project resolution, fps, H.264, `yuv420p`, MP4, no audio.

Because Chapter/Project fingerprints embed clip fingerprints, a HYBRID clip
rebuild invalidates only its Chapter and dependent Projects - everything else
in the hierarchy stays reusable.
