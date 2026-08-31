# AI usage and budget controls

AI usage is observational metadata, not a generation prerequisite. The OMP boundary returns provider/model identifiers and nullable input tokens, output tokens, cost, currency, finish reason, and duration. A provider that does not expose usage is still valid.

`ai_usage` records belong to a project, generation record, operation, entity, and attempt. Successful V2 finalization writes the usage row in the same SQLite transaction as the chapter, summary, StateDelta, StoryState, lineage, and generation completion. Failed attempts may retain bounded usage when the provider supplied it. Duplicate finalization does not overwrite a terminal usage record.

Known estimates are checked against the configured per-operation and project budget limits before the OMP call. Unknown token or cost values never block basic generation and remain `null` in API/UI responses. Exact cost is never inferred from prompt length.

Context diagnostics persist the estimated token count, configured budget, selected character/thread/summary counts, selected sections, omitted sections, compression/truncation flags, and source revision identifiers. The compiler drops optional candidates by whole record or section and returns `CONTEXT_ERROR` when required material alone cannot fit.

The API exposes aggregate usage totals and bounded recent usage. Provider credentials, access tokens, raw SDK events, and internal stack traces are never stored in Story settings, usage rows, API responses, or logs.
