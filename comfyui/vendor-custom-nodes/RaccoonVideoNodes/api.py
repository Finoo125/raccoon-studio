"""
SSE generation API for Raccoon Video Prompt.
"""

import asyncio
import json
import os

from . import llama_manager as llm
from .camera_ld import KEYS as CAM_KEYS
from .environments_ld import ENV_KEYS
from .generation_core import generate_prompt
from .generation_core import assemble_preview
from .music_ld import MUSIC_KEYS
from .scenarios_ld import SCENARIO_KEYS
from .tensors import (
    IMAGE_EXTS,
    VIDEO_EXTS,
    image_dimensions,
    is_image_filename,
    open_rgb,
    pil_jpeg_bytes,
    pil_preview_b64,
    resize_pil,
)
from .vram import flush_vram

_INPUT_FOLDER_OVERRIDE = None


def _default_input_dir():
    try:
        import folder_paths
        return folder_paths.get_input_directory()
    except Exception:
        return os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "input",
        )


def _input_dir():
    global _INPUT_FOLDER_OVERRIDE
    if _INPUT_FOLDER_OVERRIDE and os.path.isdir(_INPUT_FOLDER_OVERRIDE):
        return _INPUT_FOLDER_OVERRIDE
    return _default_input_dir()


def resolve_input_image(rel_name):
    """Safe path join under the configured input folder; images only."""
    if not rel_name or not is_image_filename(rel_name):
        return None
    base = os.path.normpath(_input_dir())
    full = os.path.normpath(os.path.join(base, rel_name.replace("/", os.sep)))
    if not full.startswith(base + os.sep) and full != base:
        return None
    if not os.path.isfile(full):
        return None
    return full


def _scan_gguf(path):
    gguf, mmproj = ["None"], ["None (text-only)"]
    if os.path.isdir(path):
        for f in sorted(os.listdir(path)):
            fl = f.lower()
            if fl.endswith(".gguf"):
                if "mmproj" in fl or "clip" in fl:
                    mmproj.append(f)
                else:
                    gguf.append(f)
    return gguf, mmproj


def _models_dir():
    return llm.conn_models_dir()


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
        inst = getattr(PromptServer, "instance", None)
        if inst is None:
            return
    except Exception as e:
        print(f"[RaccoonVideo] API routes skipped: {e}")
        return

    @inst.routes.post("/rvn/generate_stream")
    async def generate_stream(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

        video_mode = body.get("video_mode", "i2v")
        image_b64 = body.get("image_b64", "")
        model_file = body.get("model_file", "None")
        mmproj_file = body.get("mmproj_file", "None (text-only)")

        if video_mode == "i2v" and not image_b64:
            return web.json_response({"error": "I2V needs an image"}, status=400)
        if model_file == "None" and llm.is_managed():
            return web.json_response({"error": "No model selected"}, status=400)

        need_vision = video_mode == "i2v" and bool(image_b64)
        if need_vision and mmproj_file == "None (text-only)" and llm.is_managed():
            return web.json_response({"error": "I2V needs mmproj for vision"}, status=400)

        skip_flush = bool(body.get("skip_flush")) or os.environ.get("RVN_TEST") == "1"
        body = dict(body)
        body["skip_flush"] = skip_flush

        resp = web.StreamResponse(
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            }
        )
        await resp.prepare(request)

        async def send(obj):
            await resp.write(f"data: {json.dumps(obj)}\n\n".encode("utf-8"))

        try:
            await generate_prompt(body, on_event=send)
        except (asyncio.CancelledError, ConnectionResetError):
            print("[RaccoonVideo] stream aborted")
        except Exception as e:
            try:
                await send({"type": "error", "msg": str(e)})
            except Exception:
                pass
        finally:
            # Same as the previous pack: free VRAM after every generate (success, error, abort).
            try:
                print(f"[RaccoonVideo] free: {llm.free()}")
            except Exception:
                pass
            if not skip_flush:
                flush_vram("RaccoonVideoPrompt")
            try:
                await resp.write_eof()
            except Exception:
                pass
        return resp

    @inst.routes.post("/rvn/assemble_preview")
    async def assemble_preview_route(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        try:
            result = assemble_preview(body)
            return web.json_response(result)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @inst.routes.get("/rvn/assemble_preview")
    async def assemble_preview_get(request):
        return web.json_response({
            "ok": True,
            "hint": "POST JSON with same fields as /rvn/generate_stream (image_b64 optional for text preview).",
        })

    @inst.routes.get("/rvn/options")
    async def preset_options(request):
        """Preset key lists for the studio frontend's dropdowns (index 0 = default)."""
        return web.json_response({
            "environments": list(ENV_KEYS),
            "scenarios": list(SCENARIO_KEYS),
            "cameras": list(CAM_KEYS),
            "music": list(MUSIC_KEYS),
        })

    @inst.routes.post("/rvn/kill")
    async def kill_llm(request):
        llm.free()
        flush_vram("RaccoonVideoPrompt")
        return web.json_response({"ok": True})

    @inst.routes.post("/rvn/set_backend")
    async def set_backend(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "bad json"}, status=400)
        res = llm.set_conn(
            backend=body.get("backend"),
            server_url=body.get("server_url"),
            remote_model=body.get("remote_model"),
            models_dir=body.get("models_dir"),
            llama_exe=body.get("llama_exe"),
        )
        return web.json_response({"ok": True, **res})

    @inst.routes.post("/rvn/scan_models")
    async def scan_models(request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        path = (body.get("models_dir") or "").strip() or llm.conn_models_dir()
        if not os.path.isdir(path):
            return web.json_response({"ok": False, "error": f"Not a directory: {path}"})
        gguf, mmproj = _scan_gguf(path)
        llm.set_conn(models_dir=path)
        return web.json_response({
            "ok": True, "models_dir": path, "gguf": gguf, "mmproj": mmproj,
        })

    @inst.routes.get("/rvn/health")
    async def health_probe(request):
        url = llm.conn_url()
        backend = llm.conn_backend()
        ok = llm.is_healthy(url, backend)
        models = llm.fetch_remote_models(url, backend) if not llm.is_managed() else []
        hint = None
        if ok and not llm.is_managed() and not models:
            hint = "Server up — load a model in LM Studio (+ Load Model), then Generate."
        elif ok and not llm.is_managed() and models:
            hint = f"In memory: {', '.join(models)}"
        return web.json_response({
            "ok": ok,
            "backend": backend,
            "server_url": url,
            "model": llm.conn_model(),
            "models": models,
            "hint": hint,
        })

    @inst.routes.post("/rvn/set_input_folder")
    async def set_input_folder(request):
        global _INPUT_FOLDER_OVERRIDE
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "bad json"}, status=400)
        path = (body.get("path") or "").strip()
        if not path:
            _INPUT_FOLDER_OVERRIDE = None
            return web.json_response({"ok": True, "path": _default_input_dir(), "default": True})
        if not os.path.isdir(path):
            return web.json_response({"ok": False, "error": f"Not a directory: {path}"})
        _INPUT_FOLDER_OVERRIDE = path
        return web.json_response({"ok": True, "path": path})

    @inst.routes.post("/rvn/upload_image")
    async def upload_image(request):
        """Save a browser-picked image into the current input folder so it
        resolves like any other folder image at queue time."""
        import base64
        try:
            body = await request.json()
            name = os.path.basename((body.get("name") or "upload.png").strip()) or "upload.png"
            data = (body.get("b64") or "").strip()
            if "," in data:
                data = data.split(",", 1)[1]
            if not data:
                return web.json_response({"ok": False, "error": "no image data"}, status=400)
            if not is_image_filename(name):
                name += ".png"
            raw = base64.b64decode(data)
            base = _input_dir()
            os.makedirs(base, exist_ok=True)
            stem, ext = os.path.splitext(name)
            path = os.path.join(base, name)
            i = 1
            while os.path.exists(path):
                path = os.path.join(base, f"{stem}_{i}{ext}")
                i += 1
            with open(path, "wb") as f:
                f.write(raw)
            return web.json_response({"ok": True, "name": os.path.basename(path)})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @inst.routes.get("/rvn/list_images")
    async def list_images(request):
        input_dir = _input_dir()
        limit = min(80, max(1, int(request.rel_url.query.get("limit", "48"))))
        found = []
        if os.path.isdir(input_dir):
            for root, _dirs, files in os.walk(input_dir):
                for name in files:
                    ext = os.path.splitext(name)[1].lower()
                    if ext in VIDEO_EXTS or ext not in IMAGE_EXTS:
                        continue
                    full = os.path.join(root, name)
                    rel = os.path.relpath(full, input_dir).replace("\\", "/")
                    try:
                        mtime = os.path.getmtime(full)
                    except OSError:
                        mtime = 0
                    found.append({"name": rel, "mtime": mtime})
        found.sort(key=lambda x: -x["mtime"])
        return web.json_response({
            "ok": True,
            "input_dir": input_dir,
            "images": [x["name"] for x in found[:limit]],
        })

    @inst.routes.get("/rvn/image_info")
    async def image_info(request):
        name = (request.rel_url.query.get("name") or "").strip()
        full = resolve_input_image(name)
        if not full:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        dims = image_dimensions(full)
        if not dims:
            return web.json_response({"ok": False, "error": "not an image"}, status=400)
        w, h = dims
        return web.json_response({"ok": True, "name": name, "w": w, "h": h})

    @inst.routes.get("/rvn/thumb")
    async def thumb(request):
        name = (request.rel_url.query.get("name") or "").strip()
        full = resolve_input_image(name)
        if not full:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        try:
            max_side = min(640, max(48, int(request.rel_url.query.get("max", "320"))))
        except ValueError:
            max_side = 320
        pil = open_rgb(full)
        if pil is None:
            return web.json_response({"ok": False, "error": "decode failed"}, status=400)
        data = pil_jpeg_bytes(resize_pil(pil, max_side))
        return web.Response(body=data, content_type="image/jpeg", headers={"Cache-Control": "public, max-age=300"})

    @inst.routes.get("/rvn/preview_b64")
    async def preview_b64(request):
        name = (request.rel_url.query.get("name") or "").strip()
        full = resolve_input_image(name)
        if not full:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        try:
            max_side = min(1536, max(256, int(request.rel_url.query.get("max", "1024"))))
        except ValueError:
            max_side = 1024
        pil = open_rgb(full)
        if pil is None:
            return web.json_response({"ok": False, "error": "decode failed"}, status=400)
        dims = pil.size
        return web.json_response({
            "ok": True,
            "name": name,
            "w": int(dims[0]),
            "h": int(dims[1]),
            "b64": pil_preview_b64(pil, max_side=max_side),
        })

    # ── LoraForge key counts (for video/audio split info) ───────────────────────
    def _is_audio_key(k):
        return "audio" in k.lower()

    @inst.routes.get("/rvn/lora_keycounts")
    async def lora_keycounts(request):
        try:
            import folder_paths
            import comfy.utils
            lora_name = request.rel_url.query.get("lora", "")
            if not lora_name:
                return web.json_response({"v": 0, "a": 0})
            lora_path = folder_paths.get_full_path("loras", lora_name)
            if not lora_path or not os.path.isfile(lora_path):
                return web.json_response({"v": 0, "a": 0})
            try:
                import safetensors
                with safetensors.safe_open(lora_path, framework="pt", device="cpu") as f:
                    keys = list(f.keys())
            except Exception:
                try:
                    weights = comfy.utils.load_torch_file(lora_path, safe_load=True)
                    keys = list(weights.keys())
                except Exception:
                    return web.json_response({"v": -1, "a": -1})
            v = sum(1 for k in keys if not _is_audio_key(k))
            a = sum(1 for k in keys if _is_audio_key(k))
            return web.json_response({"v": v, "a": a})
        except Exception as e:
            return web.json_response({"v": -1, "a": -1, "error": str(e)})

    @inst.routes.get("/rvn/lora_list")
    async def lora_list(request):
        try:
            import folder_paths
            loras = folder_paths.get_filename_list("loras")
            return web.json_response({"loras": ["None"] + list(loras)})
        except Exception as e:
            return web.json_response({"loras": ["None"], "error": str(e)})

    # ── Live scenario editing (edit button next to dropdown) ─────────────────────
    from . import scenarios_ld

    @inst.routes.get("/rvn/get_scenario")
    async def get_scenario(request):
        key = request.rel_url.query.get("key", "")
        data = scenarios_ld.get_scenario_data(key)
        if not data:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        return web.json_response({"ok": True, **data})

    @inst.routes.post("/rvn/save_scenario")
    async def save_scenario(request):
        try:
            body = await request.json()
            key = body.get("key", "")
            setup = body.get("setup", "")
            choreography = body.get("choreography", "")
            if not key:
                return web.json_response({"ok": False, "error": "missing key"}, status=400)

            success = scenarios_ld.update_scenario_in_source(key, setup, choreography)
            return web.json_response({"ok": bool(success)})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    print(
        "[RaccoonVideo] routes: /rvn/generate_stream, /rvn/assemble_preview, /rvn/options, /rvn/kill, "
        "/rvn/set_backend, /rvn/scan_models, /rvn/health, /rvn/list_images, "
        "/rvn/set_input_folder, /rvn/image_info, /rvn/thumb, /rvn/preview_b64, "
        "/rvn/lora_keycounts, /rvn/lora_list, /rvn/get_scenario, /rvn/save_scenario"
    )