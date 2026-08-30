# Known limitations

- Edge TTS is the only implemented provider. It requires network access and may be rate-limited or unavailable offline.
- The default implementation renders the first chapter only. Multi-chapter timeline assembly is not implemented yet.
- Subtitle burn-in is implemented through FFmpeg when a current SRT asset exists, but subtitle edit and replacement endpoints are not implemented.
- Music upload and metadata are supported, and render mixing is implemented when `musicEnabled` is true; UI configuration for music volume and enablement is not exposed yet.
- Background uploads are classified by MIME type. Full media-type probing and corruption rejection at upload time need expansion beyond the render-time ffprobe validation.
- Asset streaming does not yet implement HTTP byte ranges or a download disposition.
- The API currently loads a complete project/chapter DTO into simple views; pagination is not needed for the V1 local milestone.
- IDs currently use cryptographically random UUIDs rather than UUIDv7.
- The render manifest is represented by persisted fingerprints and asset lineage; a standalone immutable manifest file is not yet emitted.
- Automated coverage includes workflow claimability, failed-segment-only retry, stale-input protection, chapter invalidation, and worker restart recovery. Full process cancellation, subtitle replacement, standalone render manifests, and multi-worker race fixtures remain future hardening work.

These limitations are deliberate V1 scope or known gaps against the design notes. The next milestone should harden the current first-working-video loop before adding advanced AI stages.

## Story Engine verification gate

`READY_FOR_LONG_STORY = YES`.

The real OMP three-chapter smoke passed with `openai-codex/gpt-5.6-luna`: blueprint, chapter plans, and chapters 1/2/3 completed; the worker restarted between chapters 1 and 2; and an explicit TTS handoff for generated chapter 1 completed all narration segments and merge. Story generation did not create automatic media jobs. The smoke used the supported Bun OMP host with authentication readiness and recorded only bounded job diagnostics.
