"""VRAM flush before handing the GPU to llama — same idea as the big node, kept tiny."""

import contextlib


def _prompt_queue():
    """ComfyUI's prompt queue, or None outside a running ComfyUI."""
    try:
        from server import PromptServer
        return PromptServer.instance.prompt_queue
    except Exception:
        return None


def flush_vram(tag="PromptLab"):
    """Unload ComfyUI's models and empty the CUDA cache — unless a prompt is executing.

    Callers run on the server thread whatever the prompt worker is doing:
    `/rvn/kill` before every render and the writer around every write. An
    unload under a running prompt killed a Krea2 render at FaceDetailer
    ("'NoneType' object is not callable", 2026-10-22). ComfyUI's own `/free`
    only sets a flag the worker acts on between prompts; this one is immediate,
    so it checks first. `PromptQueue.get()` puts a prompt in `currently_running`
    before it executes and `task_done()` takes it out after (execution.py), both
    under `mutex`; holding that mutex here means no prompt can start between
    the check and the flush. Busy, the cache calls are skipped too: the models
    stay loaded, and emptying the cache under a sampler only makes it allocate
    again (and `synchronize` would stall the server until the GPU drains).
    Returns whether it flushed.
    """
    q = _prompt_queue()
    with getattr(q, "mutex", None) or contextlib.nullcontext():
        if getattr(q, "currently_running", None):
            print(f"[{tag}] ComfyUI is running a prompt — its models stay loaded.")
            return False
        _flush(tag)
    return True


def _flush(tag):
    try:
        import comfy.model_management as mm
        mm.unload_all_models()
        mm.soft_empty_cache()
        print(f"[{tag}] ComfyUI models unloaded.")
    except Exception as e:
        print(f"[{tag}] model_management flush skipped: {e}")
    try:
        import gc
        gc.collect()
    except Exception:
        pass
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
            free, total = torch.cuda.mem_get_info()
            print(f"[{tag}] VRAM after flush — free: {free / 1024 ** 3:.1f} GB / {total / 1024 ** 3:.1f} GB")
    except Exception as e:
        print(f"[{tag}] CUDA flush skipped: {e}")


if __name__ == "__main__":
    # python vram.py — fails if the busy check stops guarding the unload.
    # Fakes only: no ComfyUI, and no CUDA context on a GPU that may be rendering.
    import sys
    import threading
    import types

    calls = []
    mm = types.ModuleType("comfy.model_management")
    mm.unload_all_models = lambda: calls.append("unload")
    mm.soft_empty_cache = lambda: None
    sys.modules["comfy"] = types.ModuleType("comfy")
    sys.modules["comfy"].model_management = mm
    sys.modules["comfy.model_management"] = mm
    sys.modules["torch"] = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))

    queue = types.SimpleNamespace(mutex=threading.RLock(), currently_running={0: ("number", "prompt-id")})
    _prompt_queue = lambda: queue
    assert flush_vram("check") is False and calls == [], calls      # busy: nothing unloaded
    queue.currently_running.clear()
    assert flush_vram("check") is True and calls == ["unload"], calls   # idle: flushed
    _prompt_queue = lambda: None
    assert flush_vram("check") is True and calls == ["unload"] * 2, calls   # outside ComfyUI: as before
    print("vram OK")
