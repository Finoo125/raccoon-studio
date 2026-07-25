"""ONNX execution-provider selection, shared by the analyzer and the swapper.

Given a list, onnxruntime silently drops providers this build doesn't have, so a
hardcoded ['CUDAExecutionProvider', 'CPUExecutionProvider'] degrades to CPU with
no error and no log line. That is not hypothetical: installing both
`onnxruntime` and `onnxruntime-gpu` leaves one shared package directory whose
core DLL wins, orphaning the CUDA provider — an NVIDIA box then runs every swap
on the CPU while looking fine. Pick from what is actually available instead, so
the choice is inspectable (and the AMD/DirectML path costs nothing extra).
"""
import onnxruntime

# Fastest first. DirectML is the AMD-on-Windows path; ROCm/MIGraphX cover AMD on
# Linux. ROCm leads MIGraphX because it has far more field use on these models —
# flip that order once MIGraphX is proven, since AMD is deprecating the ROCm EP
# after ROCm 7.0. Windows-only and Linux-only EPs never coexist, so their
# relative order is academic.
_PREFERRED = (
    'CUDAExecutionProvider',
    'ROCMExecutionProvider',
    'MIGraphXExecutionProvider',
    'DmlExecutionProvider',
)


def pick_providers(available=None):
    """Best available execution provider, with CPU as the fallback.

    `available` is injectable so the preference order can be tested without the
    matching hardware; it defaults to what this onnxruntime build reports.
    """
    if available is None:
        available = onnxruntime.get_available_providers()
    for ep in _PREFERRED:
        if ep in available:
            return [ep, 'CPUExecutionProvider']
    return ['CPUExecutionProvider']
