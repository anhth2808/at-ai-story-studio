# Production Profiles

Profiles are project-owned revision chains. Updating a profile retires the
current row and inserts a new revision. Active runs retain the profile ID and
revision they started with, so later edits do not silently change a run.

## Presets

| Key             | Intent                           | Default gates and policy                                                                                                                            |
| --------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MANUAL_REVIEW` | Human-controlled production      | automatic critics and human approval gates remain explicit; story, continuity, references, and providers stay required                              |
| `BALANCED`      | Default first-working-video path | automatic critics remain required; clear passes proceed, while uncertainty/exhaustion escalates; bounded batches and Ken Burns fallback are enabled |
| `AUTO`          | Fewer review stops               | automatic critics and strict resource/reference gates remain required; clear passes proceed without a human quality gate                            |

The repository lazily creates each requested preset and uses an idempotent
project/profile key. Repeated reads do not create duplicate revisions.

## Bounded settings

Settings validate and cap:

- chapter and image batch sizes
- candidate and image regeneration counts
- AI motion policy, priority threshold, and maximum AI scenes
- review requirements and Ken Burns fallback
- render quality, subtitles, music, and music volume
- technical retry enablement and maximum stage attempts
- minimum free disk bytes, generated image count, estimated GPU seconds, and
  estimated cost
- publication metadata and thumbnail requirements

The default `BALANCED` profile uses chapter batch size 5, image batch size 8,
two bounded image candidates, two image regeneration attempts, high-priority AI
motion, maximum 12 AI motion scenes, Ken Burns fallback, standard render quality,
current subtitles, automatic technical retry, three stage attempts, a 2 GB
free-space guard, required metadata, and an optional thumbnail.

## Estimates versus actuals

Preflight and plan values are estimates. Duration and cost remain `null` or
`UNKNOWN` when historical data is unavailable. The system does not render an
unknown cost as zero or claim an exact GPU duration. Actual counters are
recorded from settled workflow work and are kept separate from estimates.

## Optimistic updates

Profile writes require `expectedRowVersion`. A stale write returns a safe
`PROFILE_VERSION_CONFLICT` error. A run keeps its original profile revision;
changing the current profile affects later runs and their fingerprints.

## Resource behavior

The orchestrator applies both profile batch limits and a global active-unit
cap. Technical retry is bounded and never retries configuration, resource, or
review gates as a hot loop. GPU-heavy providers remain behind their existing
worker/provider boundary and can be disabled or deferred without changing the
run contract.

## Quality modes

Candidate count is bounded by profile policy and Shot importance. All profiles
run automatic quality checks; `MANUAL_REVIEW` pauses for human approval,
`BALANCED` escalates uncertainty, and `AUTO` does not disable critics.
Unavailable or malformed critic output never becomes a quality pass.
