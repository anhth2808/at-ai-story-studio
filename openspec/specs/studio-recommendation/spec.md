# studio-recommendation Specification

## Purpose
Turn reference-project evidence into a local-first roadmap for an AI Video Studio, including explicit reuse boundaries, missing capabilities, and progressively more sophisticated workflows.

## Requirements

### Requirement: Evidence-based reuse decisions
The final recommendation SHALL classify relevant code and concepts from each repository as reuse, wrap, reimplement, or ignore, considering license constraints and coupling.

#### Scenario: Evaluating a reuse recommendation
- **WHEN** a reader reviews a repository recommendation
- **THEN** the recommendation states its evidence, dependencies, license implications, and preferred integration strategy

### Requirement: Real workflow levels
The workflow documentation SHALL describe simple video, YouTube short, story video, dubbing, and advanced story video paths while distinguishing existing reference capabilities from missing future capabilities.

#### Scenario: Reviewing an advanced workflow
- **WHEN** a step is not implemented by any inspected repository
- **THEN** it is explicitly labeled as a gap rather than presented as an existing feature

### Requirement: Local-first target architecture
The overview SHALL propose a high-level architecture optimized for local or inexpensive execution on consumer hardware, with cloud providers optional for expensive tasks.

#### Scenario: Choosing an implementation path
- **WHEN** a reader starts with a basic automatic video generator
- **THEN** the documentation identifies the simplest progression toward long-story and novel video workflows and the components that must be built
