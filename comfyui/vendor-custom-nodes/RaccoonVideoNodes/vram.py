"""VRAM flush before handing the GPU to llama — same idea as the big node, kept tiny."""


def flush_vram(tag="PromptLab"):
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