# RaccoonSwapNodes

Pixel-boost face swapping for ComfyUI — Raccoon Studio's vendored swap pack.

Three nodes, all in category `RaccoonStudio`:

| Node | Display name | For |
|---|---|---|
| `RaccoonPixelBoostSwap` | Pixel Boost Face Swap 🦝 | one face, stills |
| `RaccoonVideoFaceSwap` | Video Face Swap 🦝 | up to 4 characters, whole clip |
| `RaccoonDetectFaces` | Detect Faces 🦝 | the picker's "find faces in this frame" |

All three swap at 512–1024px *effective* resolution using FaceFusion's
pixel-boost technique, so detail comes from the swap itself instead of a face
restorer hallucinating it back.

## How pixel boost works

The target face crop is aligned at boost resolution (e.g. 512×512), then
**pixel-unshuffled** into N² model-sized sub-frames. Each sub-frame is a
full-face subsampled grid — *not* a spatial patch — so every sub-frame sees
the whole face. Each is swapped through the ONNX swapper with the same source
embedding, the results are re-interleaved, and the crop is pasted back with a
feathered mask. Seam-free by construction (`swap_math.py`).

## Node reference

| Input | Type | Notes |
|---|---|---|
| `image` | IMAGE | target frame (first in batch) |
| `swap_model` | combo | onnx files found in `models/insightface`, `models/hyperswap`, `models/alphaface` |
| `pixel_boost` | combo | `512x512` (default) / `768x768` / `1024x1024` |
| `face_index` | INT | target face, left-to-right |
| `identity` | FLOAT | likeness dial, `0.5` = neutral no-op (default) |
| `source_image` | IMAGE (optional) | identity source photo — largest face wins |
| `face_model` | FACE_MODEL (optional) | ReActor saved face model; wins over `source_image` |

Returns one IMAGE: the full frame with the swapped face pasted back.
No face detected → passthrough with a console note.

**Supported swappers:** `inswapper_128.onnx` (128px, emap-projected embedding),
`hyperswap_1a/1b/1c_256.onnx` (256px, normed arcface embedding), and
`alphaface_256.onnx` (256px, **raw** arcface embedding — no projection and no
normalization). All three share FaceFusion's `arcface_128` warp template, which
is why adding one is a table entry rather than new geometry.

AlphaFace gets its own `models/alphaface/` directory instead of sharing
`models/hyperswap/`: ReActor lists that folder in its own `swap_model` dropdown
and resolves any name without "hyperswap" in it against `models/insightface/`,
so a file parked there would show up in ReActor and then fail to load. It is
therefore pixel-boost only, and the app forces this node when it is selected.

### The `identity` dial

FaceFusion's `face_swapper_weight`, exposed. It maps 0..1 onto a blend weight of
+0.35..-0.35 against the *target* face's normalized arcface embedding:

- `0.0` — pull toward the generated face: weakest likeness, easiest blend
- `0.5` — untouched (default; the latent is returned unchanged and the target's
  recognition pass is skipped entirely, so there is no cost) — and the point of
  **maximum** likeness
- `1.0` — overshoot away from the generated face: caricature

Above 0.5 the weight goes negative, so this extrapolates rather than
interpolating. It does **not** buy extra likeness — the source embedding is by
definition the arcface maximum, so any perturbation reduces similarity. Measured
live on alphaface: `0.0` → 0.711, `0.5` → 0.841, `1.0` → 0.827.

Unlike upstream FaceFusion, the blend happens in direction space with the
source's magnitude restored, so the dial has the same authority on every
swapper. Upstream mixes a unit-length target into whatever scale the source
latent has, which gives alphaface (raw arcface embedding, norm ~20) only 2.6%
authority against hyperswap's 35% — the slider visibly does nothing there.

**A/B verdict (2026-07-17, pinned-seed renders):** pixel boost + **Hyperswap
1C** beats the ReActor `1c + GPEN-1024` chain — same likeness, more natural
skin. Boost-size sweep with 1C: **512 and 768 are clean** (768 marginally
crisper); **1024 crackles** — as does inswapper at 512. Rule of thumb:
`boost / model_size ≥ 4` (stride-4 subsampling) produces reticulated skin
texture; keep the ratio at 2–3.

## Video (`RaccoonVideoFaceSwap`)

The image node swaps whichever face sits at `face_index`. Over a clip that
breaks down, so the video node works differently in three ways.

**Characters are matched by identity, not by index.** Each of the four slots
takes a `reference_N` image — the character *as the clip rendered them*, which
is why `RaccoonDetectFaces` exists to cut those crops out of a frame — plus a
`face_model_N` or `source_image_N` to put in their place. Every detected face in
every frame is scored against the references by arcface cosine and the best
pairing wins, each face and each reference used at most once. Position order
(left-to-right, or ReActor's largest-first) reorders itself the moment
characters move or cross, and the swap then jumps to the wrong person for a
stretch; identity does not.

The reference cannot be the replacement photo: the rendered face not looking
like the source is the entire problem being solved.

**Landmarks are smoothed across frames** (`smooth`, an EMA weight on the previous
frame). Re-fitting the alignment per frame makes the swapped face shimmer. A
jump guard drops the history when the face moves more than half a face-width, so
a cut or a fast pan does not drag the crop along behind it.

**Occlusion**, when `occlusion` names an installed segmenter rather than `off`.
`models/facefusion/xseg_1.onnx` (67 MiB, FaceFusion's) runs on the 256px aligned
crop — not the frame — so it costs ~2 ms/frame, and its mask multiplies into the
feathered box mask. Whatever it marks as covered keeps the original pixels.
The input is a combo of what is installed, so `/object_info` doubles as the
"is it downloaded?" probe.

Two things it does not do. A **true profile** is reported, not swapped: with 3 of
5 landmarks visible the alignment degrades and a swap looks wrong even when
detection succeeds, so the node returns a per-character coverage line through
`ui.text` (`243 frames · slot 1: 231/243`) rather than pretending. And a swapped
face stays sharp in a **motion-blurred** shot.

Prefer a 256px swapper here. Pixel boost costs `(boost / model_size)²` passes per
face per frame, so `alphaface_256` at 512 is 4 against `inswapper_128`'s 16 —
and alphaface is the off-angle-robust one, which is most of a clip.

## Requirements

- Model files (all on `huggingface.co/datasets/Gourieff/ReActor`):
  - `models/insightface/inswapper_128.onnx` and/or `models/hyperswap/hyperswap_1{a,b,c}_256.onnx`
  - `models/alphaface/alphaface_256.onnx` — from FaceFusion's own asset release
    (`facefusion/facefusion-assets`, `models-3.9.0`), not the ReActor dataset
  - `models/insightface/models/buffalo_l/` (det_10g.onnx + w600k_r50.onnx used here)
  - `models/facefusion/xseg_1.onnx` — optional, video occlusion only
    (`facefusion/facefusion-assets`, `models-3.1.0`)
- Python deps: numpy, opencv and torch come with ComfyUI; **onnx and onnxruntime
  are declared in `requirements.txt`** and must be, as of 2026-08-01 — the pack
  previously relied on ReActor's own install pulling them into the shared venv,
  and died on import the one time ReActor's clone failed.
- **No dependency on the ReActor package.** `analyzer.py` drives buffalo_l's
  SCRFD detector + arcface recognizer directly, because ReActor 0.7+ vendors
  its own insightface fork and importing its internals would break on ReActor
  updates. The optional `FACE_MODEL` input duck-types ReActor's face objects
  without importing anything.

## Install

Copy this folder into `ComfyUI/custom_nodes/` and restart ComfyUI. (Raccoon
Studio's installers do this via `Copy-VendorPack 'RaccoonSwapNodes'`.)

## Tests

Assert-based, no pytest. From this folder, with any Python that has the deps
(e.g. ComfyUI's venv):

```bash
python tests/test_swap_math.py   # pure math: implode/explode, affine, mask, matching, EMA
python tests/test_swapper.py     # onnx runner + embedding prep (skips w/o models)
python tests/test_analyzer.py    # SCRFD + arcface on a real image (skips w/o models)
python tests/test_node.py        # image node error contracts (stubbed, no models)
python tests/test_video_node.py  # matching, slot pairing, path sanitiser (stubbed)
```

See `DEVELOPMENT.md` for the dev workflow inside Raccoon Studio.
