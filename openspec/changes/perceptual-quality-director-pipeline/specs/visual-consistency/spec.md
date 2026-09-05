## MODIFIED Requirements

### Requirement: Deterministic Visual Prompt Package
For each current Shot, the system SHALL build and persist a Visual Prompt Package containing exact Shot and Scene revisions, current Style Bible revision, visible Characters and exact appearance stages, off-screen Character identities kept outside diffusion text, structured initial continuity state, resolved hard Location plus soft Scene state, important objects, camera, lighting, composition, mood, compiled image prompt, separate video prompt, negative prompt, ordered reference bindings, consistency result, input fingerprint, and prompt-template version. Scene-level package summaries MAY aggregate Shot packages but SHALL NOT replace their lineage.

#### Scenario: Build a Shot package
- **WHEN** a current Shot references approved Character stage and Location references
- **THEN** the package SHALL persist exact bindings and visual prompts without changing the Scene, Shot plan, StoryState, or canonical profiles

#### Scenario: Build a package from an existing scene
- **WHEN** a current Scene without a Shot plan references available profiles and Style Bible data
- **THEN** the existing Scene package path SHALL resolve those dependencies without changing Scene structure, chapter content, or media outputs

#### Scenario: Rebuild after a prompt edit
- **WHEN** a user requests package rebuild after changing a visual profile
- **THEN** the system SHALL reuse the current Scene and Shot structure and create a new package from current dependencies without regenerating narrative plans

#### Scenario: Missing canonical profile
- **WHEN** a Scene or Shot references a Character, Location, or object with no usable canonical profile
- **THEN** the package SHALL retain a visible warning or safe missing status and SHALL not fabricate canonical appearance

### Requirement: Predictable visual-only prompt assembly
Image prompt assembly SHALL use this stable priority: visible subject/action; exact visible Character identity/stage placeholders; visible pose/expression/position; important objects; Location/background placeholder; natural cinematic framing/angle/composition language; lighting/time/weather; style/look; quality constraints; negative constraints. It SHALL exclude raw serialized objects and nonvisual semantic facts such as goals, knowledge, abstract roles, and secrets unless converted into source-grounded visible consequences. Video prompts SHALL contain temporal changes and stability constraints without unnecessary static-world repetition.

#### Scenario: Exclude semantic Story state
- **WHEN** StoryState says a Character has a goal and knows a secret but the Shot provides no visible consequence
- **THEN** neither fact SHALL appear in the diffusion prompt

#### Scenario: Compile camera language
- **WHEN** a Shot has structured medium framing, eye-level angle, locked camera, and screen positions
- **THEN** the image prompt SHALL contain concise natural cinematic sentences and SHALL NOT contain serialized JSON

### Requirement: Structured continuity affects prompt output
A Shot package SHALL consume the prior dependent Shot's persisted final physical state when applicable and SHALL compile relevant screen side, facing, pose, held-object, and environment relation into the current initial prompt. Continuity data SHALL participate in the package fingerprint.

#### Scenario: Prior holder persists
- **WHEN** the previous Shot ends with a Character holding an identified prop and the narrative does not release it
- **THEN** the next package SHALL preserve that holder relationship in structured state and visible prompt text

## ADDED Requirements

### Requirement: Off-screen Characters stay out of visible prompts
Visual packages SHALL distinguish visible and off-screen Characters. Off-screen identities SHALL remain available to dialogue, gaze, and continuity logic but their names, identity descriptions, and reference placeholders SHALL not enter the image prompt. A visible Character looking toward an off-screen person SHALL compile to a neutral off-camera direction.

#### Scenario: Strip an off-screen listener
- **WHEN** a visible Character looks toward a named listener behind the camera
- **THEN** the image prompt SHALL describe looking toward someone off camera and SHALL omit the listener's name and reference binding

### Requirement: Safety rewriting preserves binding semantics
A prompt-safety rewrite SHALL preserve Shot purpose, visible subjects, composition, reference placeholders, exact ordinal mapping, and the ordered binding set and SHALL rewrite only the minimum unsafe phrase. The rewritten prompt SHALL be validated against the pre-rewrite placeholder set before use; removed, added, duplicated, or renumbered placeholders SHALL fail safely.

#### Scenario: Reject binding-changing rewrite
- **WHEN** a safety rewrite changes `person in image 2` to `person in image 1`
- **THEN** validation SHALL reject the rewrite and preserve the original binding metadata
