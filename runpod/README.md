# Raccoon Studio on RunPod

Run the full studio — image generation, video, Director, the gallery — on a
rented GPU, in your browser, behind a password. You deploy it on your own RunPod
account; nobody else has access and no keys are baked into the image.

---

## ⚠️ Read this first: terminating a pod destroys your gallery

The volume disk survives *stopping* a pod. It does **not** survive *terminating*
one — RunPod deletes it, and everything you generated goes with it, along with
the installed models.

A template cannot include a network volume, so you have to choose one of these
**before** you terminate:

| Option | Survives terminate | Cost | Catch |
|---|---|---|---|
| **Attach a network volume** at deploy time | ✅ | ~$0.07/GB/mo | Locked to one datacenter, which narrows the GPUs you can rent later. Cannot be added to an existing pod. |
| **Export before terminating** (Settings → Backup → Download) | ✅ | free | Manual, and you must remember |
| **Just stop the pod** | ❌ | **$0.20/GB/mo** | The most expensive option and it still loses everything on terminate — see below |

**Stopping is not free, and it is not cheap.** A stopped pod bills its volume
disk at **double** the running rate. If you are not coming back within a day or
two, export and terminate.

---

## Deploying

1. RunPod console → **Templates** → deploy the Raccoon Studio template.
2. Pick an **RTX 4090 or 5090**. Both work; the 5090 is roughly twice the price
   and noticeably faster on video. Anything with 24 GB is comfortable; 16 GB
   works with the low-VRAM options in the UI.
3. Set **`RACCOON_PASSWORD`** in the environment variables. If you leave it
   blank a random password is generated and printed in the pod log — the pod is
   never unprotected, but you will have to go and read the log to get in.
4. Open the **HTTP 8080** link. It shows a live install log with a progress bar,
   and turns into the login page by itself when the studio is ready.

| Setting | Value |
|---|---|
| Container disk | 30 GB |
| Volume disk | 100 GB at `/workspace` (the install itself takes ~16 GB) |
| Exposed HTTP port | 8080 |
| `RACCOON_PASSWORD` | **set this** |
| `RACCOON_USERNAME` | optional, defaults to `raccoon` |
| `RACCOON_SESSION_SECRET` | optional; without it a pod restart logs you out |

### Why the first boot takes a few minutes

The template deliberately carries **no image of its own** — it boots a stock
`ubuntu:24.04` and installs everything on the pod, straight from the source. A
datacenter connection makes that faster than pulling a pre-built image would be,
and it means an update is available the moment it is published, with nothing to
re-download.

Measured on community RTX 3090s:

| | |
|---|---|
| First boot: ComfyUI, PyTorch (CUDA 12.8), 25 pinned node packs, 3.6 GB of default models, then a production build of the app | **6 minutes on a fast machine, 25+ on a slow one** |
| Later boots: the volume already has all of that, so only the container's own packages are reinstalled | **~2 minutes** |
| On disk afterwards | ~16 GB (11 GB of it PyTorch and its CUDA libraries) |

That first-boot spread is not the GPU — it is the individual machine's route to
HuggingFace, and it varies by a factor of five between two pods of the same
model in the same cloud. The install page shows which file it is on, so a slow
first boot is visibly working rather than hung. If it matters to you, terminate
and redeploy: you will usually land on a different host.

Everything mutable lives under `/workspace` — the install itself, models,
output, input, settings, prompt presets, wildcards, Director projects, face
models and logs — so a stop/start keeps all of it.

Only port 8080 is published. The app (3000) and ComfyUI (8188) are bound to
loopback inside the container and are not reachable from the internet; the
login portal in front of them is the only way in.

---

## Getting files in and out

Measured through RunPod's HTTPS proxy, not guessed:

| Direction | Works | Notes |
|---|---|---|
| Download (gallery item, backup archive) | ✅ any size | 2 GB verified end to end |
| Upload (images, movie projects, small LoRAs) | ✅ **under ~500 MB** | |
| Upload (checkpoints, big LoRAs) | ❌ | Cloudflare rejects any request body over roughly 500 MB with a `413`, no matter how fast your connection is. Use one of the paths below. |

### Models — do not upload them through the browser

Use the **Models page** inside the app: it downloads directly to the pod at
datacenter speed and never touches your connection. That is the intended path
and it is faster than uploading anyway.

For a model the app cannot fetch, or to move a large library:

- **`runpodctl send` / `receive`** — one-time code, no setup. Best for a one-off
  file.
- **S3-compatible API** — works with **no pod running**, so you can pull a whole
  session's output after terminating, or push models in before deploying.
  Resumable and parallel, via `aws s3`, rclone, boto3 or Cyberduck. Needs a
  network volume in one of the supported datacenters and an S3 API key. Limits:
  4 TB per file, 500 MB per multipart part, and `sync` gets unreliable past
  ~10 000 files.
- **Cloud Sync** — console-driven volume ↔ S3 / GCS / Azure / B2 / Dropbox. No
  CLI at all.
- **`rsync` / `scp` over SSH** — resumable and incremental, if you have SSH on.

RunPod charges no ingress or egress fees, so none of these cost bandwidth.

### Backups

Settings → Backup writes an archive containing your gallery, sidecars (favorites
and tags), settings, prompt presets, wildcards, queue history, face models and
movie projects — everything except the model files, which you can always
re-download. Download it before you terminate.

Restoring is the same screen in reverse. Note the ~500 MB upload ceiling: if
your backup is bigger than that, move it with `runpodctl` or the S3 API and
restore from the path instead.

---

## Security

- **The pod is only as private as your password.** The URL is guessable in
  principle and public in practice — anyone who has it can reach the login page.
  Set a real `RACCOON_PASSWORD`. Repeated failed logins are rate-limited per IP
  and globally, but a weak password is still a weak password.
- Prefer `{{ RUNPOD_SECRET_yourname }}` if you would rather the password not sit
  in plain text in the console UI.
- **ComfyUI-Manager can install arbitrary code from the internet.** On your own
  pod behind your own password that is your call, but it is worth knowing that
  installing a custom node pack runs someone else's code on your machine.
- Sessions are a signed cookie with a 30-day life. Without
  `RACCOON_SESSION_SECRET` the signing key is regenerated at every boot, so
  restarting the pod logs every browser out — which is usually what you want.
- The install log served on port 8080 during the first minutes is public, by
  design — it exists so you can see progress before there is anything to log
  into. It contains no credentials, and it stops being served the moment the
  login page takes over.

## Cost safeguards

- A **$0 balance auto-stops** your pods. It does not terminate them, so storage
  keeps billing.
- The default account **spend cap is $80/hour**. Worth lowering.
- Storage bills on stopped pods. The only way to stop paying entirely is to
  terminate — which is also the thing that deletes your data, so export first.

## Troubleshooting

**502 or "not found" on the pod URL, right after deploying** — the container is
still starting. Give it a minute; the install page appears as soon as there is
something to show.

**The install page stops moving** — the log on that page is the whole story.
Anything fatal ends with `install FAILED`, and the page keeps serving the log
rather than leaving you with a dead pod.

**The page loads but generation progress and live previews never move** — that
is the ComfyUI WebSocket. Check the pod log for `[proxy] listening`; if the
proxy is up, look at `/workspace/logs/comfyui.log`.

**A red banner about missing models** — the pod installs the models the default
workflows need by name, but checkpoints are downloaded from the Models page.
Fetch one there first.

**Logs** live in `/workspace/logs/` — `boot.log` (this boot), `boot.previous.log`
(the one before), `comfyui.log` and `app.log`.

---

Community templates are self-supported: RunPod points users at the creator, not
at their own support. Questions go to Discord or Patreon.
