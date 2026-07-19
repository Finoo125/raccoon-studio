"""Assert-based checks for the pure-numpy pixel-boost math. Run with the
ComfyUI venv python; no pytest needed:
  .venv/Scripts/python.exe tests/test_swap_math.py  (from the pack dir)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import swap_math


def test_implode_explode_roundtrip():
    # 512 crop, 128 model -> 16 tiles; explode(implode(x)) == x exactly.
    crop = np.arange(512 * 512 * 3, dtype=np.float32).reshape(512, 512, 3)
    tiles = swap_math.implode(crop, 128)
    assert tiles.shape == (16, 128, 128, 3)
    back = swap_math.explode(list(tiles), 128, 512)
    assert np.array_equal(back, crop)


def test_implode_tiles_are_subsampled_grids():
    # Pixel-unshuffle: tile 0 must equal crop[::N, ::N] (stride view), not a
    # spatial quadrant. N = 512 // 256 = 2.
    crop = np.random.rand(512, 512, 3).astype(np.float32)
    tiles = swap_math.implode(crop, 256)
    assert tiles.shape == (4, 256, 256, 3)
    assert np.array_equal(tiles[0], crop[0::2, 0::2])


def test_estimate_affine_maps_landmarks_to_template():
    # Landmarks exactly at template*size must produce ~identity mapping.
    size = 256
    pts = swap_math.ARCFACE_128 * size
    m = swap_math.estimate_affine(pts.astype(np.float32), size)
    ones = np.hstack([pts, np.ones((5, 1))])
    mapped = ones @ m.T
    assert np.allclose(mapped, pts, atol=0.5)


def test_box_mask_shape_and_range():
    mask = swap_math.box_mask(512)
    assert mask.shape == (512, 512)
    assert mask.dtype == np.float32
    assert 0.0 <= mask.min() and mask.max() <= 1.0
    assert mask[256, 256] > 0.9   # center solid
    assert mask[0, 0] < 0.1       # border faded


if __name__ == '__main__':
    test_implode_explode_roundtrip()
    test_implode_tiles_are_subsampled_grids()
    test_estimate_affine_maps_landmarks_to_template()
    test_box_mask_shape_and_range()
    print('swap_math OK')
