# ComfyUI video workflow

## Approved template: `image-to-video-v1`

One approved workflow exists, targeting **Wan 2.2 TI2V-5B** with native
ComfyUI nodes only (verified against ComfyUI 0.33.1). The graph mirrors the
official `video_wan2_2_5B_ti2v` template.

| Node  | Class                     | Role                                                  |
| ----- | ------------------------- | ----------------------------------------------------- |
| 37    | `UNETLoader`              | `wan2.2_ti2v_5B_fp16.safetensors`                     |
| 38    | `CLIPLoader`              | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` (type `wan`) |
| 39    | `VAELoader`               | `wan2.2_vae.safetensors`                              |
| 48    | `ModelSamplingSD3`        | shift (default 8)                                     |
| 6 / 7 | `CLIPTextEncode`          | motion prompt / negative prompt                       |
| 56    | `LoadImage`               | uploaded accepted Scene image                         |
| 55    | `Wan22ImageToVideoLatent` | width/height/length/batch + start image               |
| 3     | `KSampler`                | seed, steps, cfg, `uni_pc` / `simple`, denoise 1      |
| 8     | `VAEDecode`               | latent to frames                                      |
| 57    | `CreateVideo`             | fps (24)                                              |
| 58    | `SaveVideo`               | `studio/motion` prefix                                |

Every submission is validated in code (`validateComfyUiVideoPrompt`) against
the fixed node/link spec before any HTTP call. Mapping version
`image-to-video-v1-mapping-1` is baked into raw generation fingerprints;
changing the mapping invalidates stored fingerprints. Arbitrary user workflow
JSON and custom nodes are not supported.

## Model files (not committed)

| File                                     | Size   | Directory                          |
| ---------------------------------------- | ------ | ---------------------------------- |
| `wan2.2_ti2v_5B_fp16.safetensors`        | 9.3 GB | `ComfyUI/models/diffusion_models/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6.3 GB | `ComfyUI/models/text_encoders/`    |
| `wan2.2_vae.safetensors`                 | 1.3 GB | `ComfyUI/models/vae/`              |

Source: `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` on Hugging Face. License:
Apache 2.0. Studio never downloads models automatically; readiness reports
`VIDEO_MODEL_MISSING` with the missing file names instead.

## Security

Only the compiled template is ever submitted. Provider-returned filenames are
length-checked, extension-whitelisted, and resolved inside managed staging.
Prompts and graphs are never echoed into error messages.
