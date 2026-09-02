## MODIFIED Requirements

### Requirement: Reference slots
Visual profiles SHALL expose optional reference-asset slots for character, location, and object references. Slots MAY be empty. References SHALL reuse the existing managed asset rules without a second storage system. Character reference slots SHALL accept only project-owned, validated, `APPROVED` `CHARACTER_REFERENCE_IMAGE` assets; attaching, reordering, or removing character references SHALL create a new profile revision through the existing revision contract. The first character reference entry SHALL be the primary reference used by reference conditioning; remaining entries are additional references that this milestone's conditioning does not consume.

#### Scenario: Profile without references
- **WHEN** a profile has no reference image
- **THEN** it SHALL remain valid and usable for deterministic prompt construction

#### Scenario: Manual reference asset
- **WHEN** a user attaches a valid managed reference image to a profile
- **THEN** the profile package/API SHALL expose the asset reference without copying it into a second storage system

#### Scenario: Unapproved reference cannot attach
- **WHEN** a user attempts to attach a `CANDIDATE` or `REJECTED` character reference to a character profile
- **THEN** the update SHALL fail with a bounded validation error and the profile revision SHALL remain unchanged
