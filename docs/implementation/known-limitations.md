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

These limits are deliberate boundaries for the first working video and the
bounded long-story authoring workflow. They do not enable character-memory
retrieval, scene graphs, image generation, AI video, publishing, or generic
workflow/plugin systems.
