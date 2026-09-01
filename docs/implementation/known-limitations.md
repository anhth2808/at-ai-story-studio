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

- Scene Engine plans text into structured scene metadata and image prompts only.
  It does not generate pixels, call image/video providers, upload background
  media, or hand prompts to rendering automatically.
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

These limits are deliberate boundaries for the first working video and the
bounded long-story authoring workflow. They do not enable character-memory
retrieval, scene graphs, image generation, AI video, publishing, or generic
workflow/plugin systems.
