# Known limitations

- Edge TTS is the only implemented narration provider. It requires network
  access and may be rate-limited or unavailable offline.
- The media renderer still assembles the first working video path around the
  selected chapter. Multi-chapter media timeline assembly is not part of this
  change.
- Subtitle burn-in is implemented through FFmpeg when a current SRT asset
  exists. Subtitle replacement is available, but styled or word-aligned
  subtitles remain out of scope.
- Music upload and metadata are supported, and render mixing is implemented
  when `musicEnabled` is true. The UI does not yet expose every music mix
  parameter.
- Background uploads are classified by MIME type. Full media probing and
  corruption rejection still rely on render-time ffprobe validation.
- Asset streaming does not yet implement HTTP byte ranges or a download
  disposition.
- IDs use cryptographically random UUIDs rather than UUIDv7.
- The render manifest is represented by persisted fingerprints and asset
  lineage. A standalone immutable manifest file is not emitted.

## Long-story engine limits

- The supported story target is 1-200 chapters. Stories over 20 chapters
  require generated arcs and bounded plan windows; a full-project chapter plan
  is rejected to keep reads and prompts bounded.
- Plan windows contain at most 25 chapters. The API returns window summaries by
  default; fetch a specific window before editing its chapter items.
- Story output must match the strict JSON contract. Invalid provider output is
  rejected, persisted as a failed generation attempt, and retried according
  to the configured retry limit. Provider model quality still affects whether
  retries eventually produce valid output.
- OMP model authentication and quota state are external prerequisites. The
  readiness probe confirms authentication and model discovery, not quota
  availability for every model.
- Context selection is deterministic and bounded. Required structured sections
  are compacted as valid JSON when necessary; optional facts, events, and
  recent summaries may be omitted and are listed in diagnostics. There is no
  vector database or RAG retrieval layer.
- Changing an older generated chapter preserves later content and media but
  marks the generated suffix stale and pauses affected batches. The user must
  keep the suffix stale, rebuild from a checkpoint, or regenerate it in order.
- Manual chapter edits clear generated lineage and require explicit analysis
  before their state delta can be accepted.
- Story generation does not automatically schedule TTS, subtitles, or render
  jobs. Media handoff remains explicit after review.
- Usage records preserve provider-reported token and cost values when
  available. Unknown values remain unknown rather than being estimated.

## Scene Engine limits

- Scene Engine plans text into structured scene metadata and image prompts. It
  does not call image/video providers itself or hand media to rendering
  automatically; explicit Image Generation consumes the resulting package.
- Chapter source ranges use JavaScript UTF-16 offsets and are validated against
  the exact persisted chapter revision. Overlapping, reversed, out-of-bounds,
  or empty ranges are rejected.
- The exact chapter text is required and bounded. Large chapters or selected
  regeneration context fail with a visible context error rather than being
  silently truncated. Optional Story sections may be omitted and are shown in
  generation diagnostics.
- Provider scene boundaries, character resolution, locations, and prompts still
  need human review. Unknown or ambiguous references remain unresolved instead
  of being guessed.
- A visual-style, location, or future character dependency change marks
  dependent prompts stale; it does not automatically refresh prompts or
  generate images.
- Real OMP scene quality depends on model adherence to the strict nested JSON
  contract. The implementation has deterministic fake-agent coverage; a real
  scene smoke requires configured OMP authentication and an existing generated
  chapter.

## Visual Consistency limits

- The Visual Consistency Layer produces structured profiles and deterministic
  prompt packages. It does not call providers itself; explicit Image Generation
  consumes one current package without changing its canonical profiles.
- Generated profile candidates require explicit review and approval. Provider
  output quality, identity stability, and visual continuity still require
  human inspection.
- Profile and package payloads are intentionally bounded. Context compilation
  uses Story definitions, compact StoryState, selected locations, relevant
  Scenes, and the Style Bible; it does not load full novel prose.
- Object normalization is conservative. Ambiguous names remain unresolved
  until a reviewer selects an approved profile explicitly.
- Reference image slots accept only existing project-owned `READY` assets with
  the matching reference role. The Visual Bible does not add a duplicate
  upload path.
- Optional prompt refinement is fingerprint-checked and schema-validated, but
  an OMP model can still return unusable creative text. Canonical package text
  remains the deterministic source of truth.
- Visual consistency still requires manual inspection of generated pixels;
  package validation cannot guarantee identity or composition quality.

## Image Generation limits

- ComfyUI is the only implemented image provider. Studio requires a separately
  installed compatible server and configured Flux 2 model components.
- `text-to-image-v1` is a controlled native workflow. Arbitrary workflow JSON,
  custom nodes, model downloads, provider marketplaces, and automatic fallback
  models are not supported.
- Reference Asset identifiers are preserved in requests but the current
  workflow does not condition on them. It reports `REFERENCE_IMAGES_UNUSED`.
  Face and identity drift are expected and must be reviewed manually.
- Effective provider concurrency is one because the current durable worker
  claims one step at a time. No extra semaphore or second queue exists.
- A server without targeted running-job cancellation can only stop Studio's
  local wait. Studio never issues an uncertain global ComfyUI interrupt.
- Generated and manual image history is retained. There is no destructive
  revision deletion or long-term orphan-retention policy yet.
- Image generation does not select a best output automatically and does not
  hand images to FFmpeg, background media, image-to-video, or AI video.

## Verification record

The supported Bun OMP host passed:

`bun apps/omp-agent/src/index.ts --readiness`

The real provider smoke completed blueprint generation, chapter planning, and
three legacy structured chapter generations with
`opencode-go/gpt-5.6-luna`. The transactional V2 smoke reached the provider
but the provider returned enum and nested-array values outside the strict
contract; the failed attempt was rejected without persistence. Deterministic
V2 fixtures cover successful commits, retries, historical regeneration,
rollback boundaries, and stale-suffix handling.

The earlier Scene Engine smoke used `zai/glm-4.5` and reached the provider
through the durable worker, but all configured attempts returned
`429 Weekly/Monthly Limit Exhausted`. That historical run persisted no scene
plan.

The current real OMP verification used the default
`openai-codex/gpt-5.6-luna` model. The readiness command returned
`{"ready":true,"runtime":"bun 1.4.0","model":"openai-codex/gpt-5.6-luna"}`.
On generated chapter `a4a2b969-5ed2-425d-b4a2-1c2e75316e31`
(`origin=GENERATED`, revision 1, 1,319 UTF-16 code units), scene-planning
job `9442d454-5fef-4346-b106-f193f6efa40b` completed in 227,575 ms and
persisted three current scenes. Plan metadata recorded provider
`openai-codex`, model `gpt-5.6-luna`, prompt/schema `scene-planning-v4`,
4,656 input tokens, 12,539 output tokens, and known cost `$0.015978`.
Source excerpts matched all three persisted UTF-16 ranges.

Independent regeneration job `ee41a7b5-a59c-4952-ba4a-0954811a50fa`
completed scene 2 as revision 2 under the same stable scene ID. Scenes 1
and 3 remained revision 1 with one historical row each. The successful
regeneration usage record contained 8,143 input tokens, 1,397 output tokens,
and known cost `$0.003305`; unavailable usage remains nullable.

Manual review found coherent departure, bridge-rescue, and lighthouse beats;
all scene character IDs resolved to the generated blueprint. New location
names became draft candidates, and scenes 1 and 3 retain unresolved-location
warnings for review. The prompts are usable structured visual prompts, but
the operation is expensive for a short chapter and real visual consistency
cannot be judged from rendered pixels because pixel generation is outside
this change. Earlier real attempts also demonstrated strict-contract
failures for out-of-bounds source ranges and copied DTO metadata; those
results were rejected before persistence.

The Visual Consistency live smoke also passed OMP readiness, persisted valid
character and location candidates as `DRAFT`, and built a `CURRENT` package
after explicit approval. The package correctly returned `FAIL` with bounded
warnings for the intentionally missing Style Bible and unresolved recurring
object. Manual inspection found concise canonical profile payloads, visible
Scene action, and deterministic dependency fingerprints. Several earlier
attempts returned scalar values for array fields, so strict validation rejected
them without profile persistence; this remains a provider adherence weakness.

## Image Generation verification record

Live verification on 2026-09-01 used ComfyUI `0.33.1` at
`http://127.0.0.1:8188` with `text-to-image-v1`,
`flux-2-klein-base-4b-fp8.safetensors`, `qwen_3_4b.safetensors`, and
`full_encoder_small_decoder.safetensors`. UI readiness returned
`READY` with targeted cancellation supported.

- The Smoke project scene required a current package; the first build exposed
  and fixed an FK bug (`generation_id` referenced a workflow step id). A
  deterministic `BUILD_VISUAL_PROMPT` generation record is now created first.
- Real generation 1 (`job 6b7a69d6`, seed `1001779549`, 40.8s) published a
  1024x576 PNG (155,855 bytes, sha256 `dc69219...`) as the current Asset.
  New-seed regeneration (`job 30868d77`, seed `354441164`, 37.5s) added
  immutable revision 2; revision 1 stayed previewable. Set Current and review
  updates rotated pointers transactionally. API/worker restart preserved
  history, current selection, review state, and asset serving without
  resubmission. Manual PNG upload became revision 3/current.
- Model quality on the intentionally minimal fixture scene was degenerate:
  garbled pseudo-text (revision 1) and a near-blank frame (revision 2).
  After a manual scene edit to a content-bearing prompt and deterministic
  package rebuild, generation 4 (seed `27457721`, ~168s) produced a coherent
  lighthouse-on-foggy-cliff-at-dawn image matching the prompt, with drift:
  the model doubled the lighthouse and the path fades unnaturally. Character
  resemblance is not demonstrable because the fixture scene has no characters.
- Reference Assets remain request-only; `REFERENCE_IMAGES_UNUSED` is asserted
  in provider tests. No reference conditioning or video handoff exists.


These limits are deliberate boundaries for the first working video, bounded
long-story authoring, and first working image workflows. They do not enable
character-memory retrieval, scene graphs, reference-conditioned generation,
AI video, publishing, or generic workflow/plugin systems.
