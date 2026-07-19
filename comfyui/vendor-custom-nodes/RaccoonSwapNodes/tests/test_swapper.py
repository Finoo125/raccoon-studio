"""Checks for model config + embedding prep. The ONNX-dependent checks skip
when the model files are absent so the test runs on any checkout."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import swapper

MODELS = 'C:/Programming/raccoon-studio/comfyui/ComfyUI/models'
INSWAPPER = f'{MODELS}/insightface/inswapper_128.onnx'


def test_model_config():
    c = swapper.model_config('inswapper_128.onnx')
    assert (c['size'], c['kind'], c['mean'], c['std']) == (128, 'inswapper', 0.0, 1.0)
    c = swapper.model_config('hyperswap_1c_256.onnx')
    assert (c['size'], c['kind'], c['mean'], c['std']) == (256, 'hyperswap', 0.5, 0.5)


def test_inswapper_emap_projection():
    if not os.path.exists(INSWAPPER):
        print('skip: inswapper_128.onnx not installed'); return

    class FakeFace:
        embedding = np.random.rand(512).astype(np.float32)
        normed_embedding = None
    emb = swapper.source_embedding(INSWAPPER, 'inswapper', FakeFace())
    assert emb.shape == (1, 512) and emb.dtype == np.float32


def test_hyperswap_uses_normed_embedding():
    class FakeFace:
        embedding = None
        normed_embedding = np.random.rand(512).astype(np.float32)
    emb = swapper.source_embedding('unused-path', 'hyperswap', FakeFace())
    assert emb.shape == (1, 512)


def test_hyperswap_falls_back_to_raw_embedding():
    # ReActor saved face models may deserialize without normed_embedding —
    # the prep must normalize the raw embedding itself then.
    raw = np.random.rand(512).astype(np.float32)

    class FakeFace:
        embedding = raw
        normed_embedding = None
    emb = swapper.source_embedding('unused-path', 'hyperswap', FakeFace())
    assert emb.shape == (1, 512)
    assert np.isclose(np.linalg.norm(emb), 1.0, atol=1e-4)


def test_swap_crop_roundtrip_shape():
    if not os.path.exists(INSWAPPER):
        print('skip: inswapper_128.onnx not installed'); return
    sess = swapper.get_session(INSWAPPER)

    class FakeFace:
        embedding = np.random.rand(512).astype(np.float32)
        normed_embedding = None
    emb = swapper.source_embedding(INSWAPPER, 'inswapper', FakeFace())
    crop = (np.random.rand(512, 512, 3) * 255).astype(np.uint8)
    out = swapper.swap_crop(sess, 'inswapper', 0.0, 1.0, crop, 128, 512, emb)
    assert out.shape == (512, 512, 3) and out.dtype == np.uint8


if __name__ == '__main__':
    test_model_config()
    test_inswapper_emap_projection()
    test_hyperswap_uses_normed_embedding()
    test_hyperswap_falls_back_to_raw_embedding()
    test_swap_crop_roundtrip_shape()
    print('swapper OK')
