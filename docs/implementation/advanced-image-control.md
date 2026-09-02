# Advanced image control

Prompt #11 evaluates composition/pose control against the actual stack and records the decision.

## Actual tested stack

- ComfyUI `0.33.1` at `http://127.0.0.1:8188` (Windows portable, `--lowvram`)
- PyTorch 2.13.0 + CUDA 13.0, RTX 3060 12 GB
- `flux-2-klein-base-4b-fp8.safetensors`, `qwen_3_4b.safetensors`, `full_encoder_small_decoder.safetensors`
- Application-approved workflows: `text-to-image-v1`, `reference-character-v1` (native nodes only)

## Local inventory (checked 2026-09-02)

- `ControlNetLoader` and `ControlNetApplyAdvanced` exist as native nodes.
- `/models/controlnet` returns `[]`; `/models/loras` returns `[]`.
- The only relevant native preprocessor is `Canny`. No OpenPose, DWPose, Depth Anything, or ControlNet Aux nodes are installed.

## Technique evaluation

| Technique                                             | Klein 4B Base compatible                                                    | Required additions                                       | Decision                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Classic ControlNet (pose/depth/edge)                  | No official FLUX.2 Klein checkpoint; SD1.5/SDXL/FLUX.1 weights incompatible | Compatible checkpoint + pose/depth preprocessor nodes    | Reject                                                                                                                      |
| OpenPose/DWPose                                       | Preprocessor only; no matching control weights                              | ControlNet Aux or equivalent custom nodes                | Reject                                                                                                                      |
| Depth ControlNet                                      | No installed or official native Klein model                                 | Depth estimator + compatible model                       | Reject                                                                                                                      |
| Third-party RefControl FLUX.2 Klein 4B depth LoRA     | Model card targets this exact base                                          | Community LoRA + LoRA loader + depth preprocessing nodes | Defer pending independent evidence                                                                                          |
| Extra `ReferenceLatent` as composition reference      | Native                                                                      | None                                                     | Reject: no spatial strength controls; identity and composition share one unlabeled mechanism and can worsen reference bleed |
| New seeds + deterministic Scene-feedback regeneration | Fully compatible                                                            | None                                                     | Selected as the Prompt #11 quality path (candidate selection, NOT deterministic control)                                    |

Primary sources: BFL documents FLUX.2 Klein text-to-image and single/multi-reference editing only; the official ComfyUI ControlNet guide requires base-family-compatible models and notes most preprocessors need custom nodes; the RefControl 4B card identifies itself as a community LoRA requiring depth preprocessing.

## Decision

`ADVANCED_CONTROL_TECHNIQUE = NONE`

- `CONTROLNET_REQUIRED_NOW = NO` - no compatible model exists on this stack; installing one is unjustified without benchmark evidence.
- `LORA_REQUIRED_NOW = NO` - unchanged from Prompt #10; the RefControl LoRA remains a documented future candidate.
- No `SceneImageControlPlan`, control Asset type, custom node, model download, or third workflow template is implemented.
- `REFERENCE_PLUS_CONTROL` is intentionally NOT an accepted generation mode; the UI shows advanced control as disabled with the reason above.

## Readiness reporting

`POST /api/projects/:id/image-settings/readiness` includes `details.advancedControl`:

```json
{
  "status": "NOT_ADOPTED",
  "technique": null,
  "reasonCode": "NO_COMPATIBLE_CONTROL_MODEL",
  "message": "No ControlNet-compatible model for FLUX.2 Klein is installed; candidate review and feedback regeneration remain available"
}
```

This diagnostic is informational. TEXT_ONLY and REFERENCE_CONDITIONED readiness are unchanged and both approved workflows stay executable.

## Revisit criteria

A future technique requires a separate OpenSpec change that adds `SceneImageControlPlan`, control Assets, fingerprint/invalidation wiring, workflow mapping, and a real benchmark showing improved targeted composition/pose without significant identity regression. Deferral is not a permanent rejection: if a maintained Klein-compatible control model appears, re-run this evaluation.
