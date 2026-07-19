"""Checks for the self-contained buffalo_l analyzer (SCRFD + arcface).
Model-dependent checks skip when buffalo_l or the sample face is absent."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import analyzer

BUFFALO = 'C:/Programming/raccoon-studio/comfyui/ComfyUI/models/insightface/models/buffalo_l'
SAMPLE = 'C:/AI/sample_faces/db 5.png'


def test_detect_sample_face():
    if not (os.path.isdir(BUFFALO) and os.path.exists(SAMPLE)):
        print('skip: buffalo_l or sample face missing'); return
    import cv2
    a = analyzer.Analyzer(BUFFALO)
    img = cv2.imread(SAMPLE)
    faces = a.get(img)
    assert len(faces) == 1, f'expected 1 face, got {len(faces)}'
    f = faces[0]
    assert f.kps.shape == (5, 2)
    assert f.bbox.shape == (4,)
    # kps inside bbox (sanity that decode/stride math is right)
    x1, y1, x2, y2 = f.bbox
    assert (f.kps[:, 0] > x1).all() and (f.kps[:, 0] < x2).all()
    assert (f.kps[:, 1] > y1).all() and (f.kps[:, 1] < y2).all()
    assert f.embedding.shape == (512,)
    assert np.isclose(np.linalg.norm(f.normed_embedding), 1.0, atol=1e-4)


def test_detect_no_face_on_noise():
    if not os.path.isdir(BUFFALO):
        print('skip: buffalo_l missing'); return
    a = analyzer.Analyzer(BUFFALO)
    noise = (np.random.rand(480, 480, 3) * 255).astype(np.uint8)
    assert a.get(noise) == []


def test_get_retries_smaller_det_size():
    # Retry contract: 640 finding nothing must fall back to 320. SCRFD misses
    # very large faces — a tight source crop upscaled into the 640 letterbox
    # outgrows the anchors and scores below threshold (the 2026-07-18
    # pixel-boost "no swap" bug). No ONNX needed: stub the detect pass.
    calls = []
    a = analyzer.Analyzer.__new__(analyzer.Analyzer)
    a._detect = lambda frame, det, we: calls.append(det) or ([] if det == 640 else ['face'])
    assert a.get(None) == ['face']
    assert calls == [640, 320]


def test_detect_tight_face_crop():
    # Live regression: crop the sample face to bbox+15% margin (mimics the
    # failing 374px source photo) — detection must survive via the 320 retry.
    if not (os.path.isdir(BUFFALO) and os.path.exists(SAMPLE)):
        print('skip: buffalo_l or sample face missing'); return
    import cv2
    a = analyzer.Analyzer(BUFFALO)
    img = cv2.imread(SAMPLE)
    f = a.get(img, with_embedding=False)[0]
    x1, y1, x2, y2 = [int(v) for v in f.bbox]
    m = int((x2 - x1) * 0.15)
    crop = img[max(0, y1 - m):y2 + m, max(0, x1 - m):x2 + m]
    assert a.get(crop, with_embedding=False), 'tight face crop not detected'


if __name__ == '__main__':
    test_detect_sample_face()
    test_detect_no_face_on_noise()
    test_get_retries_smaller_det_size()
    test_detect_tight_face_crop()
    print('analyzer OK')
