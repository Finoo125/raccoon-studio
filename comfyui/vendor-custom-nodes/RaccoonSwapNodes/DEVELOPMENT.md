# Development notes

Context for future work sessions (human or agent).

## Where this code lives

**Canonical copy:** `comfyui/vendor-custom-nodes/RaccoonSwapNodes/` in the
private `raccoon-studio` repo — that is where development happens. This
standalone repo is published from it via `git subtree` for visibility/reuse.

Sync from raccoon-studio (run at raccoon-studio root):

```bash
git subtree push --prefix=comfyui/vendor-custom-nodes/RaccoonSwapNodes swap-nodes main
```

(`swap-nodes` = remote pointing at this repo.) Pull back external changes:

```bash
git subtree pull --prefix=comfyui/vendor-custom-nodes/RaccoonSwapNodes swap-nodes main --squash
```

## Deploy loop (the trap that costs 15 minutes if forgotten)

ComfyUI runs the copy at `comfyui/ComfyUI/custom_nodes/RaccoonSwapNodes/`,
**not** the vendored one. After editing:

1. `cp -r comfyui/vendor-custom-nodes/RaccoonSwapNodes comfyui/ComfyUI/custom_nodes/`
2. Restart ComfyUI — the Manager "reboot" endpoint is a **no-op** in this
   setup: kill the PID owning port 8188, then run `start-comfyui.bat`
   (detached, output to logfile — a broken stdout pipe crashes every job).
3. `curl -s http://127.0.0.1:8188/object_info/RaccoonPixelBoostSwap` — empty
   `{}` means the import failed silently; read the startup log
   (`comfyui/ComfyUI/user/comfyui_8188.log`).
4. ComfyUI's execution cache is keyed on node *inputs*, not code or file
   contents — after a model-file or code change, identical re-queues return
   stale results. Bust with `POST /free {"unload_models":true,"free_memory":true}`.

## File map

| File | Responsibility |
|---|---|
| `swap_math.py` | pure numpy: arcface_128 template, similarity affine, pixel-unshuffle implode/explode, feathered box mask |
| `swapper.py` | cached onnxruntime sessions, per-model config, source-embedding prep (inswapper emap / hyperswap normed), the tile swap loop |
| `analyzer.py` | self-contained buffalo_l runner: SCRFD det_10g decode (strides 8/16/32, 2 anchors/cell, NMS) + w600k_r50 arcface embedding |
| `node.py` | the ComfyUI node: tensor⇄BGR conversion, source/target resolution, align → swap → paste-back |
| `tests/` | one assert-based file per module; model-dependent checks skip when files are absent |

Imports are package-relative with a plain-import fallback so `tests/` can run
the modules directly.

## App integration (raccoon-studio side)

- `app/src/lib/workflows/face-swap.ts` — `FaceSwapRefs.pixelBoost` builds
  `swap:swap` (this node) → `swap:restore` (`ReActorRestoreFace`, GPEN-1024 @
  0.25) → the shared YOLO+SAM mask / ColorMatch / RGB-flatten chain.
- UI toggle: `FaceSwapInput.tsx` ("Pixel boost"), param `faceSwapPixelBoost`.
- Live A/B harness: `app/live/swap-live.test.ts` (pinned seeds; label +
  overrides via `SWAP_LABEL` / `SWAP_OVERRIDES` env).

## Known ceilings / future work

- All boost sizes are exposed in the app UI (512 default). Sweep verdict:
  512/768 clean, 1024 crackles with 256px models — stride ≥4 subsampling is
  the failure mode (same reason inswapper+512 renders flat/gray). If a
  512-native swapper ever lands, 1024 becomes viable for it.
- Expression restore (LivePortrait re-applying the pre-swap expression) is
  the next realism lever if swapped faces read stiff — see the plan doc
  `docs/superpowers/plans/2026-07-17-pixel-boost-swap-node.md` in
  raccoon-studio for the full history and A/B evidence.
