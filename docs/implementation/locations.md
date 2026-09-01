# Locations

Locations are a project-scoped registry for stable visual continuity. Scene Engine stores both a `locationId` and the generated scene's display-name snapshot so historical scenes remain readable when registry metadata changes.

## Normalization

Location lookup applies Unicode NFKC normalization, trims whitespace, lowercases with an English locale, removes a leading `the`, converts punctuation/separators to spaces, and collapses repeated spaces. For example, `The Old-Harbor`, `old harbor`, and `OLD  HARBOR` share one lookup key.

Normalization is used for lookup and duplicate prevention only. The original display name remains available for UI and prompt review.

## Resolution

- One normalized match is reused.
- No match creates one `DRAFT` candidate so the generated reference is not discarded.
- Multiple matches produce an unresolved location diagnostic; generation does not guess between records.
- Registry edits use `expectedRowVersion` and create a new metadata state. Current scenes that reference the location are marked prompt-stale; scene structure and chapter text remain unchanged.

Location descriptions include type, visual description, environment, architecture, important objects, and default lighting. A location becoming `ACTIVE` is a review decision. Scene Engine does not turn a location into an image or call a provider directly.
