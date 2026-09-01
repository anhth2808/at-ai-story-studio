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

Start ComfyUI using its normal installation command and ensure port 8188 is reachable. Then open the Studio Scene workspace, choose **Cài đặt tạo ảnh**, enter the model filenames exactly, save, and choose **Kiểm tra kết nối**.

## Approved native workflow

The controlled Flux 2 graph uses only:

`UNETLoader`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode`, `RandomNoise`, `KSamplerSelect`, `Flux2Scheduler`, `EmptyFlux2LatentImage`, `CFGGuider`, `SamplerCustomAdvanced`, `VAEDecode`, and `SaveImage`.

Studio maps prompt, negative prompt, concrete seed, normalized dimensions, steps, guidance, sampler, and configured model components. Node IDs, classes, links, and the output node are validated before submission.

## HTTP endpoints

Studio uses only these ComfyUI routes:

- `GET /system_stats`
- `GET /object_info` and per-class fallback
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
