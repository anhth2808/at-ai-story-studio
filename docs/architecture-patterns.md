# Architecture Patterns

## Pattern scorecard

| Pattern | Best reference | Evidence | What to retain | Limitation |
|---|---|---|---|---|
| AI execution boundary | OMP SDK + lessons from MoneyPrinterTurbo/NarratoAI | OMP SDK; reference managers at the application/provider seam | Thin `AiAgent` contract, structured results, explicit configuration, scoped attempts | OMP defaults require restriction; reference provider identity/config is mixed with UI and global state |
| Pipeline decomposition | pyvideotrans | `videotrans/task/trans_create.py:25-53`; stage mixins | Small named stages and explicit contracts | Hard-coded mutable mixin graph |
| Workflow engine/resume | story-claw + ShortGPT | `story-claw/runner/solo.ts:63-103,125-277`; `ShortGPT/shortGPT/engine/abstract_content_engine.py:60-75` | Stage records, artifact gates, skip/retry semantics | Files/JSON are not transactional or multi-user safe |
| Database-backed jobs | MoneyPrinter | `Backend/models.py:20-79`; `worker.py:35-76` | Job/event/status/cancel/attempt fields | Current worker does not implement retries/resume despite attempt columns |
| Queue workers | pyvideotrans | `videotrans/task/job.py:13-67,71-206` | Stage queues, cancellation, worker-specific concurrency | One global in-memory process; no durable leases |
| Asset storage | story-claw | `utils/paths.ts`, `utils/progress.ts`, `render.ts:338-591` | Workspace taxonomy, reference lineage, deterministic filenames | No content-addressed object store or DB index |
| Temporary-file isolation | MoneyPrinterTurbo / F5 | `app/services/task_artifacts.py`; `F5-TTS/infer/utils_infer.py:298-378` | Per-task artifacts and reference preprocessing caches | Cleanup and cache eviction policies remain uneven |
| Caching | NarratoAI + F5 + MoneyPrinterTurbo | keyframe cache `frame_analysis_service.py:283-338`; MD5 refs F5 `utils_infer.py:301-365`; material cache | Cache expensive deterministic inputs; persist analysis | Cache keys and invalidation are not unified |
| Retry/fallback | story-claw + MoneyPrinterTurbo | image retry/fallback `render.ts:626-674`; material polling `material.py:622-631`; codec fallback `video.py:279-313` | Retry only transient errors, fallback at typed boundary | No global retry budget/cost policy |
| GPU management | pyvideotrans + story-claw | `job.py:208-247`; `solo.ts:177-189,283-297` | Resource class, concurrency cap, guaranteed shutdown | No shared scheduler or usage/cost ledger |
| Parallel processing | story-claw | global semaphores `render.ts:796-819`; scene `Promise.all` in `solo.ts:217-229` | Global, not per-scene, semaphores; dependency events | Failures are mostly logged/raised without centralized retry queue |
| Timeline/render | story-claw + NarratoAI | `render.ts:1724-1798`; `generate_video.py:1045-1751` | Probe real durations, normalize media, progress callbacks | Timeline is implicit in files/options rather than a durable IR |

## AI execution and specialized provider patterns

MoneyPrinterTurbo's `LLMProviderSpec` and NarratoAI's provider managers demonstrate why application features need a stable seam, explicit configuration, scoped instances, and normalized results. AI Story Studio should learn from those boundaries but not reproduce their LLM provider registries. Intelligent features call a thin `AiAgent`; `OmpAgent` delegates provider/model execution to OMP SDK. TTS, ASR, image, video, translation, ComfyUI, and FFmpeg retain specialized contracts with capability metadata such as `word_timestamps`, `image_references`, `local`, and `gpu_class`. Do not copy numeric provider IDs from pyvideotrans; those IDs are UI/config constants.

## Pipeline and workflow engine

pyvideotrans is strongest for a linear dubbing pipeline where every task passes through known queues. ShortGPT demonstrates a simpler resume mechanism: each `_db_*` mutation persists and `_db_last_completed_step` advances after a step. story-claw is strongest for a branching story pipeline with review, images-only mode, per-scene parallelism, completeness gates, and finalization. A studio should use a persisted DAG: each node has inputs, output artifact IDs, status, attempts, resource class, and cache key; UI can present it as a pipeline.

## Jobs, workers, retries

MoneyPrinter proves the minimal API contract: enqueue, poll status, stream events, cancel. pyvideotrans proves stage-specific workers and cancellation. Combine them with a database lease/heartbeat model, idempotent stage handlers, retry policy by error class, and per-stage event logs. `attempt_count` must affect behavior, unlike current MoneyPrinter. Never clean a shared global temp directory while other jobs may run.

## Asset and temporary-file management

story-claw's named episode/workspace directories make human inspection and resume practical. F5's MD5 reference cache avoids repeating expensive normalization. MoneyPrinterTurbo persists material source records and cache results. The target system should use both: immutable content-addressed blobs plus a human-readable project workspace of manifests, previews, and derived artifacts. Temporary files should be scoped to a stage attempt and deleted only after the output manifest is committed.

## GPU scheduling and parallelism

pyvideotrans derives worker counts from GPU count and configured limits. story-claw uses global semaphores across scenes and shuts down a rented GPU in `finally`. The future scheduler should expose CPU/GPU/model-memory requirements, reserve a worker lease, cap concurrent image/video/TTS jobs independently, and record start/stop/cost. Parallelize independent scene/panel work only after dependencies (TTS duration, previous continuation frame, selected references) are available.

## Configuration-driven workflows

ShortGPT JSON editing steps and story-claw ComfyUI workflow templates demonstrate configuration-driven execution. Keep provider secrets and workflow templates outside source; validate schemas before execution. A studio timeline IR should be stable while renderer/provider templates can change.

## Bottom line

Best overall architecture seed: story-claw's staged story workflow + pyvideotrans's stage queue/resource thinking + MoneyPrinter's job API/database + OMP SDK behind a thin `AiAgent` boundary + NarratoAI's cached analysis lessons + whisperX's timing contract. Reimplement the application seams as one durable, typed system without rebuilding OMP's LLM provider layer.
