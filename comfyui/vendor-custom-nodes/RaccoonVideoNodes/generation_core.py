"""
Generation core — one streaming path, backend-agnostic (managed llama.cpp,
LM Studio, Ollama). No external-refine loop, no clause grafting. Generate, clean,
anchor. That's it.
"""

import asyncio
import json
import os
import random
import time

try:
    from . import brain_ld as brain
    from . import llama_manager as llm
    from .inject_ld import env_block, scenario_block as scn_block, scenario_forces_explicit
    from .camera_ld import bolt as camera_bolt
    from .music_ld import music_block
    from .llm_boot import ThinkFilter, boot_llama
    from .vram import flush_vram
except ImportError:
    import brain_ld as brain
    import llama_manager as llm
    from inject_ld import env_block, scenario_block as scn_block, scenario_forces_explicit
    from camera_ld import bolt as camera_bolt
    from music_ld import music_block
    from llm_boot import ThinkFilter, boot_llama
    from vram import flush_vram


_EXPLICIT_WORDS = (
    "fuck", "cock", "dick", "pussy", "cunt", "cum", "suck", "blowjob", "handjob",
    "tit", "boob", "ass", "anal", "penetrat", "thrust", "ride", "orgasm", "nipple",
    "nude", "naked", "nsfw", "sex", "erotic", "slut", "whore", "breed", "daddy",
)


def _infer_explicit(text):
    t = (text or "").lower()
    return any(w in t for w in _EXPLICIT_WORDS)


def _skip_flush(body):
    return bool(body.get("skip_flush")) or os.environ.get("RVN_TEST") == "1"


async def generate_prompt(body: dict, *, on_event=None) -> dict:
    t0 = time.time()

    async def emit(ev):
        if on_event:
            await on_event(ev)

    model_file = body.get("model_file", "None")
    mmproj_file = body.get("mmproj_file", "None (text-only)")
    mode = body.get("video_mode", "i2v")
    duration_s = float(body.get("duration_s", 12))
    intent = (body.get("user_intent") or "").strip()
    image_b64 = body.get("image_b64", "")
    pov = bool(body.get("pov", False))
    pov_gender = body.get("pov_gender", "female")
    explicit = _infer_explicit(intent) or scenario_forces_explicit(body.get("scenario",""))
    environment = body.get("environment", "None — LLM decides")
    scenario = body.get("scenario", "None — your words decide")
    dialogue_tier = body.get("dialogue_tier", "standard")
    energy = int(body.get("intensity", 5) or 5)
    talkative = (dialogue_tier or "").lower() in ("talkative","chatty","dense","rich")
    refine = bool(body.get("refine")) and bool((body.get("prior_prompt") or "").strip())
    prior = body.get("prior_prompt", "")
    temperature = float(body.get("temperature", 0.6))
    skip_flush = _skip_flush(body)

    if mode == "i2v" and not image_b64:
        return {"error": "I2V needs an image", "elapsed_s": 0}
    if model_file == "None" and llm.is_managed():
        return {"error": "No model selected", "elapsed_s": 0}

    need_vision = mode == "i2v" and bool(image_b64)
    if need_vision and mmproj_file == "None (text-only)" and llm.is_managed():
        return {"error": "I2V needs an mmproj (vision) file", "elapsed_s": 0}

    status_log = []
    try:
        if not skip_flush:
            await emit({"type": "status", "msg": "Flushing VRAM…"})
            flush_vram("RaccoonVideoPrompt")
            await asyncio.sleep(0.15)

        async for st in boot_llama(model_file, mmproj_file, need_vision):
            if st.startswith("error:"):
                await emit({"type": "error", "msg": st[6:]})
                return {"error": st[6:], "status": status_log, "elapsed_s": time.time() - t0}
            status_log.append(st)
            await emit({"type": "status", "msg": st})

        tl = brain.timeline(duration_s)
        await emit({"type": "timeline", "beats": tl})

        system = brain.build_system(
            mode=mode, duration_s=duration_s, pov=pov, pov_gender=pov_gender,
            explicit=explicit, dialogue_tier=dialogue_tier, energy=energy, intent=intent,
            environment_block=env_block(environment, mode),
            scenario_block=scn_block(scenario),
            camera_block=camera_bolt(body.get("camera_move","None"), pov=pov),
            music_block=music_block(body.get("music", "")),
            seed=random.randrange(1 << 30),
        )
        messages = brain.build_messages(
            system, intent, duration_s, mode,
            image_b64=image_b64, has_vision=need_vision,
            prior=prior, refine=refine,
        )

        await emit({"type": "status", "msg": "Writing script…"})
        import aiohttp
        max_tokens = brain.max_tokens(duration_s, mode, pov, talkative)
        seed_val = random.randint(0, 2**31 - 1)

        tfilter = ThinkFilter()
        acc = []
        last_err = None

        async def take(text):
            if text:
                cc = tfilter.feed(text)
                if cc:
                    acc.append(cc)
                    await emit({"type": "delta", "text": cc})

        async with aiohttp.ClientSession() as sess:
            if llm.conn_backend() == "Ollama":
                # Ollama's native endpoint is the only one where think:false
                # reliably disables qwen-style reasoning — through the OpenAI
                # shim, thinking models can burn the whole token budget on
                # reasoning and return zero content. First attempt disables
                # thinking; retry plain on 400 (model without thinking support).
                url = llm.conn_url().rstrip("/") + "/api/chat"
                # Native API wants content as a plain string with images in a
                # separate base64 list — OpenAI-style content arrays 400
                # ("cannot unmarshal array into ... content of type string").
                ollama_msgs = []
                for m in messages:
                    c = m["content"]
                    if isinstance(c, list):
                        m = {
                            "role": m["role"],
                            "content": "".join(p.get("text", "") for p in c
                                               if p.get("type") == "text"),
                            "images": [p["image_url"]["url"].split(",", 1)[-1]
                                       for p in c if p.get("type") == "image_url"],
                        }
                    ollama_msgs.append(m)
                payload = {
                    "model": llm.conn_model(), "messages": ollama_msgs, "stream": True,
                    "options": {"temperature": temperature, "seed": seed_val,
                                "num_predict": max_tokens},
                }
                for attempt, extra in enumerate(({"think": False}, {})):
                    async with sess.post(url, json={**payload, **extra}) as resp:
                        if resp.status != 200:
                            txt = await resp.text()
                            last_err = f"LLM HTTP {resp.status}: {txt[:300]}"
                            if attempt == 0 and resp.status == 400:
                                continue
                            await emit({"type": "error", "msg": last_err})
                            return {"error": last_err, "status": status_log, "elapsed_s": time.time() - t0}
                        async for raw in resp.content:
                            try:
                                chunk = json.loads(raw.decode("utf-8", errors="ignore"))
                            except Exception:
                                continue
                            await take((chunk.get("message") or {}).get("content", ""))
                            if chunk.get("done"):
                                break
                        break
            else:
                payload = {
                    "model": llm.conn_model(),
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": True,
                    "seed": seed_val,
                }
                if not llm.is_managed():
                    payload["ttl"] = 30
                url = llm.conn_url().rstrip("/") + "/v1/chat/completions"
                # first attempt disables thinking; retry plain on 400
                for attempt, extra in enumerate(({"chat_template_kwargs": {"enable_thinking": False}}, {})):
                    async with sess.post(url, json={**payload, **extra}) as resp:
                        if resp.status != 200:
                            txt = await resp.text()
                            last_err = f"LLM HTTP {resp.status}: {txt[:300]}"
                            if attempt == 0 and resp.status == 400:
                                continue
                            await emit({"type": "error", "msg": last_err})
                            return {"error": last_err, "status": status_log, "elapsed_s": time.time() - t0}
                        async for raw in resp.content:
                            line = raw.decode("utf-8", errors="ignore").strip()
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                            except Exception:
                                continue
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            await take(delta.get("content", "") or delta.get("reasoning_content", ""))
                        break
            tail = tfilter.flush()
            if tail:
                acc.append(tail)
                await emit({"type": "delta", "text": tail})

        full = brain.finalize("".join(acc), mode=mode, intent=intent)
        if not full:
            await emit({"type": "error", "msg": "Empty response"})
            return {"error": "Empty response", "status": status_log, "elapsed_s": time.time() - t0}

        # Carry the finalized text (i2v anchor, fence/think stripping) — the
        # client otherwise only has the raw deltas, which finalize() may differ from.
        await emit({"type": "done", "prompt": full})
        return {"prompt": full, "timeline": tl, "status": status_log,
                "elapsed_s": round(time.time() - t0, 2)}
    finally:
        if not skip_flush:
            flush_vram("RaccoonVideoPrompt")


def assemble_preview(body: dict) -> dict:
    """Build the system + user messages without hitting the LLM (for the Preview pane)."""
    mode = body.get("video_mode", "i2v")
    duration_s = float(body.get("duration_s", 12))
    intent = (body.get("user_intent") or "").strip()
    pov = bool(body.get("pov", False))
    explicit = _infer_explicit(intent) or scenario_forces_explicit(body.get("scenario",""))
    system = brain.build_system(
        mode=mode, duration_s=duration_s, pov=pov,
        pov_gender=body.get("pov_gender", "female"),
        explicit=explicit, dialogue_tier=body.get("dialogue_tier", "standard"), intent=intent,
        energy=int(body.get("intensity", 5) or 5),
        environment_block=env_block(body.get("environment", "None — LLM decides"), mode),
        scenario_block=scn_block(body.get("scenario", "None — your words decide")),
        camera_block=camera_bolt(body.get("camera_move","None"), pov=bool(body.get("pov", False))),
        music_block=music_block(body.get("music", "")),
    )
    user_text = brain.build_user(intent, duration_s, mode)
    return {
        "ok": True, "system": system, "user_text": user_text,
        "timeline": brain.timeline(duration_s),
        "system_chars": len(system), "user_chars": len(user_text),
        "max_tokens": brain.max_tokens(duration_s, mode, pov,
                                    (body.get("dialogue_tier","").lower() in ("talkative","chatty","dense","rich"))),
        "explicit": explicit,
    }
