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


def cosine(a, b):
    """Cosine similarity of two arcface embeddings. -1.0 for a degenerate
    (zero-norm) vector, which sorts below any real match."""
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return -1.0
    return float(np.dot(np.asarray(a).ravel(), np.asarray(b).ravel()) / (na * nb))


def smooth_kps(prev, cur, alpha):
    """EMA this frame's 5 landmarks toward the previous frame's.

    A per-frame swap re-fits the alignment from scratch every frame, and the
    sub-pixel wobble in the detector's landmarks reads as flicker on the swapped
    face. Averaging the landmarks (not the pixels) fixes it at the source and
    costs nothing.

    `alpha` is the weight on the PREVIOUS frame, so 0 is off.

    The jump guard is load-bearing: on a cut, or when the head moves fast, the
    smoothed crop would lag behind the actual face and the swap would visibly
    slide off it. Interocular distance is the natural scale for "a lot" —
    landmarks that moved more than half a face-width are a new position, not
    jitter, so they are taken as-is.
    """
    if prev is None or alpha <= 0:
        return cur
    scale = float(np.linalg.norm(cur[1] - cur[0]))
    if scale <= 1e-6 or float(np.linalg.norm(cur - prev, axis=1).mean()) > scale * 0.5:
        return cur
    return prev * alpha + cur * (1.0 - alpha)


# Symmetric 1k3d68 landmark pairs (left, right): outer and inner eye corners,
# nostril wings, mouth corners. The jaw contour is left out — on a turned head
# its far side is a silhouette guess.
_YAW_PAIRS = ((36, 45), (39, 42), (31, 35), (48, 54))


def head_yaw(points68):
    """Head turn in degrees (0 = facing the camera, sign = which way) from
    1k3d68's 68 points, which carry depth: the left-to-right line across the
    face tilts into the picture as the head turns."""
    p = np.asarray(points68, dtype=np.float32)
    v = sum(p[r] - p[l] for l, r in _YAW_PAIRS)
    return float(np.degrees(np.arctan2(v[2], np.hypot(v[0], v[1]))))


def gate_weights(risky):
    """Per-frame swap strength from per-frame "risky" flags: 0 on a risky frame
    and the 3 frames either side, then a fade back to 1 over ~0.25 s (sigma 2
    frames at 24 fps), so the swap never pops in or out. The Video Helper's
    gate, as it was tuned there (tools/swap/refine.py)."""
    risky = np.asarray(risky, dtype=np.float32)
    if risky.size == 0:
        return risky
    wide = cv2.dilate(risky[None], np.ones((1, 7), np.uint8))[0] > 0
    weight = 1 - np.clip(cv2.GaussianBlur(wide.astype(np.float32)[None], (0, 0), 2)[0] * 1.5, 0, 1)
    weight[wide] = 0
    return weight


def loose_crop(frame, bbox, scale=1.6, size=256):
    """Square, padded crop around a detection box — the picker's thumbnail and
    the reference image the matcher embeds.

    Loose rather than tight on purpose: a tight face crop upscaled into the
    detector's 640 letterbox outgrows its anchor scales and scores below
    threshold, so a tight reference can fail to re-detect (the analyzer's 320
    fallback exists for exactly that). It also simply reads better as a
    thumbnail. `getRectSubPix` replicates the border, so a face at the frame
    edge crops without a black wedge.
    """
    cx = float(bbox[0] + bbox[2]) / 2.0
    cy = float(bbox[1] + bbox[3]) / 2.0
    side = int(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * scale)
    side = max(side, 16)
    patch = cv2.getRectSubPix(frame, (side, side), (cx, cy))
    return cv2.resize(patch, (size, size))
