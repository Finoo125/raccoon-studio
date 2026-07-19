"""Pure-numpy math for pixel-boost face swapping.

Pixel boost (FaceFusion technique): align the face crop at boost resolution,
pixel-unshuffle it into N^2 model-sized sub-frames (each a full-face
subsampled grid, so every sub-frame sees the whole face), swap each, and
re-interleave. This is what lets a 128/256px swapper emit real detail at
512-1024px instead of having its output upscaled by a restorer.
"""
import cv2
import numpy as np

# FaceFusion's arcface_128 warp template (normalized 0..1); used by both
# inswapper_128 and the hyperswap_1*_256 family. Multiply by crop size.
ARCFACE_128 = np.array([
    [0.36167656, 0.40387734],
    [0.63696719, 0.40235469],
    [0.50019687, 0.56044219],
    [0.38710391, 0.72160547],
    [0.61507734, 0.72034453],
], dtype=np.float32)


def estimate_affine(landmark5, size):
    """Similarity transform from the 5 face landmarks to the arcface template
    scaled to `size`. Returns a 2x3 cv2 affine matrix."""
    template = ARCFACE_128 * size
    matrix, _ = cv2.estimateAffinePartial2D(
        landmark5, template, method=cv2.RANSAC, ransacReprojThreshold=100)
    return matrix


def implode(crop, model_size):
    """Pixel-unshuffle a (S,S,3) crop into (N^2, m, m, 3) sub-frames."""
    n = crop.shape[0] // model_size
    x = crop.reshape(model_size, n, model_size, n, 3)
    return x.transpose(1, 3, 0, 2, 4).reshape(n * n, model_size, model_size, 3)


def explode(tiles, model_size, boost_size):
    """Re-interleave N^2 swapped (m,m,3) sub-frames into a (S,S,3) crop."""
    n = boost_size // model_size
    x = np.stack(tiles).reshape(n, n, model_size, model_size, 3)
    return x.transpose(2, 0, 3, 1, 4).reshape(boost_size, boost_size, 3)


def box_mask(size):
    """Feathered box mask for paste-back: solid center, 10% faded border.
    Edge refinement (occlusion, hair) is the downstream YOLO+SAM composite's
    job — this only avoids a hard seam at the crop boundary."""
    pad = int(size * 0.1)
    mask = np.zeros((size, size), dtype=np.float32)
    mask[pad:size - pad, pad:size - pad] = 1.0
    blur = int(size * 0.15) | 1  # odd kernel
    return cv2.GaussianBlur(mask, (blur, blur), 0).clip(0.0, 1.0)
