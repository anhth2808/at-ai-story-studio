# reference-first-visuals Specification

## Purpose
Define managed, approved, revision-aware Character and Location reference assets that separate stable identity from appearance stages and transient Shot state and provide exact conditioning prerequisites for quality production.

## Requirements

### Requirement: Character identity, appearance stage, and Shot state are distinct
The system SHALL model stable Character identity separately from appearance stages and transient Shot state. Identity SHALL contain stable face, body, hair, and physical characteristics. An appearance stage SHALL contain clothing, accessories, and carried or worn equipment intended to persist. Shot state SHALL contain expression, pose, current action, current visible injuries, screen or world position, held objects, and visibility. Emotion, action, pose, location, camera, lighting, and time of day alone SHALL NOT create an appearance stage.

#### Scenario: Emotion does not create a stage
- **WHEN** a Character becomes angry, sits down, moves outdoors, or enters night lighting without changing clothing or equipment
- **THEN** the current appearance stage SHALL remain unchanged and those facts SHALL be recorded only in Shot state

### Requirement: Conservative context-aware wardrobe inference
Narrative context MAY infer an appearance stage only when it supports an actual clothing, accessory, or equipment change, such as sleepwear, winter outerwear, confirmed formal ceremony clothing, patient clothing, bathing, or changing. An inferred stage SHALL retain source Scene and chapter identity, bounded source evidence, confidence, and reason and SHALL remain reviewable. Weak contextual cues SHALL NOT create a stage.

#### Scenario: Infer sleepwear from confirmed context
- **WHEN** bounded source context confirms that a Character changed for overnight sleep
- **THEN** the system MAY propose a sleepwear stage with evidence and confidence rather than treating sleep location or emotion alone as a wardrobe change

#### Scenario: Reject unsupported wardrobe inference
- **WHEN** a Character enters a cold-looking room but the narrative does not imply changed clothing
- **THEN** the system SHALL retain the existing appearance stage and SHALL not hallucinate winter clothing

### Requirement: Canonical Character prototype reference
A Character Visual Profile SHALL support one approved canonical prototype reference Asset. Default production generation SHALL request a reusable multi-view sheet on a clean neutral background, photorealistic unless the project Style Bible requires another medium, with ordinary era-appropriate clothing, no unnecessary props or accessories, front/side/back full-body views, and a frontal facial close-up. The Asset SHALL retain profile revision, prompt and workflow version, provider/model settings, seed, dimensions, content hash, generation identity, approval, and current/stale state.

#### Scenario: Generate a prototype candidate
- **WHEN** a current Character Visual Profile has no approved prototype and prototype generation is requested
- **THEN** the system SHALL create a managed reviewable candidate with the multi-view identity contract and SHALL not attach or approve it silently

### Requirement: Appearance-stage references derive from the prototype
An appearance-stage reference SHALL use the exact approved current prototype as its identity-conditioning source and SHALL change only the required clothing, accessories, or equipment while preserving face, body, hair, and stable physical features. It SHALL persist prototype Asset ID/hash/profile revision lineage and SHALL be a managed reviewable Asset. Missing or stale prototype input SHALL block stage-reference generation.

#### Scenario: Generate an outfit stage
- **WHEN** an approved prototype exists and a reviewed formal-wear stage is requested
- **THEN** generation SHALL condition on that exact prototype and persist the prototype lineage with the stage candidate

### Requirement: Exact appearance-stage identity
A Shot requiring a named appearance stage SHALL bind only the approved current reference for that exact Character and stage identity. The system SHALL NOT silently select a prototype, another stage, a nearest stage, another Character, or a fuzzy name match. A missing exact reference SHALL be an explicit prerequisite result.

#### Scenario: Required stage is missing
- **WHEN** a quality Shot requires Character A's `winter-coat` stage but only Character A's prototype and `formal-wear` stage exist
- **THEN** reference resolution SHALL report the exact missing stage and SHALL not submit image generation under the wrong reference

### Requirement: Hard Location and transient Scene state are distinct
A canonical Location profile SHALL describe stable architecture, spatial layout, walls, windows, doors, fixed furniture, terrain, and permanent environment separately from Scene-time state such as time, weather, lighting, atmosphere, temporary objects, and temporary damage. Updating transient state SHALL NOT create a new canonical geometry identity.

#### Scenario: Reuse geometry across weather
- **WHEN** the same Location appears in daylight and later in rain at night
- **THEN** both Shots SHALL resolve one canonical hard Location while retaining different transient Scene state

### Requirement: Canonical Location reference Asset
An important recurring Location SHALL support an approved reusable reference image that contains no Characters, clearly establishes stable structure and layout, excludes unnecessary temporary narrative state, and remains suitable as later Shot conditioning input. The managed Asset SHALL retain Location revision, prompt/workflow/provider metadata, content hash, approval, and current/stale state.

#### Scenario: Generate a location candidate
- **WHEN** a recurring Location has approved hard-geometry data and reference generation is requested
- **THEN** the system SHALL create a character-free managed candidate grounded only in stable geometry and SHALL leave transient weather and story props out

### Requirement: Reference changes invalidate exact descendants
Changing a Character prototype SHALL stale dependent stage references, Shot bindings, image generations, video generations, and render descendants that consume it. Changing one appearance-stage or Location reference SHALL stale only Shot descendants bound to that exact reference. Historical Assets SHALL remain queryable, and unrelated Character, Location, Story, and TTS data SHALL remain current.

#### Scenario: Replace one Character stage reference
- **WHEN** one Character's approved `winter-coat` reference changes
- **THEN** only Shots bound to that Character and stage and their media descendants SHALL become stale
