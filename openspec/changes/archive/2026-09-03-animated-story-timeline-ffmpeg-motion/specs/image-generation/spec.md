## MODIFIED Requirements

### Requirement: Generation, freshness, review, and current are separate
A Scene image SHALL continue exposing generation status, freshness, review status, candidate membership, and explicit current selection independently. Hierarchical video rendering SHALL consume only the READY Asset selected as the Scene's accepted/current production image and only when its freshness/approval contract is satisfied. Completing a candidate or selecting a historical image SHALL not automatically create or replace a Scene Clip.

#### Scenario: Render an accepted image
- **WHEN** a Scene has a completed accepted/current image with a READY Asset
- **THEN** a Scene Clip request SHALL be allowed to use that exact Asset hash and SHALL record it in the Scene Clip fingerprint

#### Scenario: Reject a candidate
- **WHEN** a candidate is rejected or remains non-current
- **THEN** render preflight SHALL exclude it and SHALL report the Scene as missing a valid accepted/current render input
#### Scenario: Reject the current image
- **WHEN** a user marks a current image `REJECTED`
- **THEN** the review status SHALL change without deleting its asset or generation history and the system SHALL NOT choose a replacement automatically

#### Scenario: Select an older revision
- **WHEN** a user explicitly selects an older valid Scene image revision
- **THEN** that revision SHALL become current and all other revisions for that Scene role SHALL become non-current atomically

#### Scenario: Accept a candidate
- **WHEN** a user accepts a completed non-current candidate
- **THEN** its review status, generation current flag, and Asset current flag SHALL change atomically while every other Scene image remains historical

#### Scenario: Preserve accepted current during generation
- **WHEN** a new image completes while the Scene has an accepted current image
- **THEN** the new image SHALL remain non-current regardless of freshness and the accepted image SHALL remain current

### Requirement: Preserve image history during video invalidation
Changing a Scene image, reviewing a candidate, or accepting a replacement SHALL preserve all image generation revisions and Assets. Video invalidation SHALL affect only dependent Scene Clip/Chapter/Project outputs and SHALL never delete image history or trigger new image generation.

#### Scenario: Accept a replacement image
- **WHEN** a user accepts Candidate 3 for a Scene already used by a Project Video
- **THEN** the image layer SHALL update its current pointer, the old image Asset SHALL remain historical, and only dependent video outputs SHALL become stale

### Requirement: Reference and visual provenance remain intact
Scene Clip and higher-level render metadata SHALL retain the selected Scene image Asset hash and image-generation provenance needed to identify the exact accepted image, package/settings lineage, conditioning mode, and reference mappings. Rendering SHALL not mutate Visual Prompt Packages, canonical profiles, or reference mappings.

#### Scenario: Render a conditioned image
- **WHEN** the accepted image was produced through `REFERENCE_CONDITIONED`
- **THEN** video metadata SHALL identify the image revision and its persisted conditioning provenance without reconstructing or changing that mapping

### Requirement: Image workflow remains explicit and provider-neutral
Image generation SHALL remain an explicit action separate from timing, motion planning, and rendering. The image provider SHALL not be called as a side effect of a render request, and the video pipeline SHALL not require AI video or image-to-video support.

#### Scenario: Render with provider offline
- **WHEN** ComfyUI is unavailable but an accepted Scene image Asset already exists
- **THEN** timing, motion, Scene Clip, Chapter Video, and Project Video work SHALL not schedule a new image-generation job
