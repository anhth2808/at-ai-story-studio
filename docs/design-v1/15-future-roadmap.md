# Future Roadmap

## Stable V1 foundations

The following are deliberately future-bearing:

- immutable assets with lineage and source fingerprints;
- stable identity + revision for story entities;
- durable step graph with arbitrary typed scopes (`Project`, `Chapter`, future `Scene`, `Shot`);
- provider capability descriptors;
- structured subtitle cues and neutral timeline;
- bounded `GenerationContext` item contract;
- Python/local model isolation behind adapters.

The future path adds producers and richer context. It does not replace project/workflow/asset/render foundations.

## V1 — Audio Story

```text
Story → Chapter text → TTS segments → Chapter audio
→ Segment subtitles + background visual/music → Timeline → MP4
```

Required entities: project, blueprint, characters, events, chapter plans/chapters, segment manifests, assets, workflow, timeline. Visual plan is project-level/simple. Human review is the quality gate.

## V2 — AI Image Story

```text
Chapter → ScenePlan → Scenes
Scene → ImagePrompt + character/location references → ImageAsset
Images → slideshow/pan/zoom timeline
Narration + subtitles → MP4
```

Add `Scene`, `SceneRevision`, `SceneCharacter`, `ImagePrompt`, `VisualContinuityReference`, and image-provider implementation (local ComfyUI first where practical). Scene IDs become workflow scopes. The render engine already accepts image clips; no new final compositor is required.

Keep character consistency modest: selected reference assets and explicit visual descriptions. Do not promise a universal identity engine.

## V3 — Animated Story

```text
Scenes → shot/motion plans
Consistent images → pan/zoom/parallax or Image-to-Video
→ VideoClip assets → Timeline
```

Add `ShotPlan`, `MotionPlan`, continuation/reference lineage, `VideoProvider`, resource/cost policies, and duration reconciliation. Character/world facts expand into `CharacterBible`/`WorldBible` revisions. Context compiler gains additional item providers and retrieval ranking.

This is where GPU scheduling, remote provider job checkpoints, and media quality validation become more important. Still no need for microservices on one workstation.

## V4 — AI Video / Novel to Movie

```text
Novel ingestion
→ hierarchical global understanding
→ World Bible + Character Bible + Story Memory
→ Scene Graph → Shot Planning
→ reference-conditioned image/video assets
→ dialogue/narration/SFX/music timeline
→ movie
```

Add:

- hierarchical source chunks/summaries and extracted facts with evidence;
- unresolved promises/payoffs, timeline and relationship state;
- retrieval index/embeddings only after relational selection proves insufficient;
- scene graph and shot continuity;
- voice casting/dialogue tracks;
- asset approval/reference sets;
- multi-pass render and chapter/episode/movie assemblies.

`GenerationContextBuilder` becomes a context service backed by relational facts and optional vector retrieval, but its output remains a recorded bounded snapshot.

## V5 — Quality Evaluation and Automatic Regeneration

```text
Generation → objective validators + learned evaluators
→ issue classification → targeted regeneration
→ compare/select → approved final movie
```

Add `EvaluationRun`, `QualityMetric`, `Finding`, `RegenerationPolicy`, candidate assets, and approval decisions. Evaluators target observable criteria: missing beats, name/fact consistency, audio defects, subtitle timing, image identity, shot continuity, render integrity, and budget.

Automatic regeneration is bounded by maximum attempts/cost and never overwrites accepted/user-edited assets. Quality loops are workflow subgraphs with explicit stop conditions, not autonomous agents with open-ended budgets.

## Scaling triggers, not dates

| Trigger | Evolution |
|---|---|
| SQLite write contention under real workloads | PostgreSQL repository implementation |
| Workers must run on multiple machines | queue/outbox transport of step IDs + shared/object asset store |
| Web and GPU model lifecycles interfere | separate provider sidecar/service process on same machine |
| Retrieval misses continuity facts | extracted fact store, then embeddings/vector index |
| Render backend cannot express required animation | second timeline renderer, keeping timeline contract |
| Provider packs become numerous/third-party | signed/versioned plugin model after security and compatibility design |

Do not extract services merely because roadmap boxes look separate.

## Delivery gates by version

- **V1 gate:** restart-safe validated MP4 from generated/imported story with simple visuals.
- **V2 gate:** scene-level images regenerate independently and preserve approved references.
- **V3 gate:** motion/video clips align to planned durations and remain replaceable per shot.
- **V4 gate:** long novel facts/characters/world remain traceable across scene/shot generation.
- **V5 gate:** automated evaluation improves selected measurable quality without unbounded retries/cost or overwriting approvals.

## Decision: evolve the graph and domain, not deployment topology

- **Alternatives:** design all V5 entities/providers now; rewrite per version; microservice per future stage.
- **Why:** step scopes, assets, revisions, context items, and timeline already provide the required extension axes.
- **Trade-offs:** some schemas/interfaces will evolve with migrations; V1 avoids speculative abstractions.
- **Future impact:** each version is an additive vertical slice with explicit migration, not a new product core.
