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

## Checks

Three, and they answer different questions. None needs ComfyUI running.

```bash
python selftest.py          # prompt assembly, detectors, budgets, negatives
python h3_brain.py          # the H3 doctrine's own self-check
python h3_ab.py --self-check   # the A/B graders catch what they claim to
```

`h3_ab.py` is the one that grades a **live model**. It rebuilds the exact
request `generation_core.run_generate` sends — same temperature, `num_predict`,
message shape, `think: False`-then-retry — runs four briefs across three fixed
seeds, and scores the answers mechanically against the contract `h3_brain`
writes into the prompt. No model judges a model.

```bash
python h3_ab.py --models qwen3.5:27b,other:tag      # compare two writers
python h3_ab.py --arm ref2v-vision --image ref.jpg  # does ref2v want vision?
python h3_ab.py --dry --models a,b                  # build it all, send nothing
```

Read **both** tables. `shipped` is what H3 receives after `finalize()`; `raw` is
what the model produced unaided. They come apart, and the gap is the point —
two writers can ship identical quality while one needed twenty repairs. The
repaired one is the fragile one, because every repair is a guess that happens to
be safe against today's doctrine.

**A fixed seed does not make a run reproducible.** Ollama carries prefix/KV
cache between requests, so a brief's answer depends on which briefs ran before
it in the same model session. Measured: the `bedroom` description is **343
words run alone and 278 words after three other briefs**, same model, same
seed, reproducibly. Arms stay comparable because they are the outer loop and
all walk the identical brief order — but **never compare numbers across two
invocations with different `--briefs` sets**. The header prints the brief set
and seeds so two reports can be told apart.

Measured 2026-08-29 on the full 5-brief set × 3 seeds (see
[[h3-writer-model-choice]] in memory for the whole table): qwen3.8-heretic
92.5% shipped, qwen3.5:27b 90.5% — inside the noise this file can resolve at
n=15. Both refuse nothing (`no-refuse` 6/6 each, 24/24 calls across every model
ever tested, including stock safety-trained ones), so **do not pick a writer
for its refusal rate** — the doctrine does that work. The band worth acting on
is `words`: every model fails it, which makes it an `h3_brain` LENGTH-block
problem rather than a model-choice one.

## Gotchas

- LLM eviction matters: call `/rvn/kill` (the app does) before starting a
  render or the LLM and the video model fight for VRAM.
- RIFE weights (`flownet.pkl`) auto-download on first use — not an asset
  catalog entry.
- Keep the `[RaccoonVideo] loaded` print — it's the cheap "did my code
  actually load" check the deploy loop relies on.
