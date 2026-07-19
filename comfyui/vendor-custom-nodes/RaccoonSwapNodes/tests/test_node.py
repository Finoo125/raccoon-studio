"""Error-contract checks for RaccoonPixelBoostSwap: a swap that can't happen
must raise (surfaced by the app via execution_error), never fake success.
Stub-based — no ONNX models needed, but imports torch + folder_paths."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, r'C:\Programming\raccoon-studio\comfyui\ComfyUI')  # folder_paths
from types import SimpleNamespace
import numpy as np
import torch
import node
import swapper


class SeqAnalyzer:
    """Returns the next canned face list per get() call (source first, then frames)."""
    def __init__(self, seq):
        self.seq = list(seq)

    def get(self, frame, with_embedding=True):
        return self.seq.pop(0)


def _stub_face():
    return SimpleNamespace(bbox=np.array([0.0, 0.0, 10.0, 10.0]),
                           kps=np.zeros((5, 2), dtype=np.float32))


def test_missing_source_face_raises():
    node._ANALYSER = SeqAnalyzer([[]])
    node._resolve_model = lambda f: 'stub-path'
    try:
        node.RaccoonPixelBoostSwap().execute(
            torch.rand(1, 64, 64, 3), 'inswapper_128.onnx', '512x512', 0,
            source_image=torch.rand(1, 64, 64, 3))
        raise AssertionError('expected ValueError for missing source face')
    except ValueError as e:
        assert 'source image' in str(e)


def test_no_target_face_in_any_frame_raises():
    # Source detects fine; neither batch frame has a target face.
    node._ANALYSER = SeqAnalyzer([[_stub_face()], [], []])
    node._resolve_model = lambda f: 'stub-path'
    swapper.get_session = lambda p: None
    swapper.source_embedding = lambda *a: None
    try:
        node.RaccoonPixelBoostSwap().execute(
            torch.rand(2, 64, 64, 3), 'inswapper_128.onnx', '512x512', 0,
            source_image=torch.rand(1, 64, 64, 3))
        raise AssertionError('expected ValueError when nothing was swapped')
    except ValueError as e:
        assert 'no target face' in str(e)


if __name__ == '__main__':
    test_missing_source_face_raises()
    test_no_target_face_in_any_frame_raises()
    print('node OK')
