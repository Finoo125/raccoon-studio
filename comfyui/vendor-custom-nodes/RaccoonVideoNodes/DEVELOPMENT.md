# Development notes

Context for future work sessions (human or agent).

## Where this code lives

**Canonical copy:** `comfyui/vendor-custom-nodes/RaccoonVideoNodes/` in the
private `raccoon-studio` repo — development happens there. This standalone
repo is published from it via `git subtree`.

Sync from raccoon-studio (run at raccoon-studio root):

```bash
git subtree push --prefix=comfyui/vendor-custom-nodes/RaccoonVideoNodes video-nodes main
```

(`video-nodes` = remote pointing at this repo.) Pull back external changes:

```bash
git subtree pull --prefix=comfyui/vendor-custom-nodes/RaccoonVideoNodes video-nodes main --squash
```

## Deploy loop

ComfyUI runs the copy at `comfyui/ComfyUI/custom_nodes/RaccoonVideoNodes/`,
**not** the vendored one. After editing:

1. `cp -r comfyui/vendor-custom-nodes/RaccoonVideoNodes comfyui/ComfyUI/custom_nodes/`
2. Restart ComfyUI — Manager "reboot" is a no-op here: kill the PID on port
   8188, run `start-comfyui.bat` (detached + logged; a broken stdout pipe
   crashes every job at KSampler).
3. Startup log (`comfyui/ComfyUI/user/comfyui_8188.log`) prints
   `[RaccoonVideo] loaded — [...]` and the registered `/rvn/*` routes; a
   missing banner means a silent import failure.

## App integration (raccoon-studio side)

- The studio's Generate Videos UI drives the `/rvn/*` routes (enhance, preset
  options, previews) and builds graphs that use all three nodes; the DMD
  distillation LoRA is hard-wired as row 0 of `RaccoonLoraStack`.
- History/design: `docs/superpowers/plans/2026-07-15-video-workflow-v2.md`
  and `docs/claude-context.md` (feature status) in raccoon-studio.
- Full-render e2e needs the v1.4 models from the studio's Models page
  (`app/src/lib/models/ltx23-assets.ts` is the asset catalog).

## Gotchas

- LLM eviction matters: call `/rvn/kill` (the app does) before starting a
  render or the LLM and the video model fight for VRAM.
- RIFE weights (`flownet.pkl`) auto-download on first use — not an asset
  catalog entry.
- Keep the `[RaccoonVideo] loaded` print — it's the cheap "did my code
  actually load" check the deploy loop relies on.
