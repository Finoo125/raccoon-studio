# Raccoon Studio

Image generation, video, the Director plot-to-film pipeline and a gallery, on
your rented GPU, in your browser, behind your own password. Nothing is shared
and no keys are baked in.

Full docs: https://github.com/Finoo125/raccoon-studio/blob/main/runpod/README.md

## Deploying

1. Pick an **RTX 4090 or 5090**. 24 GB is comfortable; 16 GB works with the
   low-VRAM options in the UI.
2. Replace the **`RACCOON_PASSWORD`** placeholder (`change-me`). Leave it and a
   random password is generated and printed in the pod log instead.
3. Optionally switch model groups to `yes` (below) to have them ready at your
   first login.
4. Open the **HTTP 8080** link. It shows a live install log with a progress bar
   and turns into the login page by itself when the studio is ready.

## Pick your models

The pod ships no checkpoints of its own. Set any of these to `yes` and it is
downloaded during boot, before ComfyUI starts. All default to `no`.

| Variable | Model | Size |
|---|---|---|
| `DOWNLOAD_KREA2_TURBO` | Krea2 Turbo - fast 8-step, the everyday model | ~18 GB |
| `DOWNLOAD_KREA2_RAW` | Krea2 RAW - 52-step base, highest fidelity | ~18 GB |
| `DOWNLOAD_Z_IMAGE_TURBO` | Z Image Turbo | ~20 GB |
| `DOWNLOAD_ANIMA` | Anima - anime-style text-to-image | ~5 GB |
| `DOWNLOAD_ANIMA_TURBO` | Anima Turbo - same look, ~3x fewer steps | ~5 GB |
| `DOWNLOAD_ERNIE_TURBO` | Ernie Image Turbo - fast photorealism | ~29 GB |
| `DOWNLOAD_SDXL` | Stable Diffusion XL base 1.0 | ~7 GB |
| `DOWNLOAD_PONY` | Pony Diffusion V6 XL | ~7 GB |
| `DOWNLOAD_ILLUSTRIOUS` | Illustrious XL v0.1 | ~7 GB |
| `DOWNLOAD_LTX_VIDEO` | LTX 2.3 video | ~45 GB |
| `DOWNLOAD_MINIMAX_H3` | MiniMax H3 video + synced audio | ~42 GB |
| `DOWNLOAD_CONTROLNET` | ControlNet + IP-Adapter | ~9 GB |

Nothing is ever re-downloaded: a file already on the volume is skipped, so
leaving these on `yes` is free on later boots, and turning one on afterwards
only needs a restart. A failed download warns and the studio still comes up.
You can also grab any of them later from the Models page inside the app.

## Terminating a pod destroys your gallery

The volume survives *stopping* a pod. It does **not** survive *terminating*
one. Either attach a **network volume** at deploy time (~$0.07/GB/mo, survives
terminate) or **export before you terminate** (Settings > Backup > Download).
Note that a stopped pod bills its volume at **double** the running rate, so if
you are not coming back within a day or two, export and terminate.

## Why the first boot takes a few minutes

The template carries no image of its own. It boots a stock `ubuntu:24.04` and
installs ComfyUI, PyTorch, the pinned node packs and the app onto the volume,
which means an update is available the moment it is published. That is about
**6 minutes on a fast host and 25+ on a slow one**, plus whatever you asked to
download. The spread is the host's route to HuggingFace, not the GPU, and the
install page names the file it is on so a slow boot is visibly working. Later
boots are ~2 minutes.

Everything mutable lives under `/workspace`, so a stop/start keeps all of it.
Only port 8080 is published; the app and ComfyUI are bound to loopback behind
the login portal.

## Notes

- **The pod is only as private as your password.** Set a real one, or use
  `{{ RUNPOD_SECRET_yourname }}` to keep it out of the console.
- `RACCOON_SESSION_SECRET` is optional; without it a restart logs you out.
- Browser uploads cap at ~500 MB (Cloudflare); downloads are unlimited. Use the
  Models page for models - it downloads to the pod at datacenter speed.
- Logs live in `/workspace/logs/`.
- Community templates are self-supported: questions go to Discord or Patreon.
