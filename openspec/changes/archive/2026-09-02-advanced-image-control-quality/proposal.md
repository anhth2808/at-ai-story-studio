## Why

Prompt #10 materially improved recurring-character identity, but its real Scene 2 benchmark exposed reference-composition bleed: the character stayed recognizable while the required engine-room framing and action were lost. The current FLUX.2 Klein 4B Base stack has no installed ControlNet model, LoRA, or pose/depth preprocessor and no official Klein pose/depth ControlNet path, so Prompt #11 should improve practical image selection and correction without replacing the proven identity workflow or installing an unproven control stack.

## What Changes

- Record the current advanced-control decision as `ADVANCED_CONTROL_TECHNIQUE = NONE`: native ControlNet nodes exist locally, but no compatible control model is installed; FLUX.1/SD ControlNets are incompatible; the only plausible Klein 4B depth option found is a small third-party RefControl LoRA that adds model and preprocessor maintenance without benchmark evidence. No `SceneImageControlPlan`, control Asset type, custom node, model download, or third workflow template is added in this milestone.
- Add persisted, bounded image candidate sets for one Scene, with 1-4 candidates, distinct concrete seeds by default, normal durable image jobs, and a hard batch-job guardrail. Technical retry remains the same logical candidate; creative regeneration creates a new candidate.
- Keep `TEXT_ONLY` and `REFERENCE_CONDITIONED` unchanged and preserve every explicit `CharacterId -> ReferenceAsset` mapping, reference hash, profile revision, workflow version, fingerprint, stale-result guard, and historical image revision.
- Add structured manual quality review with 1-5 scores for identity, prompt adherence, composition, pose/action, location, important objects, style, artifacts, and overall; bounded issue tags; notes; and `UNREVIEWED`/`ACCEPTED`/`REJECTED` state.
- Make acceptance select the reviewed candidate as the current Scene image atomically. Candidate generation never replaces an accepted current image; multi-candidate sets never auto-select. A single candidate may retain the existing first-image behavior only when no current image exists and project approval is not required.
- Add `requireImageApproval` as a default-off project policy that affects downstream readiness but not generation fingerprints or visual staleness.
- Add deterministic feedback-aware regeneration from a rejected candidate. Structured issues and user notes produce bounded generation guidance without mutating Story, Scene, Visual Prompt Package, or Character Visual Profile data and without an LLM call or automatic regeneration loop.
- Extend the Scene image UI with candidate-count controls, a responsive candidate grid, structured review controls, accept/reject/regenerate actions, Scene camera/composition/action context, disabled advanced-control availability with an evidence-based reason, and comparison across available generation modes.
- Reuse the existing database-backed image workflow and effective concurrency one. Do not add another queue, automatic quality model, OMP vision step, AI video, LoRA training, or generic ComfyUI editor.
- Run real ComfyUI verification on the existing recurring-character five-Scene benchmark, including the engine-room composition-bleed failure, and compare the original reference-conditioned results with candidate selection and feedback-regenerated results using persisted scores for identity, composition, pose/action, prompt adherence, location, style, and overall quality.

## Capabilities

### New Capabilities

- `image-quality-workflow`: Persisted candidate sets, bounded multi-candidate scheduling, structured manual quality review, acceptance/current-image semantics, approval gating, deterministic feedback regeneration, candidate UI, and real quality benchmark evidence.

### Modified Capabilities

- `image-generation`: Extend scheduling, persistence, current-selection safety, batch guardrails, and APIs for candidate sets while preserving retry, regeneration, fingerprints, stale-result protection, manual overrides, and the existing ComfyUI templates.
- `reference-conditioning`: Require candidate and feedback workflows to retain explicit character-reference mappings and verify that identity quality does not regress while composition selection improves; document that multi-character conditioning remains limited.

## Impact

- Shared contracts: image candidate-set DTOs, review score/issue schemas, candidate-count and feedback-regeneration requests, approval policy, and advanced-control availability diagnostics.
- Database: one lightweight candidate-set table, candidate-set linkage/index on Scene image generations, structured review JSON fields, and a default-off approval-policy column; no control-plan or control-asset tables.
- Workflow/API: `ImageGenerationService`, `SceneImageGenerationRepository`, existing `GENERATE_SCENE_IMAGE` jobs, thin candidate/review/accept/feedback routes, and no provider-specific control API.
- Provider: existing `text-to-image-v1` and `reference-character-v1` mappings remain the only templates; ComfyUI readiness reports why advanced control is unavailable without degrading basic readiness.
- UI: the existing React Scene image panel and current styling system.
- Verification/documentation: focused database/workflow/API tests, full image/visual/story/scene/TTS regressions, browser verification, real five-Scene ComfyUI runs, benchmark scoring, and the requested implementation documentation updates.
