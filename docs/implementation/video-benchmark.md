# Video benchmark (Prompt #13)

Real local benchmarks of the selected technique on the target workstation,
run 2026-09-03/04 through the shipped `ComfyUiVideoProvider` + durable worker
pipeline. Selected technique: **Wan 2.2 TI2V-5B** via the approved native
ComfyUI `image-to-video-v1` workflow (no custom nodes, Apache 2.0).

## Environment

- GPU: NVIDIA GeForce RTX 3060 12GB (Ampere), driver 591.86
- System RAM: 32GB
- ComfyUI: 0.33.1 portable at `D:\AI\ComfyUI_windows_portable` (127.0.0.1:8188)
- Model files (already installed, 16.9 GB total):
  - `wan2.2_ti2v_5B_fp16.safetensors` 9.3 GB (diffusion_models)
  - `wan2.2_vae.safetensors` 1.3 GB (vae)
  - `umt5_xxl_fp8_e4m3fn_scaled.safetensors` 6.3 GB (text_encoders)
- Sampler: `uni_pc` / `simple`, steps 20, guidance 5, shift 8, output 24 fps

## Results (measured through the real API + worker, not scripts)

| #   | Scene type                           | Preset   | Resolution | Frames | Clip len | Provider time                    | Peak VRAM  |
| --- | ------------------------------------ | -------- | ---------- | ------ | -------- | -------------------------------- | ---------- |
| 1   | Environment wide (lighthouse sunset) | BALANCED | 832x480    | 81     | 3.375s   | 230s (cold, includes model load) | 10,585 MiB |
| 2   | Character over-the-shoulder          | BALANCED | 832x480    | 81     | 3.375s   | 224s (warm)                      | ~10.6 GB   |
| 3   | Action extreme wide                  | BALANCED | 832x480    | 81     | 3.375s   | 221s (warm)                      | ~10.6 GB   |
| 4   | Climax full shot (HYBRID source)     | BALANCED | 832x480    | 81     | 3.375s   | 221s (warm)                      | ~10.6 GB   |
| 5   | Environment wide, regenerate         | BALANCED | 832x480    | 81     | 3.375s   | 220s (warm)                      | ~10.6 GB   |
| 6   | Environment wide, regenerate         | LOW_VRAM | 704x384    | 81     | 3.375s   | 141s (warm)                      | < BALANCED |

- First-run wall time was ~7m20s (model load from SSD + queue + sampling +
  VAE decode + download + ffprobe + promotion); warm BALANCED generations
  settle at ~3m40s provider time. LOW_VRAM is ~36% faster.
- Worker-restart reconciliation during a live generation resumed by
  reconciling the persisted ComfyUI job id: attempt 2 took 14s (skip
  submission, poll, download, validate, commit). ComfyUI queue never held a
  duplicate.

## Visual observations (manual review)

- Identity: the subject/clothing from the source frame holds over 3.4s at
  SUBTLE-intent prompts; minor softening is typical of 480p-class diffusion.
- Environment: fog/water/light ambience motion reads naturally - the strongest
  use case for establishing shots.
- Action scenes at EXTREME_WIDE: motion is present but understated; large
  pose changes remain unreliable (expected at 5B scale), which is why HYBRID
  (short burst + Ken Burns continuation) is the recommended long-form mode.
- Known failure modes to review for: face softening on close shots, background
  morphing during strong motion, occasional flicker. The review gate with
  issue tags exists for exactly these.

## RTX3060_12GB_PRACTICAL

**YES.** Repeated real generations fit in 12GB (10.6GB peak at BALANCED with
ComfyUI native offloading), complete in 2-4 minutes per 3.4s clip warm, and
require no custom nodes. The QUALITY preset (1280x704x121) is available but
was not adopted as default on this GPU class.

## Default preset decision

`BALANCED` (832x480, 81 frames, 20 steps) ships as default: measured 10.6GB
peak leaves headroom, and 480p-class source normalizes cleanly to 1080p via
the SceneClip stage. Use `LOW_VRAM` for bulk pre-generation batches
(~2m20s/clip); `QUALITY` targets future 16GB+ hardware.
