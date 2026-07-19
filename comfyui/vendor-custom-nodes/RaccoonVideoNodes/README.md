# RaccoonVideoNodes

Raccoon Studio's LTX 2.3 video prompt + LoRA node pack for ComfyUI, plus the
`/rvn/*` HTTP routes the studio's video UI talks to.

MIT-licensed fork (upstream © 2026 Brojakhoeman, see `LICENSE`), heavily
adapted for Raccoon Studio's v2 video pipeline.

## Nodes (category `RaccoonStudio/Video`)

| Node | Purpose |
|---|---|
| `RaccoonVideoPrompt` | builds the structured LTX 2.3 video prompt from the studio's preset knobs (scenario/camera/dialogue/energy/POV layers) |
| `RaccoonVideoPromptUnpack` | splits the packed prompt into the pieces the graph consumes |
| `RaccoonLoraStack` | LoRA stack loader used for the DMD distillation row + style LoRAs |

## HTTP routes (`/rvn/*`, registered on the ComfyUI server)

`generate_stream` (SSE prompt enhancement via the local LLM backend),
`assemble_preview` (GET/POST), `options`, `kill`, `set_backend`,
`scan_models`, `preview_b64`, `lora_keycounts`, `lora_list`,
`get_scenario`, `save_scenario`.

The prompt-enhancement backend runs against a local LLM (Ollama or a GGUF via
the bundled llama manager — see `llama_manager.py` / `llm_boot.py`;
`set_backend` switches, `kill` evicts to free VRAM before renders).

## Layer files

The `*_ld.py` modules (`brain`, `camera`, `dialogue`, `environments`,
`inject`, `music`, `pack`, `scenarios`) each own one slice of the prompt
assembly; `generation_core.py` orchestrates them; `negatives.py` holds the
negative-prompt sets; `tensors.py`/`vram.py` are small helpers.

## Install

Copy this folder into `ComfyUI/custom_nodes/` and restart ComfyUI. (Raccoon
Studio's installers do this via `Copy-VendorPack 'RaccoonVideoNodes'`.)
Python deps come with ComfyUI; the LLM backend needs Ollama or a local GGUF.

See `DEVELOPMENT.md` for the dev workflow inside Raccoon Studio.
