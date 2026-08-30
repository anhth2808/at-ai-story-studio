## MODIFIED Requirements

### Requirement: Provider-independent orchestration
The design SHALL define a thin application AI contract for LLM and agent features, SHALL use an OMP SDK adapter as the primary execution implementation, and SHALL prevent domain and application services from depending directly on OMP SDK types. The design SHALL keep TTS, ASR, image, video, translation, FFmpeg/ffprobe, ComfyUI, filesystem, database, job, workflow, retry, dependency, invalidation, asset, and project-persistence responsibilities outside OMP. Structured AI results SHALL be validated at the integration boundary before entering application or domain state, and provider-specific model, authentication, request, and response behavior SHALL remain outside workflow definitions.

#### Scenario: The user changes the configured LLM model or provider
- **WHEN** a compatible model or provider is selected through OMP configuration for future intelligent work
- **THEN** story and workflow services continue to call the same thin application AI contract
- **AND** OMP owns provider and model execution details behind the adapter
- **AND** only outputs whose input fingerprint includes the previous AI execution configuration become stale or require regeneration

#### Scenario: The user changes TTS provider
- **WHEN** a compatible provider configuration is selected for future TTS work
- **THEN** workflow definitions remain unchanged
- **AND** the specialized TTS provider adapter executes outside OMP
- **AND** only outputs whose input fingerprint includes the previous provider configuration become stale or require regeneration

#### Scenario: Structured AI output enters application state
- **WHEN** the OMP adapter returns an AI result intended to update story or planning state
- **THEN** the integration boundary validates the result against the feature's Zod schema
- **AND** invalid or truncated output is translated into an application failure rather than persisted as valid domain state

#### Scenario: An AI operation is cancelled or exceeds its deadline
- **WHEN** the durable worker cancels an active AI attempt or its configured deadline expires
- **THEN** the thin AI boundary aborts and disposes the OMP session as applicable
- **AND** the worker records the normalized outcome without transferring workflow or retry ownership to OMP
