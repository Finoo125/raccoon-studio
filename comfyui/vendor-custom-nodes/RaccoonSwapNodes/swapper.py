"""ONNX swapper execution: per-model config, cached sessions, source
embedding prep, and the pixel-boost tile loop over one aligned crop."""
import numpy as np
import onnx
import onnxruntime

try:
    from . import swap_math
except ImportError:  # tests run this file outside the package
    import swap_math

# ponytail: module-global caches; per-process, ComfyUI is single-process.
_SESSIONS = {}
_EMAPS = {}

_PROVIDERS = ['CUDAExecutionProvider', 'CPUExecutionProvider']


def model_config(filename):
    """Swapper family from filename. inswapper: 128px, no normalization.
    hyperswap: 256px, mean/std 0.5 (matches FaceFusion's model table)."""
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
    """(1,512) float32 source latent for the swapper. hyperswap consumes the
    arcface normed embedding directly (normalizing the raw embedding when a
    deserialized face model lacks it); inswapper projects through emap."""
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
