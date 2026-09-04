# Production Interventions

An intervention is a durable, user-visible gate attached to a run and usually
to one stage. It prevents the orchestrator from guessing at missing input,
review decisions, or provider configuration.

## Types

- `STORY_APPROVAL_REQUIRED`
- `IMAGE_REVIEW_REQUIRED`
- `REFERENCE_REQUIRED`
- `CONTINUITY_STALE`
- `PROVIDER_CONFIGURATION_REQUIRED`
- `RENDER_ASSET_MISSING`
- `QUALITY_REVIEW_REQUIRED`

Each record includes a stable ID, run/stage identity, severity, affected entity
when known, bounded message, actions, dedupe key, resolution object, and
lifecycle timestamps.

## Lifecycle

- `OPEN` means the gate is active. Reconciliation with the same dedupe key
  returns the existing open record.
- `RESOLVED` means the user supplied a resolution object and the gate may be
  checked again.
- `DISMISSED` means the user intentionally dismissed a non-blocking gate.

A blocking open intervention cannot be dismissed. It must be resolved or the
run remains `WAITING_FOR_USER`. Resolution metadata is retained and is not
silently replaced by a later reconciliation.

## Orchestration behavior

When a stage reports `REVIEW` or `BLOCKED`, the orchestrator persists the stage
projection and intervention before changing the run to `WAITING_FOR_USER`.
No downstream work is scheduled. Resume rechecks the same stage and reuses any
valid manual work completed while the run was waiting.

Missing references never fall back to prompt-name order. Missing required
render inputs never become an implicit historical Asset. Optional AI motion may
use Ken Burns only when the active profile explicitly allows it; the fallback
is recorded in the stage summary and package validation.

## API behavior

Interventions are returned in run status and can be resolved or dismissed with
validated resolution data. Routes verify that the intervention belongs to the
project and run before mutation. Safe errors expose a code, message, and
retryability without stack traces, credentials, raw provider payloads, or
chapter prose.

The web Production surface displays severity, message, affected work, actions,
and the persisted run state. It does not use color alone and provides a
visible Resume path after a gate is resolved.
