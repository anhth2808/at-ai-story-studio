## Purpose

Provide source-grounded, comparable documentation of the ten reference repositories so architectural and reuse decisions are based on current implementation rather than README claims.

## ADDED Requirements

### Requirement: Per-project source analysis
The documentation SHALL analyze every named reference repository using actual source files and SHALL identify purpose, stack, architecture, entry points, workflow, important components, providers, reuse classification, strengths, weaknesses, and ideas worth copying.

#### Scenario: Reviewing a project document
- **WHEN** a reader opens any document under `docs/projects/`
- **THEN** technical implementation claims cite relevant source paths and, where practical, functions or classes

### Requirement: Cross-project comparison
The documentation SHALL compare implemented features, providers, workflows, reusable components, and architecture patterns consistently across all ten projects.

#### Scenario: Distinguishing support levels
- **WHEN** a capability is represented in a comparison matrix
- **THEN** it is marked supported, partial, or unsupported based on inspected source code

### Requirement: Preserve reference repositories
The research SHALL NOT modify any file under `references/`.

#### Scenario: Completing research
- **WHEN** the documentation is complete
- **THEN** all created or modified files are outside `references/`
