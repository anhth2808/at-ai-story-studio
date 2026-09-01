# Image provider boundary

`ImageProvider` is intentionally narrow:

- `readiness(settings, signal)` reports bounded provider readiness.
- `generate(request, signal)` returns normalized metadata and attempt-staging paths.
- `cancel(providerJobId, settings, signal)` targets one known provider job when safe.

The workflow service owns durable jobs, retries, fingerprints, validation, storage, Assets, and current selection. The provider owns only ComfyUI HTTP mapping and lifecycle behavior. Routes and UI never receive or submit provider workflow graphs.

## Package-only context

An image request is compiled from one exact current Visual Prompt Package plus project settings, a concrete seed, and optional bounded generation instructions. The provider must not query chapters, StoryState, profiles, or the full novel. Reference Asset identifiers remain in the request contract for future compatibility, but the current template reports them unused.

## Failure classes

Failures use bounded codes for provider availability, invalid workflow, missing model, submission, execution, output, download, timeout, cancellation, stale input, unknown outcome, and configuration. Retryable transport or timeout failures stay on the same logical generation. Creative changes use regeneration instead.

Requests use connection and generation timeouts plus AbortSignal. Errors must not expose prompts, graphs, credentials, stack traces, or unbounded provider payloads.

## Why there is no provider marketplace

V1 has one controlled ComfyUI implementation. A registry, plugin loader, arbitrary workflow importer, or provider marketplace would add configuration and security surface without serving the first working image path. Add another implementation only when a real second provider requires the same stable boundary.
