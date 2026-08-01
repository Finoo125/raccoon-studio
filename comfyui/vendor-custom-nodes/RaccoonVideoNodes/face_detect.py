"""Face bbox detection for the LTX identity reinforcer.

VENDORED from TenStrip/10S-Comfy-nodes @ c231acaa (v1.9.7, MIT -- see
LICENSE-10S_Nodes in this folder), file `latent_likeness_guide.py`: only
`_download_yunet_model`, `_get_yunet_detector` and `_detect_face_bbox`, copied
verbatim.

Why not vendor that file: it is 51 KB of nodes we do not register, and it
imports `latent_tiled_sampler` (another 73 KB) for two helpers we never call.
These three functions have no such dependency -- OpenCV only, which ComfyUI
already ships.

Detection order is YuNet -> MediaPipe -> Haar cascade. **YuNet auto-downloads a
~350 KB ONNX model on first use**; with no network it falls through to Haar,
which is frontal-view only but keeps the feature working offline.
"""

import numpy as np

# ─────────────────────────────────────────────────────────────────────────────

# Cached YuNet detector — loaded once per process
_YUNET_DETECTOR = None
_YUNET_LOAD_TRIED = False
_YUNET_MODEL_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
                    "face_detection_yunet/face_detection_yunet_2023mar.onnx")



def _download_yunet_model(target_path: str, debug: bool = False) -> bool:
    """Download the YuNet ONNX model (~350 KB) to the given path."""
    try:
        import urllib.request
        import os
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        if debug:
            print(f"  · [face_detect] downloading YuNet model to {target_path}")
        urllib.request.urlretrieve(_YUNET_MODEL_URL, target_path)
        return True
    except Exception as e:
        if debug:
            print(f"  · [face_detect] YuNet download failed: {type(e).__name__}: {e}")
        return False


def _get_yunet_detector(debug: bool = False):
    """Lazy-load OpenCV YuNet face detector, cached across calls."""
    global _YUNET_DETECTOR, _YUNET_LOAD_TRIED
    if _YUNET_DETECTOR is not None:
        return _YUNET_DETECTOR
    if _YUNET_LOAD_TRIED:
        return None
    _YUNET_LOAD_TRIED = True

    try:
        import cv2
        import os

        # Look for the model in a few standard locations
        model_paths = [
            os.path.join(os.path.dirname(__file__), "models",
                         "face_detection_yunet_2023mar.onnx"),
            os.path.expanduser("~/.cache/10s_comfy/face_detection_yunet_2023mar.onnx"),
        ]

        model_path = None
        for p in model_paths:
            if os.path.exists(p):
                model_path = p
                break

        # Download if not found
        if model_path is None:
            target = model_paths[1]  # ~/.cache
            if _download_yunet_model(target, debug=debug):
                model_path = target
            else:
                return None

        _YUNET_DETECTOR = cv2.FaceDetectorYN.create(
            model_path, "", (320, 320), 0.5, 0.3, 5000
        )
        if debug:
            print(f"  · [face_detect] YuNet loaded from {model_path}")
        return _YUNET_DETECTOR
    except Exception as e:
        if debug:
            print(f"  · [face_detect] YuNet load failed: {type(e).__name__}: {e}")
        return None


def _detect_face_bbox(image_np, padding=0.15, debug=False):
    """
    Detect the largest face in an HxWx3 uint8 image and return normalized
    (x1, y1, x2, y2) bbox, or None if no face found / no detection backend.

    Detection backend priority:
      1. OpenCV YuNet DNN detector (best — handles tilt, close-up, expressions;
         auto-downloads ~350 KB model on first use)
      2. MediaPipe (falls back if YuNet unavailable; handles new tasks API)
      3. OpenCV Haar cascade (basic fallback, frontal-view only)

    Args:
        image_np   : numpy array HxWx3 uint8
        padding    : fraction to expand bbox by (0.15 = 15% padding)
    """
    H, W = image_np.shape[:2]

    def _pad_and_return(x1, y1, x2, y2):
        """Apply padding and clamp to [0,1]."""
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        half_w = (x2 - x1) / 2 * (1.0 + padding)
        half_h = (y2 - y1) / 2 * (1.0 + padding)
        return (
            max(0.0, cx - half_w),
            max(0.0, cy - half_h),
            min(1.0, cx + half_w),
            min(1.0, cy + half_h),
        )

    # ── 1. YuNet (preferred) ──────────────────────────────────────────────
    try:
        import cv2
        detector = _get_yunet_detector(debug=debug)
        if detector is not None:
            detector.setInputSize((W, H))
            # YuNet expects BGR input
            bgr = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)
            _, faces = detector.detect(bgr)
            if faces is not None and len(faces) > 0:
                # Each face: [x, y, w, h, landmarks..., score]
                best = max(faces, key=lambda f: f[2] * f[3])
                x, y, w, h = best[0], best[1], best[2], best[3]
                x1, y1 = max(0.0, x / W), max(0.0, y / H)
                x2, y2 = min(1.0, (x + w) / W), min(1.0, (y + h) / H)
                bbox = _pad_and_return(x1, y1, x2, y2)
                if debug:
                    print(f"  · [face_detect] YuNet found face: "
                          f"({bbox[0]:.3f},{bbox[1]:.3f},{bbox[2]:.3f},{bbox[3]:.3f})")
                return bbox
            elif debug:
                print(f"  · [face_detect] YuNet: no face found; trying MediaPipe")
    except Exception as e:
        if debug:
            print(f"  · [face_detect] YuNet error: {type(e).__name__}: {e}")



    # Try MediaPipe (more accurate, supports angles)
    try:
        import mediapipe as mp
        with mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.5
        ) as detector:
            results = detector.process(image_np)
            if results.detections:
                # Find largest detection
                best = None
                best_area = 0
                for det in results.detections:
                    box = det.location_data.relative_bounding_box
                    area = box.width * box.height
                    if area > best_area:
                        best_area = area
                        best = box
                if best is not None:
                    x1 = max(0.0, best.xmin)
                    y1 = max(0.0, best.ymin)
                    x2 = min(1.0, best.xmin + best.width)
                    y2 = min(1.0, best.ymin + best.height)
                    # Apply padding
                    cx = (x1 + x2) / 2
                    cy = (y1 + y2) / 2
                    half_w = (x2 - x1) / 2 * (1.0 + padding)
                    half_h = (y2 - y1) / 2 * (1.0 + padding)
                    x1 = max(0.0, cx - half_w)
                    y1 = max(0.0, cy - half_h)
                    x2 = min(1.0, cx + half_w)
                    y2 = min(1.0, cy + half_h)
                    if debug:
                        print(f"  \u00b7 [face_detect] MediaPipe found face: "
                              f"({x1:.3f},{y1:.3f},{x2:.3f},{y2:.3f})")
                    return (x1, y1, x2, y2)
    except ImportError:
        if debug:
            print(f"  \u00b7 [face_detect] mediapipe not installed; trying OpenCV")
    except Exception as e:
        if debug:
            print(f"  \u00b7 [face_detect] MediaPipe error: {type(e).__name__}: {e}")

    # Fallback: OpenCV Haar cascade
    try:
        import cv2
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        cascade = cv2.CascadeClassifier(cascade_path)
        if cascade.empty():
            if debug:
                print(f"  \u00b7 [face_detect] OpenCV cascade load failed")
            return None
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
        if len(faces) == 0:
            if debug:
                print(f"  \u00b7 [face_detect] OpenCV: no face found")
            return None
        # Largest face
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        x1 = x / W
        y1 = y / H
        x2 = (x + w) / W
        y2 = (y + h) / H
        # Apply padding
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        half_w = (x2 - x1) / 2 * (1.0 + padding)
        half_h = (y2 - y1) / 2 * (1.0 + padding)
        x1 = max(0.0, cx - half_w)
        y1 = max(0.0, cy - half_h)
        x2 = min(1.0, cx + half_w)
        y2 = min(1.0, cy + half_h)
        if debug:
            print(f"  \u00b7 [face_detect] OpenCV Haar found face: "
                  f"({x1:.3f},{y1:.3f},{x2:.3f},{y2:.3f})")
        return (x1, y1, x2, y2)
    except ImportError:
        if debug:
            print(f"  \u00b7 [face_detect] opencv-python not installed")
        return None
    except Exception as e:
        if debug:
            print(f"  \u00b7 [face_detect] OpenCV error: {type(e).__name__}: {e}")
        return None


