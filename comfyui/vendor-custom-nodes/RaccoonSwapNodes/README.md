# RaccoonSwapNodes

Pixel-boost face swapping for ComfyUI — Raccoon Studio's vendored swap pack.

**One node: `RaccoonPixelBoostSwap`** ("Pixel Boost Face Swap 🦝", category
`RaccoonStudio`). It swaps a face at 512–1024px *effective* resolution using
FaceFusion's pixel-boost technique, so detail comes from the swap itself
instead of a face restorer hallucinating it back.

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
| `swap_model` | combo | onnx files found in `models/insightface` + `models/hyperswap` |
| `pixel_boost` | combo | `512x512` (default) / `768x768` / `1024x1024` |
| `face_index` | INT | target face, left-to-right |
| `source_image` | IMAGE (optional) | identity source photo — largest face wins |
| `face_model` | FACE_MODEL (optional) | ReActor saved face model; wins over `source_image` |

Returns one IMAGE: the full frame with the swapped face pasted back.
No face detected → passthrough with a console note.

**Supported swappers:** `inswapper_128.onnx` (128px, emap-projected embedding)
and `hyperswap_1a/1b/1c_256.onnx` (256px, normed arcface embedding).

**A/B verdict (2026-07-17, pinned-seed renders):** pixel boost + **Hyperswap
1C** beats the ReActor `1c + GPEN-1024` chain — same likeness, more natural
skin. Boost-size sweep with 1C: **512 and 768 are clean** (768 marginally
crisper); **1024 crackles** — as does inswapper at 512. Rule of thumb:
`boost / model_size ≥ 4` (stride-4 subsampling) produces reticulated skin
texture; keep the ratio at 2–3.

## Requirements

- Model files (all on `huggingface.co/datasets/Gourieff/ReActor`):
  - `models/insightface/inswapper_128.onnx` and/or `models/hyperswap/hyperswap_1{a,b,c}_256.onnx`
  - `models/insightface/models/buffalo_l/` (det_10g.onnx + w600k_r50.onnx used here)
- Python deps: numpy, opencv, onnx, onnxruntime, torch — all present in any
  ComfyUI env. **No requirements.txt on purpose** — nothing to install.
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
python tests/test_swap_math.py   # pure math: implode/explode, affine, mask
python tests/test_swapper.py     # onnx runner + embedding prep (skips w/o models)
python tests/test_analyzer.py    # SCRFD + arcface on a real image (skips w/o models)
```

See `DEVELOPMENT.md` for the dev workflow inside Raccoon Studio.
