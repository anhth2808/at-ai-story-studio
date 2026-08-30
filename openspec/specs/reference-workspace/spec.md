# reference-workspace Specification

## Purpose
Provide a documented local workspace that makes upstream AI video-generation projects available for research without treating their source trees as application-owned code.

## Requirements

### Requirement: Reference repositories are available under stable names
The workspace MUST contain a clone of each requested upstream repository under `references/<expected-name>/`, with its upstream Git metadata preserved when the source repository supports it.

#### Scenario: All requested projects are cloned
- **WHEN** workspace preparation completes
- **THEN** `references/` contains `MoneyPrinterTurbo`, `pyvideotrans`, `NarratoAI`, `MoneyPrinter`, `ShortGPT`, `whisperX`, `edge-tts`, `F5-TTS`, `GPT-SoVITS`, and `story-claw`
- **AND** each directory identifies the corresponding upstream Git repository

### Requirement: Reference source is isolated from the parent repository
The parent repository MUST ignore `/references` so files inside upstream clones are not included in normal parent-repository commits. Reference source MUST NOT be modified as part of workspace preparation.

#### Scenario: Parent repository status excludes reference trees
- **WHEN** the parent repository scans untracked files after cloning
- **THEN** files below `/references` are ignored
- **AND** only workspace metadata and documentation remain eligible for tracking

### Requirement: Project purposes are documented
`references/README.md` MUST list every reference project with its GitHub URL and a concise primary-purpose description.

#### Scenario: Researcher selects a reference project
- **WHEN** a researcher reads `references/README.md`
- **THEN** they can map each requested directory to its upstream URL and primary workflow area

### Requirement: Workspace intent is documented
The root `README.md` MUST explain that the repository is a reference workspace for studying open-source AI video-generation workflows and designing a future AI Video Studio, and MUST state that application implementation is not included in this preparation step.

#### Scenario: New contributor opens the repository
- **WHEN** they read the root README
- **THEN** they understand the workspace purpose, reference-only status, and intended next step of architecture/workflow analysis
