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
    from . import brain as brain
    from . import h3_brain as h3_brain
    from . import llama_manager as llm
    from .inject import env_block, scenario_block as scn_block, scenario_forces_explicit
    from .camera import bolt as camera_bolt
    from .music import music_block
    from .llm_boot import ThinkFilter, boot_llama
    from .vram import flush_vram
except ImportError:
    import brain as brain
    import h3_brain as h3_brain
    import llama_manager as llm
    from inject import env_block, scenario_block as scn_block, scenario_forces_explicit
    from camera import bolt as camera_bolt
    from music import music_block
    from llm_boot import ThinkFilter, boot_llama
    from vram import flush_vram


# word_hit() covers regular inflections (+s/es/ed/d/ing/ion), so "thrust" reaches
# "thrusting" and "penetrat" reaches "penetration". Doubled-consonant and
# silent-e forms it cannot derive ("cum"->"cumming", "ride"->"riding") are
# listed outright — dropping them would trade the false-positive bug for a
# false-negative one.
_EXPLICIT_WORDS = (
    "fuck", "cock", "dick", "pussy", "cunt", "cum", "cumming", "suck", "blowjob",
    "handjob", "tit", "boob", "ass", "anal", "penetrat", "thrust", "ride", "riding",
    "orgasm", "nipple", "nude", "naked", "nsfw", "sex", "sexy", "erotic", "slut",
    "slutty", "whore", "breed", "daddy",
)


def _infer_explicit(text):
    # word_hit, not `w in t` — see brain.word_hit. Substring matching made
    # "petite"/"grass"/"assistant" read as explicit and injected the explicit
    # clause into briefs that never asked for one.
    return brain.word_hit(_EXPLICIT_WORDS, (text or "").lower())


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
    # One image, or a list of them: Director sends every shot's picture. Empties
    # are dropped here so the gates below can just ask whether the list is empty.
    image_b64 = body.get("image_b64") or ""
    images = [b for b in (image_b64 if isinstance(image_b64, (list, tuple)) else [image_b64]) if b]
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

    # Every frame-anchored task needs its frame(s): the doctrine's first line
    # names them, so writing blind produces a prompt that references a picture
    # that was never attached.
    if mode in ("i2v", "fl2v", "l2v") and not images:
        return {"error": "%s needs an image" % mode.upper(), "elapsed_s": 0}
    if model_file == "None" and llm.is_managed():
        return {"error": "No model selected", "elapsed_s": 0}

    # Director shots are optional, so an empty timeline simply writes blind.
    # ref2v stays out on purpose: H3's reference doctrine was tuned without a
    # vision pass, and turning one on here would silently change its prompts.
    # fl2v/l2v are in for the opposite reason — their doctrine describes the
    # attached frames by number ("Picture 1 is the opening frame, Picture 2 is
    # the closing frame"), so without the vision pass the model would be writing
    # about pictures it was never shown.
    need_vision = bool(images) and mode in ("i2v", "fl2v", "l2v", "director")
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

        doctrine = doctrine_for(body)
        system = doctrine.build_system(
            mode=mode, duration_s=duration_s, pov=pov, pov_gender=pov_gender,
            explicit=explicit, dialogue_tier=dialogue_tier, energy=energy, intent=intent,
            environment_block=env_block(environment, mode),
            scenario_block=scn_block(scenario),
            camera_block=camera_bolt(body.get("camera_move","None"), pov=pov),
            music_block=music_block(body.get("music", "")),
            seed=random.randrange(1 << 30),
            # {images, videos, audios} — lets the H3 ref2va doctrine name only
            # the reference types actually attached. Ignored by the LTX brain.
            ref_counts=body.get("ref_counts"),
        )
        messages = brain.build_messages(
            system, intent, duration_s, mode,
            image_b64=images, has_vision=need_vision,
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

        # duration_s is load-bearing for the H3 keyframe tasks: fl2v/l2v repair a
        # missing alignment line, and that line quotes the second the last frame
        # lands on. The LTX brain swallows it like every other extra kwarg.
        full = doctrine.finalize("".join(acc), mode=mode, intent=intent,
                                 ref_counts=body.get("ref_counts"),
                                 duration_s=duration_s)
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


def doctrine_for(body: dict):
    """Which prompt doctrine writes this clip.

    MiniMax H3 consumes named fields with a timed shot timeline; LTX 2.3
    consumes a shot script. The two output contracts cannot be reconciled in one
    canon, so the model picks the module. Anything that is not explicitly H3
    keeps the LTX brain — including an absent field, so an older client that
    never learned to send `video_model` behaves exactly as before.
    """
    return h3_brain if (body.get("video_model") or "").lower() == "minimax-h3" else brain


def assemble_preview(body: dict) -> dict:
    """Build the system + user messages without hitting the LLM (for the Preview pane)."""
    mode = body.get("video_mode", "i2v")
    duration_s = float(body.get("duration_s", 12))
    intent = (body.get("user_intent") or "").strip()
    pov = bool(body.get("pov", False))
    explicit = _infer_explicit(intent) or scenario_forces_explicit(body.get("scenario",""))
    system = doctrine_for(body).build_system(
        mode=mode, duration_s=duration_s, pov=pov,
        pov_gender=body.get("pov_gender", "female"),
        explicit=explicit, dialogue_tier=body.get("dialogue_tier", "standard"), intent=intent,
        energy=int(body.get("intensity", 5) or 5),
        environment_block=env_block(body.get("environment", "None — LLM decides"), mode),
        scenario_block=scn_block(body.get("scenario", "None — your words decide")),
        camera_block=camera_bolt(body.get("camera_move","None"), pov=bool(body.get("pov", False))),
        music_block=music_block(body.get("music", "")),
        ref_counts=body.get("ref_counts"),
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
