"""RaccoonPixelBoostSwap: FaceFusion-grade pixel-boost face swap as a
standalone node. Drop-in for the ReActorFaceSwap position in the app's
swap chain: same tensor contract (IMAGE in, full swapped frame out), so
ReActorMaskHelper/ColorMatch downstream keep working. ReActor itself is
never imported or modified."""
import os

import cv2
import numpy as np
import torch

import folder_paths

try:
    from . import analyzer, swap_math, swapper
except ImportError:  # direct execution outside the package
    import analyzer
    import swap_math
    import swapper

_ANALYSER = None  # ponytail: single cached analyzer; det params never change


def _analyser():
    global _ANALYSER
    if _ANALYSER is None:
        buffalo = os.path.join(folder_paths.models_dir, 'insightface', 'models', 'buffalo_l')
        _ANALYSER = analyzer.Analyzer(buffalo)
    return _ANALYSER


def _swap_model_files():
    files = set()
    for sub in ('insightface', 'hyperswap'):
        d = os.path.join(folder_paths.models_dir, sub)
        if os.path.isdir(d):
            files.update(f for f in os.listdir(d) if f.endswith('.onnx'))
    return sorted(files) or ['inswapper_128.onnx']


def _resolve_model(filename):
    for sub in ('insightface', 'hyperswap'):
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
            },
            'optional': {
                'source_image': ('IMAGE',),
                'face_model': ('FACE_MODEL',),
            },
        }

    def execute(self, image, swap_model, pixel_boost, face_index,
                source_image=None, face_model=None):
        cfg = swapper.model_config(swap_model)
        boost = int(pixel_boost.split('x')[0])
        model_path = _resolve_model(swap_model)

        # Source identity: a saved ReActor face model wins over a photo
        # (both are insightface Face objects / duck-typed equivalents).
        if face_model is not None:
            src_face = face_model
        elif source_image is not None:
            faces = _analyser().get(_to_bgr(source_image))
            if not faces:
                # Fail loudly: a silent passthrough renders a "successful" image
                # with the wrong face and no hint the swap was skipped.
                raise ValueError(
                    'RaccoonPixelBoostSwap: no face detected in the source image — '
                    'use a clearer / more frontal face photo')
            src_face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        else:
            raise ValueError('RaccoonPixelBoostSwap needs source_image or face_model')

        session = swapper.get_session(model_path)
        emb = swapper.source_embedding(model_path, cfg['kind'], src_face)
        mask = swap_math.box_mask(boost)

        # Swap every frame of the batch (image gens batch up to 4); frames
        # without a usable target face pass through unchanged, but if NO frame
        # got swapped the whole job errors instead of faking success.
        out_frames = []
        n_swapped = 0
        for i in range(image.shape[0]):
            frame = _to_bgr(image, i)
            # Target faces need only bbox/kps — skip the recognition pass.
            faces = sorted(_analyser().get(frame, with_embedding=False), key=lambda f: f.bbox[0])
            if not faces or face_index >= len(faces):
                print(f'[RaccoonSwapNodes] no target face in frame {i} — passthrough')
                out_frames.append(frame)
                continue
            target = faces[face_index]

            # Align crop at boost resolution, pixel-boost swap it, paste back.
            matrix = swap_math.estimate_affine(target.kps.astype(np.float32), boost)
            if matrix is None:  # degenerate landmarks — no affine fit
                out_frames.append(frame)
                continue
            crop = cv2.warpAffine(frame, matrix, (boost, boost),
                                  borderMode=cv2.BORDER_REPLICATE)
            swapped = swapper.swap_crop(session, cfg['kind'], cfg['mean'], cfg['std'],
                                        crop, cfg['size'], boost, emb)

            inverse = cv2.invertAffineTransform(matrix)
            h, w = frame.shape[:2]
            warped = cv2.warpAffine(swapped, inverse, (w, h), borderMode=cv2.BORDER_REPLICATE)
            warped_mask = cv2.warpAffine(mask, inverse, (w, h))[:, :, np.newaxis]
            out = frame.astype(np.float32) * (1 - warped_mask) + warped.astype(np.float32) * warped_mask
            out_frames.append(out.clip(0, 255).astype(np.uint8))
            n_swapped += 1
        if not n_swapped:
            raise ValueError(
                'RaccoonPixelBoostSwap: no target face found in any frame — nothing was swapped')
        return (_to_image(out_frames),)
