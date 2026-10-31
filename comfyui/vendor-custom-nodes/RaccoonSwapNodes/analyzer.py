"""Self-contained face analysis over buffalo_l's ONNX files: SCRFD detection
(det_10g.onnx: bbox + 5-point landmarks) and arcface recognition
(w600k_r50.onnx: 512-d embedding).

Exists because the ComfyUI env has no `insightface` package — ReActor 0.7+
vendors its own fork and we deliberately don't import ReActor internals
(they may change on update). Only numpy/cv2/onnxruntime are needed.
"""
import os
from types import SimpleNamespace

import cv2
import numpy as np
import onnxruntime

if __package__:
    from .providers import pick_providers
else:  # tests run this file outside the package
    from providers import pick_providers

# Resolved once at import — an onnxruntime build's provider list is fixed.
_PROVIDERS = pick_providers()

# Canonical arcface 112x112 5-point template (insightface's alignment target
# for recognition; equals FaceFusion's normalized arcface_112_v2 x 112).
ARCFACE_112 = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
], dtype=np.float32)

_DET_SIZE = 640
_STRIDES = (8, 16, 32)
_SCORE_THRESH = 0.5
_NMS_THRESH = 0.4


def _nms(boxes, scores, thresh):
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(i)
        if order.size == 1:
            break
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_o = (boxes[order[1:], 2] - boxes[order[1:], 0]) * (boxes[order[1:], 3] - boxes[order[1:], 1])
        iou = inter / (area_i + area_o - inter + 1e-9)
        order = order[1:][iou <= thresh]
    return keep


class Analyzer:
    """Detection + recognition over a buffalo_l model dir."""

    def __init__(self, buffalo_dir):
        self._det = onnxruntime.InferenceSession(
            os.path.join(buffalo_dir, 'det_10g.onnx'), providers=_PROVIDERS)
        self._rec = onnxruntime.InferenceSession(
            os.path.join(buffalo_dir, 'w600k_r50.onnx'), providers=_PROVIDERS)
        self._det_input = self._det.get_inputs()[0].name
        self._rec_input = self._rec.get_inputs()[0].name
        self._lmk_path = os.path.join(buffalo_dir, '1k3d68.onnx')
        self._lmk = None  # loaded on first use: only the video swap's gate needs it

    def landmarks3d(self, frame_bgr, bbox):
        """1k3d68's 68 face points (x, y, depth) for one detected face, in its
        192 px crop's pixels, or None when buffalo_l came without the model.

        Preprocessing is insightface's own for this file: a square crop 1.5x the
        box, raw 0-255 RGB (its first layer, `bn_data`, normalises)."""
        if self._lmk is None:
            if not os.path.exists(self._lmk_path):
                return None
            self._lmk = onnxruntime.InferenceSession(self._lmk_path, providers=_PROVIDERS)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        s = 192.0 / (max(w, h) * 1.5)
        cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        m = np.array([[s, 0, 96 - cx * s], [0, s, 96 - cy * s]], dtype=np.float32)
        crop = cv2.warpAffine(frame_bgr, m, (192, 192), borderValue=0)
        blob = crop[:, :, ::-1].astype(np.float32).transpose(2, 0, 1)[np.newaxis]
        out = self._lmk.run(None, {self._lmk.get_inputs()[0].name: blob})[0][0]
        return out.reshape(-1, 3)[-68:]

    def get(self, frame_bgr, with_embedding=True, min_score=None):
        """Faces in a BGR uint8 frame, sorted by descending detection score.
        Each is a SimpleNamespace(bbox(4,), kps(5,2), det_score, embedding(512,),
        normed_embedding(512,)) — duck-compatible with insightface Face.

        SCRFD misses very large faces: a tight face crop upscaled into the 640
        letterbox outgrows the anchor scales and scores below threshold. Retry
        at 320 when 640 finds nothing — same fallback ReActor uses.

        `min_score` overrides the module default. Video wants it lower than
        stills do: a head turning three-quarters away scores under 0.5 and drops
        out, and a frame that silently goes unswapped mid-clip reads as the swap
        being broken rather than as the face having turned."""
        score = _SCORE_THRESH if min_score is None else float(min_score)
        for det_size in (_DET_SIZE, 320):
            faces = self._detect(frame_bgr, det_size, with_embedding, score)
            if faces:
                return faces
        return []

    def _detect(self, frame_bgr, det_size, with_embedding, min_score=_SCORE_THRESH):
        h, w = frame_bgr.shape[:2]
        scale = det_size / max(h, w)
        rw, rh = int(round(w * scale)), int(round(h * scale))
        letter = np.zeros((det_size, det_size, 3), dtype=np.uint8)
        letter[:rh, :rw] = cv2.resize(frame_bgr, (rw, rh))
        blob = ((letter[:, :, ::-1].astype(np.float32) - 127.5) / 128.0)
        blob = blob.transpose(2, 0, 1)[np.newaxis]

        # det_10g outputs, batched: [scores@8,16,32, bboxes@8,16,32, kps@8,16,32];
        # bbox/kps values are center-relative distances in stride units.
        out = self._det.run(None, {self._det_input: blob})
        boxes_all, kps_all, scores_all = [], [], []
        for i, stride in enumerate(_STRIDES):
            scores = out[i].reshape(-1)
            bbox = out[i + 3].reshape(-1, 4) * stride
            kps = out[i + 6].reshape(-1, 5, 2) * stride
            side = det_size // stride
            # 2 anchors per cell, same center
            cx, cy = np.meshgrid(np.arange(side), np.arange(side))
            centers = np.stack([cx, cy], axis=-1).reshape(-1, 2)
            centers = np.repeat(centers, 2, axis=0).astype(np.float32) * stride
            mask = scores >= min_score
            if not mask.any():
                continue
            c, b, k = centers[mask], bbox[mask], kps[mask]
            boxes_all.append(np.stack(
                [c[:, 0] - b[:, 0], c[:, 1] - b[:, 1], c[:, 0] + b[:, 2], c[:, 1] + b[:, 3]], axis=1))
            kps_all.append(c[:, np.newaxis, :] + k)
            scores_all.append(scores[mask])
        if not boxes_all:
            return []

        boxes = np.concatenate(boxes_all) / scale
        kps = np.concatenate(kps_all) / scale
        scores = np.concatenate(scores_all)
        keep = _nms(boxes, scores, _NMS_THRESH)

        faces = []
        for i in keep:
            emb = self._embed(frame_bgr, kps[i]) if with_embedding else None
            faces.append(SimpleNamespace(
                bbox=boxes[i], kps=kps[i], det_score=float(scores[i]),
                embedding=emb,
                normed_embedding=None if emb is None else emb / np.linalg.norm(emb),
            ))
        return faces

    def _embed(self, frame_bgr, kps):
        matrix, _ = cv2.estimateAffinePartial2D(
            kps.astype(np.float32), ARCFACE_112, method=cv2.RANSAC, ransacReprojThreshold=100)
        crop = cv2.warpAffine(frame_bgr, matrix, (112, 112), borderMode=cv2.BORDER_REPLICATE)
        blob = ((crop[:, :, ::-1].astype(np.float32) - 127.5) / 127.5)
        blob = blob.transpose(2, 0, 1)[np.newaxis]
        return self._rec.run(None, {self._rec_input: blob})[0].flatten().astype(np.float32)
