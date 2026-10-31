"""ONNX swapper execution: per-model config, cached sessions, source
embedding prep, and the pixel-boost tile loop over one aligned crop."""
import cv2
import numpy as np
import onnx
import onnxruntime

if __package__:
    from . import swap_math
    from .providers import pick_providers
else:  # tests run this file outside the package
    import swap_math
    from providers import pick_providers

# ponytail: module-global caches; per-process, ComfyUI is single-process.
_SESSIONS = {}
_EMAPS = {}

# Resolved once at import — an onnxruntime build's provider list is fixed.
_PROVIDERS = pick_providers()


def model_config(filename):
    """Swapper family from filename, matching FaceFusion's model table.

    inswapper:  128px, no normalization.
    hyperswap:  256px, mean/std 0.5.
    alphaface:  256px, no normalization. FaceFusion 3.9.0's swapper; it injects
                the identity embedding at every encoder stage instead of only at
                the bottleneck, which is what makes it hold up on off-angle
                faces where inswapper/hyperswap smear. Same `arcface_128` warp
                template the other two use, so nothing in swap_math changes.
    """
    if 'alphaface' in filename:
        return {'size': 256, 'kind': 'alphaface', 'mean': 0.0, 'std': 1.0}
    if 'hyperswap' in filename:
        return {'size': 256, 'kind': 'hyperswap', 'mean': 0.5, 'std': 0.5}
    return {'size': 128, 'kind': 'inswapper', 'mean': 0.0, 'std': 1.0}


def get_session(path):
    if path not in _SESSIONS:
        _SESSIONS[path] = onnxruntime.InferenceSession(path, providers=_PROVIDERS)
    return _SESSIONS[path]


def _emap(path):
    """inswapper's 512x512 embedding projection matrix, stored as the last
    initializer of its ONNX graph (same trick FaceFusion uses)."""
    if path not in _EMAPS:
        graph = onnx.load(path).graph
        _EMAPS[path] = onnx.numpy_helper.to_array(graph.initializer[-1])
    return _EMAPS[path]


def source_embedding(session_path, kind, face):
    """(1,512) float32 source latent for the swapper. alphaface takes the RAW
    arcface embedding (no projection, no normalization); hyperswap consumes the
    arcface normed embedding directly (normalizing the raw embedding when a
    deserialized face model lacks it); inswapper projects through emap."""
    if kind == 'alphaface':
        return face.embedding.reshape(1, -1).astype(np.float32)
    if kind == 'hyperswap':
        emb = getattr(face, 'normed_embedding', None)
        if emb is None:
            emb = face.embedding / np.linalg.norm(face.embedding)
        return emb.reshape(1, -1).astype(np.float32)
    emb = face.embedding.reshape(1, -1)
    emb = np.dot(emb, _emap(session_path)) / np.linalg.norm(emb)
    return emb.astype(np.float32)


def swap_crop(session, kind, mean, std, crop_bgr, model_size, boost_size, embedding):
    """Swap one aligned BGR uint8 crop at boost resolution via pixel boost."""
    tiles = swap_math.implode(crop_bgr.astype(np.float32), model_size)
    out_tiles = []
    for tile in tiles:
        x = tile[:, :, ::-1] / 255.0            # BGR -> RGB, 0..1
        x = (x - mean) / std
        x = x.transpose(2, 0, 1)[np.newaxis].astype(np.float32)
        y = session.run(None, {'target': x, 'source': embedding})[0][0]
        y = y.transpose(1, 2, 0)
        if kind == 'hyperswap':
            y = y * std + mean
        y = y.clip(0, 1)[:, :, ::-1] * 255      # RGB -> BGR
        out_tiles.append(y)
    crop = swap_math.explode(out_tiles, model_size, boost_size)
    return crop.clip(0, 255).astype(np.uint8)


# Neutral point of the identity dial. At 0.5 the source latent is returned
# untouched, so the shipped default is bit-identical to the un-dialled swap.
IDENTITY_NEUTRAL = 0.5


def balance_embedding(embedding, kind, target_embedding, identity):
    """Blend the source latent toward — or away from — the TARGET face's own
    identity. FaceFusion's `face_swapper_weight` / `balance_source_embedding`,
    with one deliberate fix.

    The dial maps 0..1 onto a blend weight of +0.35..-0.35 against the target's
    arcface direction, so:

      0.0  pull toward the generated face: weakest likeness, easiest blend
      0.5  untouched (the default) -- and the MAXIMUM-likeness point
      1.0  overshoot away from the generated face: caricature

    Above 0.5 the weight goes negative, so it extrapolates rather than
    interpolating. That does NOT buy extra likeness, and it would be easy to
    label it as if it did: the source embedding is by definition the point of
    maximum arcface similarity to the source, so any perturbation reduces it.
    Measured live 2026-09-05 on alphaface, one seed: 0.0 -> 0.711, 0.5 -> 0.841,
    1.0 -> 0.827. What the top half actually buys is a face pushed further from
    the one the model drew, which is a different and occasionally useful thing.

    **Deviation from upstream, on purpose.** FaceFusion normalizes only the
    TARGET and then mixes it into whatever scale the source latent happens to
    have. That is fine for hyperswap and inswapper, whose latents are ~unit
    norm, but alphaface consumes the RAW arcface embedding — norm ~20 — so a
    0.35-magnitude unit vector moves it by 2.6% instead of 35%, and the dial is
    a no-op on exactly the model it is most wanted for. Measured 2026-09-05:
    full deflection moved the rendered face by at most 8/255 on alphaface.

    Blending the DIRECTIONS and restoring the source's magnitude gives every
    family the same authority (35%), and for the ~unit-norm families it is
    within a hair of upstream's formula. Identity is a direction in arcface
    space; its magnitude carries no identity information, which is why this is
    a fix and not a behaviour change.

    `target_embedding` is None whenever recognition was skipped on the target
    frame (the neutral fast path), and that returns the latent unchanged.
    """
    if target_embedding is None or identity == IDENTITY_NEUTRAL:
        return embedding
    weight = float(np.interp(identity, [0.0, 1.0], [0.35, -0.35]))
    source = np.asarray(embedding, dtype=np.float32).reshape(1, -1)
    scale = np.linalg.norm(source)
    if scale == 0:
        return embedding
    target = np.asarray(target_embedding, dtype=np.float32).reshape(1, -1)
    target = target / np.linalg.norm(target)
    blended = (source / scale) * (1.0 - weight) + target * weight
    return (blended * scale).astype(np.float32)


def occlusion_mask(model_path, crop_bgr, out_size):
    """FaceFusion's occlusion mask: which pixels of the ALIGNED CROP are really
    face, and which are a hand / mic / hair in front of it.

    Runs on the crop rather than the frame, which is the whole reason it is
    affordable per frame (~2 ms against SAM's tens to hundreds). It multiplies
    into the feathered box mask, so anything the occluder marks as covered keeps
    the original pixels and the swapped face goes behind it.

    The input layout is read off the session rather than assumed: this file is
    pointed at whatever `xseg` build a user installed, and an NHWC model fed
    NCHW does not error — it returns a plausible-looking garbage mask, which
    would present as "the swap randomly eats parts of the face".

    The final blur/clip/rescale is upstream's edge softening: the mask reads a
    solid 1 well inside the face and only falls off near an occluder's boundary,
    so a slightly conservative segmentation does not shrink the swap.
    """
    session = get_session(model_path)
    inp = session.get_inputs()[0]
    shape = inp.shape
    nhwc = len(shape) == 4 and shape[-1] in (1, 3)
    dims = (shape[1], shape[2]) if nhwc else (shape[2], shape[3])
    h, w = (d if isinstance(d, int) else 256 for d in dims)

    x = cv2.resize(crop_bgr, (w, h)).astype(np.float32) / 255.0
    x = x[np.newaxis] if nhwc else x.transpose(2, 0, 1)[np.newaxis]
    y = np.squeeze(session.run(None, {inp.name: x})[0]).astype(np.float32)
    y = cv2.resize(y.clip(0.0, 1.0), (out_size, out_size))
    return (cv2.GaussianBlur(y, (0, 0), 5).clip(0.5, 1.0) - 0.5) * 2.0
