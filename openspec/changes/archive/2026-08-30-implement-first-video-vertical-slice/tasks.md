## 1. Core Architecture Documentation

- [x] 1.1 Update `docs/design-v1/01-system-architecture.md` for the TypeScript-first modular monolith, pnpm applications/packages, Fastify boundary, persisted Node.js worker, shared contracts, and external-process boundary; verify its diagram and stack terms are internally consistent
- [x] 1.2 Update `docs/design-v1/05-provider-architecture.md` for TypeScript provider contracts, explicit Python escalation order, versioned sidecar contracts, and ComfyUI API integration; verify workflow ownership remains in Node.js
- [x] 1.3 Update `docs/design-v1/10-database-design.md` for Drizzle schema management, migrations, transactions, indexes, WAL, busy timeout, concurrency, and atomic job claiming; verify PostgreSQL remains deferred
- [x] 1.4 Update `docs/design-v1/11-background-jobs.md` for one persisted Node.js worker, lease recovery, progress, retry, cancellation, and duplicate-execution controls; verify Redis, BullMQ, RabbitMQ, and Kafka are not introduced

## 2. Stack and Decision Documentation

- [x] 2.1 Rewrite `docs/design-v1/13-technology-stack.md` around Node.js, TypeScript, React, Vite, Fastify, SQLite, Drizzle ORM, pnpm, FFmpeg/ffprobe, Zod boundaries, and a centralized shell-free process runner; verify no application code or package scaffold is created
- [x] 2.2 Update `docs/design-v1/16-risks-and-decisions.md` with the .NET-to-TypeScript ADR, advantages, disadvantages, Python interoperability, and future impact; verify existing product and workflow decisions remain intact
- [x] 2.3 Update `docs/design-v1/README.md` executive decision, key decisions, and implementation milestones; verify the document map and V1 scope are unchanged

## 3. Cross-Document Consistency

- [x] 3.1 Update stack-specific wording in `docs/design-v1/12-ui-design.md` and `docs/design-v1/14-reference-reuse.md`; verify useful UI, product, domain, workflow, and research content is otherwise unchanged
- [x] 3.2 Search `docs/design-v1` and the active V1 OpenSpec delta for obsolete ASP.NET Core, EF Core, `.NET BackgroundService`, C# contract, and .NET-owned orchestration statements; verify remaining .NET wording is historical/alternative context and the delta supersedes the current baseline spec
- [x] 3.3 Run strict OpenSpec validation for `implement-first-video-vertical-slice` and a documentation link/check command available in the repository; verify both complete without errors
