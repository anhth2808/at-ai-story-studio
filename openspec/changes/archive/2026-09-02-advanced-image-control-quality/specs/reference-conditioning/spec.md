## MODIFIED Requirements

### Requirement: Comparison and regeneration
The system SHALL let a user generate and view, for one Scene, bounded candidate sets containing `TEXT_ONLY` or `REFERENCE_CONDITIONED` images and compare selected candidates side by side with generation metadata, including mode, workflow, seed, references used, structured review, and candidate-set provenance. Regeneration SHALL support same-seed and new-seed conditioned generation, technical retry of a conditioned candidate SHALL reuse the same generation, fingerprint, seed, candidate membership, and reference mapping, and feedback regeneration SHALL resolve and persist a fresh explicit character-to-reference mapping from the current Visual Prompt Package without mutating Character Visual Profiles.

#### Scenario: Compare baseline and conditioned
- **WHEN** a Scene has one completed TEXT_ONLY candidate and one completed REFERENCE_CONDITIONED candidate
- **THEN** the UI SHALL present both images side by side with their persisted mode, workflow, seed, reference provenance, scores, issues, and notes without loading image binaries into metadata APIs

#### Scenario: Regenerate conditioned candidate with feedback
- **WHEN** a user regenerates a rejected reference-conditioned candidate with structured feedback
- **THEN** the new request SHALL retain explicit `CharacterId -> ReferenceAsset` bindings with current asset hashes and profile revisions while applying feedback only to the Scene generation guidance

### Requirement: Real conditioned benchmark verification
This capability SHALL NOT be considered complete until, against a real configured ComfyUI server: one recurring character with one approved reference has been generated across at least five Scenes with scene-varied composition; each Scene has controlled text-only and reference-conditioned evidence; results have been manually reviewed and scored for face identity, hair, clothing, style, prompt adherence, composition, pose/action, location, and overall quality; later candidate-selection or feedback-regeneration benchmarks have checked identity for regression against the Prompt #10 baseline; multi-character behavior has been tested or honestly documented as limited; and LoRA and ControlNet decisions have been recorded from observed evidence.

#### Scenario: Complete the benchmark
- **WHEN** the image quality milestone verification is performed
- **THEN** evidence SHALL list the real generation records and Assets for compared modes and candidates across at least five Scenes, manual identity and composition scores, observed improvements and failures, the multi-character verdict, identity before and after, and the recorded `CONTROLNET_REQUIRED_NOW` and `LORA_REQUIRED_NOW` decisions

#### Scenario: Identity regresses during composition mitigation
- **WHEN** a candidate or feedback technique improves composition or pose but materially lowers recurring-character identity against the reference-conditioned baseline
- **THEN** the technique SHALL NOT become a default and the benchmark SHALL document the regression
