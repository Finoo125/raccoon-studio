# Vendored ComfyUI custom nodes

Custom-node packs shipped in this repo rather than cloned from a public repo.
The installers (`install-linux.sh`, `install-windows.ps1`) copy each one into
`comfyui/ComfyUI/custom_nodes/` during setup, and the app's Repair button
re-copies them when an install has drifted.

| Pack | Provides | Why vendored |
|---|---|---|
| `RaccoonVideoNodes` | `RaccoonVideoPrompt` / `RaccoonVideoPromptUnpack` / `RaccoonLoraStack` nodes + the `/rvn/*` routes (SSE prompt generation, backend switch, preset options) used by LTX 2.3 video generation | In-house fork (MIT upstream; `LICENSE` kept in the pack folder). |
| `RaccoonSwapNodes` | `RaccoonPixelBoostSwap` — the pixel-boost face swap path | In-house. |

## Nodes vendored out of upstream packs

`RaccoonVideoNodes` also carries four nodes lifted from packs we no longer
install. Each is registered under a `Raccoon`-prefixed id so nothing collides if
the upstream pack is ever installed alongside, and each keeps its upstream class
name so future diffs stay readable.

| Node | From | Rev | Why |
|---|---|---|---|
| `RaccoonTiledVAEDecode` | `Lightricks/ComfyUI-LTXVideo` | `aceeae96` | The pack's `__init__` imports `interleaved_freqs_cis`, which current ComfyUI no longer exports — and one bad import drops **all 78** of its nodes. This one was only collateral damage. |
| `RaccoonLatentUpsamplerTiled` | `TenStrip/10S-Comfy-nodes` | `c412da52` | Treated `LatentUpscaleModelLoader`'s output as a bare `nn.Module`; newer ComfyUI wraps it in a `CoreModelPatcher`, killing I2V at the upscale stage *after* every sampling step. Vendoring let us carry the unwrap — this is what freed ComfyUI core from its pin. |
| `RaccoonLTXReferenceConditioning` | `TenStrip/10S-Comfy-nodes` | `c412da52` | Same pack; vendored alongside the upsampler so the pack could be dropped entirely. |
| `RaccoonLTXReferenceEnable` | `TenStrip/10S-Comfy-nodes` | `c412da52` | ditto |

Licences: `LICENSE` covers the in-house fork, `LICENSE-10S_Nodes` the three
10S Nodes files. Both upstreams are MIT.

Every other pack the LTX 2.3 workflow needs is cloned from a public repo by the
installers, at the revision recorded in `installer/pinned-versions.txt`
(kjnodes, videohelpersuite, easy-use, ComfyMath, ComfyLiterals, RES4LYF,
controlaltai-nodes, and the public NVIDIA RTX nodes).

> `koolook` is **not** included: nothing in `app/workflows/LTX23.json` references
> it — the loaders it appears to provide are core ComfyUI nodes.
