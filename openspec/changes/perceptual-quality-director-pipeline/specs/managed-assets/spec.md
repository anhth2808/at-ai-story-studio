## ADDED Requirements

### Requirement: Quality reference media are managed Assets
Character prototype references, Character appearance-stage references, canonical Location references, extracted continuation frames, critic sample frames, and generated Shot media SHALL use generated internal filenames, validated media types, managed workspace paths, SHA-256 hashes, project ownership, and immutable Asset records. Binary content SHALL remain outside SQLite.

#### Scenario: Store an extracted continuation frame
- **WHEN** the final frame of an accepted prior clip is extracted for continuation
- **THEN** it SHALL be validated and registered as a managed Asset with source clip ID/hash and Shot lineage before downstream generation uses it

### Requirement: Reference approval and currentness are explicit
Reference candidate Assets SHALL remain distinct from approved current reference identity. Approval, rejection, replacement, and staleness SHALL preserve historical Assets and update current pointers atomically under the owning profile/stage/Location revision. Rejected, stale, cross-project, or hash-mismatched Assets SHALL not be usable for conditioning.

#### Scenario: Reject a prototype candidate
- **WHEN** a reviewer rejects a generated Character prototype
- **THEN** the Asset SHALL remain historical, SHALL not become the profile's canonical reference, and SHALL not feed appearance-stage or Shot generation

### Requirement: Quality evidence remains bounded
Normal status and dashboard DTOs SHALL reference critic evidence by IDs, hashes, bounded scores, issue tags, and thumbnails or stream URLs. They SHALL not embed raw image/video bytes, complete model conversations, huge ComfyUI graphs, absolute paths, or unbounded sample lists.

#### Scenario: Read production status
- **WHEN** a run contains many Shot critic evaluations
- **THEN** status SHALL return bounded counts and samples while selective endpoints provide authorized evaluation details
