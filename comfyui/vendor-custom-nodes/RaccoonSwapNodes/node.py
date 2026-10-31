"""RaccoonPixelBoostSwap: FaceFusion-grade pixel-boost face swap as a
standalone node. Drop-in for the ReActorFaceSwap position in the app's
swap chain: same tensor contract (IMAGE in, full swapped frame out), so
ReActorMaskHelper/ColorMatch downstream keep working. ReActor itself is
never imported or modified."""
import os
import re

import cv2
import numpy as np
import torch

import folder_paths

# Keyed on __package__ rather than `except ImportError`, which also swallowed a
# genuine missing dependency: `swapper` imports onnx, so an absent onnx made the
# relative import raise and the fallback then failed with "No module named
# 'analyzer'" — pointing every reader at the wrong file. `__package__` is falsy
# only when this really is being run outside the package (the tests do that).
if __package__:
    from . import analyzer, swap_math, swapper
else:  # direct execution outside the package
    import analyzer
    import swap_math
    import swapper

_ANALYSER = None  # ponytail: single cached analyzer; det params never change

# Swap-model search path. `alphaface` is its own directory rather than a
# guest in `hyperswap`: ReActor lists models/hyperswap in its OWN swap_model
# dropdown and resolves any name without "hyperswap" in it against
# models/insightface, so a file parked there would appear in ReActor and
# then fail to load with a path error.
_MODEL_DIRS = ('insightface', 'hyperswap', 'alphaface')


def _analyser():
    global _ANALYSER
    if _ANALYSER is None:
        buffalo = os.path.join(folder_paths.models_dir, 'insightface', 'models', 'buffalo_l')
        _ANALYSER = analyzer.Analyzer(buffalo)
    return _ANALYSER


def _swap_model_files():
    files = set()
    for sub in _MODEL_DIRS:
        d = os.path.join(folder_paths.models_dir, sub)
        if os.path.isdir(d):
            files.update(f for f in os.listdir(d) if f.endswith('.onnx'))
    return sorted(files) or ['inswapper_128.onnx']


def _resolve_model(filename):
    for sub in _MODEL_DIRS:
        p = os.path.join(folder_paths.models_dir, sub, filename)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f'swap model not found: {filename}')


def _to_bgr(image, idx=0):
    """ComfyUI IMAGE [B,H,W,C] float 0..1 RGB -> uint8 BGR (one frame)."""
    arr = (image[idx].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    return arr[:, :, ::-1].copy()


def _to_image(bgr_frames):
    rgb = np.stack(bgr_frames)[:, :, :, ::-1].astype(np.float32) / 255.0
    return torch.from_numpy(rgb.copy())


def _from_bgr(bgr):
    """One uint8 BGR frame -> ComfyUI IMAGE row (float 0..1 RGB).

    The single-frame counterpart of `_to_image`, for callers that fill a
    preallocated output tensor instead of accumulating a list — which is what
    keeps a 243-frame clip from holding both a uint8 list and a float32 stack.
    """
    rgb = np.ascontiguousarray(bgr[:, :, ::-1]).astype(np.float32) / 255.0
    return torch.from_numpy(rgb)


def _source_face(face_model, source_image, where):
    """The identity to swap IN: a saved ReActor face model wins over a photo.

    A face model is an average over several photos, so it carries less of any
    single shot's lighting and expression — the better input where one exists.
    """
    if face_model is not None:
        return face_model
    if source_image is None:
        raise ValueError(f'{where} needs source_image or face_model')
    faces = _analyser().get(_to_bgr(source_image))
    if not faces:
        # Fail loudly: a silent passthrough renders a "successful" image with the
        # wrong face and no hint the swap was skipped.
        raise ValueError(f'{where}: no face detected in the source image — '
                         'use a clearer / more frontal face photo')
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def _swap_face(frame, kps, session, cfg, boost, embedding, mask, occluder_path=None):
    """Align one face at boost resolution, pixel-boost swap it, paste it back.

    Returns the whole frame with that one face replaced, or None when the
    landmarks are too degenerate to fit an affine (the caller passes the frame
    through untouched). Compositing onto `frame` rather than the original is what
    lets a multi-face caller chain calls: each swap sees the previous one's work.
    """
    matrix = swap_math.estimate_affine(np.asarray(kps, dtype=np.float32), boost)
    if matrix is None:
        return None
    crop = cv2.warpAffine(frame, matrix, (boost, boost), borderMode=cv2.BORDER_REPLICATE)
    swapped = swapper.swap_crop(session, cfg['kind'], cfg['mean'], cfg['std'],
                                crop, cfg['size'], boost, embedding)
    if occluder_path:
        # Occlusion narrows the paste mask; it never widens it, so a bad
        # segmentation degrades toward "swapped less", not toward artefacts.
        mask = mask * swapper.occlusion_mask(occluder_path, crop, boost)

    inverse = cv2.invertAffineTransform(matrix)
    h, w = frame.shape[:2]
    warped = cv2.warpAffine(swapped, inverse, (w, h), borderMode=cv2.BORDER_REPLICATE)
    warped_mask = cv2.warpAffine(mask, inverse, (w, h))[:, :, np.newaxis]
    out = frame.astype(np.float32) * (1 - warped_mask) + warped.astype(np.float32) * warped_mask
    return out.clip(0, 255).astype(np.uint8)


class RaccoonPixelBoostSwap:
    CATEGORY = 'RaccoonStudio'
    FUNCTION = 'execute'
    RETURN_TYPES = ('IMAGE',)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'image': ('IMAGE',),
                'swap_model': (_swap_model_files(),),
                'pixel_boost': (['512x512', '768x768', '1024x1024'], {'default': '512x512'}),
                'face_index': ('INT', {'default': 0, 'min': 0, 'max': 15}),
                'identity': ('FLOAT', {'default': swapper.IDENTITY_NEUTRAL,
                                       'min': 0.0, 'max': 1.0, 'step': 0.05}),
            },
            'optional': {
                'source_image': ('IMAGE',),
                'face_model': ('FACE_MODEL',),
            },
        }

    def execute(self, image, swap_model, pixel_boost, face_index,
                identity=swapper.IDENTITY_NEUTRAL, source_image=None, face_model=None):
        cfg = swapper.model_config(swap_model)
        boost = int(pixel_boost.split('x')[0])
        model_path = _resolve_model(swap_model)

        # Source identity: a saved ReActor face model wins over a photo
        # (both are insightface Face objects / duck-typed equivalents).
        src_face = _source_face(face_model, source_image, 'RaccoonPixelBoostSwap')

        session = swapper.get_session(model_path)
        src_emb = swapper.source_embedding(model_path, cfg['kind'], src_face)
        mask = swap_math.box_mask(boost)
        # Recognition on the TARGET face costs an extra arcface pass per
        # frame and is only needed to balance the latent against it, so the
        # neutral default keeps the old detection-only fast path.
        need_target_emb = identity != swapper.IDENTITY_NEUTRAL

        # Swap every frame of the batch (image gens batch up to 4); frames
        # without a usable target face pass through unchanged, but if NO frame
        # got swapped the whole job errors instead of faking success.
        out_frames = []
        n_swapped = 0
        for i in range(image.shape[0]):
            frame = _to_bgr(image, i)
            # Target faces need only bbox/kps unless the identity dial is off
            # neutral, which also wants their arcface embedding to blend against.
            faces = sorted(_analyser().get(frame, with_embedding=need_target_emb),
                           key=lambda f: f.bbox[0])
            if not faces or face_index >= len(faces):
                print(f'[RaccoonSwapNodes] no target face in frame {i} — passthrough')
                out_frames.append(frame)
                continue
            target = faces[face_index]
            emb = swapper.balance_embedding(src_emb, cfg['kind'], target.embedding, identity)
            out = _swap_face(frame, target.kps, session, cfg, boost, emb, mask)
            if out is None:  # degenerate landmarks — no affine fit
                out_frames.append(frame)
                continue
            out_frames.append(out)
            n_swapped += 1
        if not n_swapped:
            raise ValueError(
                'RaccoonPixelBoostSwap: no target face found in any frame — nothing was swapped')
        return (_to_image(out_frames),)
