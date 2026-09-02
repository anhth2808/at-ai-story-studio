# ComfyUI

AI Story Studio expects an independently installed local ComfyUI server. It does not install models, download checkpoints, or accept client-supplied workflow JSON.

## Tested local configuration

- ComfyUI: `0.33.1`
- Server: `http://127.0.0.1:8188`
- Workflow: `text-to-image-v1`
- Diffusion model: `flux-2-klein-base-4b-fp8.safetensors`
- Text encoder: `qwen_3_4b.safetensors`
- VAE: `full_encoder_small_decoder.safetensors`
- Sampler: `euler`

## Approved native workflows

Two application-approved templates exist; both use only native nodes.

`text-to-image-v1` (default):

`UNETLoader`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode`, `RandomNoise`, `KSamplerSelect`, `Flux2Scheduler`, `EmptyFlux2LatentImage`, `CFGGuider`, `SamplerCustomAdvanced`, `VAEDecode`, and `SaveImage`.

`reference-character-v1` (reference conditioning) adds per reference:

`LoadImage` -> `ImageScaleToTotalPixels` (lanczos, 1.0 MP, resolution_steps 1) -> `VAEEncode` -> `ReferenceLatent` chained on both the positive and the negative conditioning, mirroring the official klein-base CFG reference template. The same VAEEncode latent feeds both chains. Node IDs, classes, inputs, and links are validated per template before submission.

Studio maps prompt, negative prompt, concrete seed, normalized dimensions, steps, guidance, sampler, configured model components, and reference-image inputs. No custom nodes and no additional model files are required for either template.

Advanced image control (Prompt #11): no ControlNet/LoRA/pose/depth path is adopted. Readiness reports `details.advancedControl.status = NOT_ADOPTED` with reason `NO_COMPATIBLE_CONTROL_MODEL`. See `advanced-image-control.md` for the full evaluation.

## HTTP endpoints

Studio uses only these ComfyUI routes:

- `GET /system_stats`
- `GET /object_info` and per-class fallback
- `POST /upload/image` (multipart; reference images land in the ComfyUI input directory; the returned `name` is used in `LoadImage`)
- `GET /models/diffusion_models`
- `GET /models/text_encoders`
- `GET /models/vae`
- `GET /api/jobs?limit=1` for optional targeted-cancel detection
- `GET /history/{prompt_id}`
- `GET /queue`
- `POST /prompt`
- `GET /view`
- `POST /api/jobs/{prompt_id}/cancel` when supported
- `DELETE /queue` for one matching queued prompt

Readiness checks endpoint compatibility, required native nodes, configured model availability, sampler choices, and cancellation capability. Base URLs must use credential-free HTTP or HTTPS. Prompts and graphs are not copied into provider error messages.

## Recovery and cancellation

The persisted provider prompt UUID is checked in history and queue before submission. A completed prompt resumes download; a queued or running prompt resumes polling. Unknown outcomes remain retryable instead of being reported as successful.

Targeted cancellation is used only after capability detection. A matching queued prompt may be deleted. Studio never sends a global interrupt because it could terminate unrelated ComfyUI work. On servers without targeted running-job cancellation, Studio stops local waiting and reports the limitation honestly.
