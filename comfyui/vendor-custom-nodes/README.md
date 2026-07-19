# Vendored ComfyUI custom nodes

Custom-node packs that have **no public source** and so are shipped in this repo.
The installers (`install-linux.sh`, `install-windows.ps1`) copy each one into
`comfyui/ComfyUI/custom_nodes/` during setup.

| Pack | Provides | Why vendored |
|---|---|---|
| `RaccoonVideoNodes` | `RaccoonVideoPrompt` / `RaccoonVideoPromptUnpack` / `RaccoonLoraStack` nodes + the `/rvn/*` routes (SSE prompt generation, backend switch, preset options) used by LTX 2.3 video generation | In-house fork (MIT upstream; LICENSE kept in the pack folder). |

Every other pack the LTX 2.3 workflow needs is cloned from a public repo by the
installers (kjnodes, videohelpersuite, easy-use, ComfyMath, ComfyLiterals,
RES4LYF, controlaltai-nodes, 10S_Nodes, and the public NVIDIA RTX nodes).

> `koolook` is **not** included: nothing in `app/workflows/LTX23.json` references
> it — the loaders it appears to provide are core ComfyUI nodes.
