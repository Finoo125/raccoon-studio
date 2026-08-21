# Raccoon Studio Version 1.2

Image generation, video, the Director plot-to-film pipeline and a gallery, on
your rented GPU, in your browser, behind your own password. Nothing is shared
and no keys are baked in.

**This template ships the studio pre-installed.** ComfyUI, PyTorch, the 25
pinned node packs and a production build of the app are all inside the image, so
the pod has nothing to install — the studio answers about **30 seconds** after
its container starts.

What that does not skip is the first download. The image is ~10.6 GB, and a
machine that has never run this template has to fetch it first, which took
**6–10 minutes** in our testing on Community Cloud — those hosts are
individually owned machines on ordinary connections, not datacenter racks. It is
paid **once per machine**: stop and start the same pod, or land on a host that
has served this template before, and you are back to seconds.

If you would rather have the pod build everything from source on the volume,
deploy **Raccoon Studio** instead — both templates are maintained. It downloads
less up front but then installs for several minutes on every fresh pod.

Full docs: https://github.com/Finoo125/raccoon-studio/blob/main/runpod/README.md

## Deploying

1. Pick an **RTX 3090, 4090 or 5090**. All three are supported. 24 GB is
   comfortable; the low-VRAM options in the UI cover the tighter cards.
2. Replace the **`RACCOON_PASSWORD`** placeholder (`change-me`). Leave it as it
   is and a random password is generated and printed in the pod log instead.
3. Optionally set **`RACCOON_USERNAME`** (defaults to `raccoon`).
4. Open the **HTTP 8080** link and log in.

Only port 8080 is published. The app and ComfyUI are bound to loopback inside
the container; the login portal in front of them is the only way in.

## Getting models

The image carries the helper models the default workflows need by name — face
restore, the upscalers, the detector and segmentation models — but **no
checkpoints**. Install those from the **Models page** inside the app. It
downloads straight to the pod and never touches your own connection, which is
also the only way that works: uploads through the browser are capped at roughly
500 MB by the proxy in front of every pod.

Models land on the volume, so they survive a stop/start and only have to be
fetched once.

## Storage

Everything mutable lives under `/workspace` on the volume: models, output,
input, settings, prompt presets, wildcards, Director projects, face models and
logs. The install itself sits on the container disk and is restored from the
image on every start, which is why a restart costs seconds rather than minutes.

- **Stopping** a pod keeps the volume. Your gallery and models are still there
  when you start it again.
- **Terminating** a pod destroys its volume disk and everything on it. Attach a
  **network volume** if you want your library to outlive the pod, or export from
  Tools → Backup before you terminate.

## Sessions

`RACCOON_SESSION_SECRET` is deliberately **not** in the deploy form. The proxy
generates a fresh one on every boot, so a restart logs you out — the safe
default. Add the variable yourself, with a value only you know, if you want
sessions to survive restarts. Never reuse a value someone else could have.

## Version

The image is pinned to an exact version tag, so a deployed pod is reproducible.
A newer Raccoon Studio release means a newer image and a re-pinned template; the
in-app Update button does not apply here, because the container disk is restored
from the image on every start.

Community templates are self-supported: RunPod points users at the creator, not
at RunPod support.
