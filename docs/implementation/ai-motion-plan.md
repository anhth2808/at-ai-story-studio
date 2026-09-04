# AI motion plan

`AiMotionPlan` is the per-Scene motion intent for image-to-video generation.
It is persisted separately from the image Visual Prompt Package and from the
deterministic Ken Burns `MotionPlan`.

## Shape

Revisioned per Scene revision (`ai_motion_plan_revisions`) with:

- `characterAction` - what the subject does ("the subject slowly turns toward
  the gate")
- `environmentMotion` - what moves around the subject ("fog drifting slowly")
- `cameraMotion` - bounded vocabulary: `STATIC`, `PUSH_IN`, `PULL_OUT`,
  `PAN_LEFT`, `PAN_RIGHT`, `ORBIT_SUBTLE`, `HANDHELD_SUBTLE`
- `intensity` - `SUBTLE` (default) / `MEDIUM` / `STRONG`
- `priority` - `NONE` / `LOW` / `MEDIUM` / `HIGH` (later budget allocation)
- `motionPrompt` - compiled prompt text, fingerprinted

## Motion prompt strategy

Video prompts describe **what moves**, never what the scene looks like: the
accepted Scene image already fixes identity. The compiled prompt is 2-3
sentences: subject action, environment motion, camera phrase, intensity
phrase, plus a stability clause ("keep faces, bodies, clothing, and objects
consistent with the input image; avoid sudden movements, morphing, or style
changes"). Conservative phrasing ("slowly", "gently", "barely perceptible")
is deliberate - long-form story scenes need restrained motion and consumer
GPUs reward it with stability.

## Determinism and OMP

`createDefaultAiMotionPlan()` (packages/workflow/src/ai-motion-plan.ts)
builds the plan deterministically from Scene purpose, camera movement intent,
weather, and composition - identical Scene inputs produce identical plans and
fingerprints. Reviewers edit intent fields through `PUT .../ai-motion`, which
creates a new revision. An OMP-structured refinement may be layered on top
later through the existing OMP agent boundary; the deterministic path is the
default and works offline.

## Safety defaults

Prompts never encourage violent camera moves, rapid pose changes, complex
hand interaction, or multi-character choreography. These destabilize short
diffusion clips and cause the identity drift that review exists to catch.
