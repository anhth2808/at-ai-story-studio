## MODIFIED Requirements

### Requirement: Small local-first architecture
The design SHALL specify a TypeScript-first modular monolith suitable for a personal/local application and SHALL exclude microservices, distributed brokers, Kubernetes, event sourcing, mandatory cloud infrastructure, and a mandatory Python backend from V1.

#### Scenario: Developer selects the V1 deployment model
- **WHEN** a developer reviews the system and technology decisions
- **THEN** the selected baseline uses a pnpm workspace with Node.js, TypeScript, React, Vite, Fastify, SQLite, Drizzle ORM, a database-backed Node.js worker, local filesystem assets, provider interfaces, and FFmpeg/ffprobe
- **AND** Python is limited to an optional explicit sidecar or subprocess boundary when native Node integration, an external HTTP API, or an existing service API is not practical
- **AND** the architecture preserves the approved V1 product scope and introduces no application code
