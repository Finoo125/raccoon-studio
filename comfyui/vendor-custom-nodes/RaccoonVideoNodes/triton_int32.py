"""Keep comfy-kitchen's Triton kernels inside their int32 address range.

All 15 Triton kernels in comfy-kitchen (backends/triton/; 0.2.31, 0.2.36 and
upstream main on 2026-10-06) compute element offsets in int32 - there is no
`tl.int64` anywhere - so a call touching a tensor of more than 2**31 elements
addresses memory GiBs away from its buffer. Unmapped there: ComfyUI dies with
`cudaErrorIllegalAddress`. Mapped: the render reports success and the rows past
the edge come back as garbage - the END of a clip, as video tokens run in frame
order. Only reachable with `--enable-triton-backend` (the launcher's triton
tier). Measured 2026-10-06, the rest of the families peaking under 30%:

  H3 int8_linear (mlp.fc1, 28,672 wide) past 74,898 tokens: crash. A 15 s
    Continue at Medium (v1.3.3), any 15 s High clip.
  LTX quantize_per_tensor_fp8 (ff, 16,384 wide) past 131,072 rows: SILENT.
    A 20 s High clip rendered "success" and dissolved from 84% of its length.
    ~17 s at High/30 fps; half that when ComfyUI batches cond+uncond.

Every function the triton backend registers is wrapped. Under the limit a call
goes straight through. Above it, the row-wise hot paths run in row chunks on
Triton; anything else runs once on comfy-kitchen's eager backend (PyTorch,
64-bit indexing, the same functions with the same signatures).

ponytail: shim for an upstream bug - delete once the kernels index in int64.
`python triton_int32.py` - GPU self-check.
"""
import inspect

_LIMIT = 2**31 - 1
_CHUNK = 16384  # rows per launch: bounds the extra VRAM to one chunk's output
_ROWWISE = {"int8_linear", "quantize_per_tensor_fp8", "dequantize_per_tensor_fp8"}
_noted = set()


def _span(t):
    """Elements between a tensor's first and last addressed element."""
    if not hasattr(t, "stride") or t.numel() == 0:
        return 0
    return sum((s - 1) * abs(st) for s, st in zip(t.shape, t.stride())) + 1


def _reach(name, a):
    """The largest element offset the kernel will compute for these arguments."""
    big = max((_span(v) for v in a.values()), default=0)
    x, w = a.get("x"), a.get("weight", a.get("qdata"))
    if name.endswith("int8_linear") and x is not None and w is not None and x.numel():
        big = max(big, x.numel() // x.shape[-1] * w.shape[0])  # its [rows, N] output
    if name == "dequantize_nvfp4":
        big *= 2  # unpacks two values from every stored byte
    return big


def _rows(fn, a):
    """Run a row-wise function over `x` in chunks that each fit int32."""
    x, w = a["x"], a.get("weight")
    width = max(x.shape[-1], w.shape[0] if w is not None else 0)
    rows = max(1, min(_CHUNK, _LIMIT // width))
    m = x.numel() // x.shape[-1]
    x2 = x.reshape(m, x.shape[-1])
    res = a.get("residual")
    res2 = None if res is None else res.reshape(m, res.shape[-1])
    out = None
    for i in range(0, m, rows):
        part = dict(a, x=x2[i:i + rows])
        if res2 is not None:
            part["residual"] = res2[i:i + rows]
        y = fn(**part)
        if out is None:
            out = y.new_empty((m, y.shape[-1]))
        out[i:i + y.shape[0]] = y
    return out.reshape(*x.shape[:-1], out.shape[-1])


def _guard(name, fn, eager):
    sig = inspect.signature(fn)

    def guarded(*args, **kw):
        a = sig.bind(*args, **kw).arguments if args else kw  # the registry passes kwargs
        if _reach(name, a) <= _LIMIT:
            return fn(*args, **kw)
        chunk = name in _ROWWISE and a["x"].dim() >= 2
        if name not in _noted:
            _noted.add(name)
            print("[RaccoonVideo] %s past the int32 limit -> %s" % (name, "row chunks" if chunk else "eager backend"))
        return _rows(fn, a) if chunk else eager(*args, **kw)

    guarded._raccoon_int32 = True
    return guarded


def install():
    """Wrap the triton backend's functions in place; returns how many. The
    registry resolves each with getattr on every call, so this takes effect
    for every later dispatch. A no-op where Triton is not importable."""
    try:
        import comfy_kitchen.backends.triton as tb
        import comfy_kitchen.backends.eager as eb
    except Exception:
        return 0
    n = 0
    for name in getattr(tb, "__all__", ()):
        fn, eager = getattr(tb, name, None), getattr(eb, name, None)
        if callable(fn) and callable(eager) and not getattr(fn, "_raccoon_int32", False):
            setattr(tb, name, _guard(name, fn, eager))
            n += 1
    return n


if __name__ == "__main__":
    import sys
    import torch
    import comfy_kitchen as ck
    import comfy_kitchen.backends.triton as tb
    from comfy_kitchen.backends.eager.quantization import DTYPE_TO_CODE

    assert torch.cuda.is_available(), "needs an NVIDIA GPU"
    ck.registry.disable("cuda")  # what ComfyUI does below cu130, so triton serves
    raw = {n: getattr(tb, n) for n in tb.__all__ if callable(getattr(tb, n, None))}
    assert install() == len(raw), "every triton function must be wrapped"
    assert install() == 0, "install() must be idempotent"
    dev, bf = "cuda", torch.bfloat16
    torch.manual_seed(0)

    # 1. Each path's logic, with the limit shrunk so small tensors take it.
    _LIMIT = 1 << 20
    x = torch.randn(300, 4096, device=dev, dtype=bf)
    w = torch.randint(-127, 128, (512, 4096), device=dev, dtype=torch.int8)
    s = torch.tensor([0.01], device=dev)
    kw = dict(x=x, weight=w, weight_scale=s, out_dtype=bf)
    assert torch.equal(tb.int8_linear(**kw), raw["int8_linear"](**kw)), "int8_linear chunks"
    fp8 = tb.quantize_per_tensor_fp8(x=x, scale=s)
    assert torch.equal(fp8.view(torch.uint8), raw["quantize_per_tensor_fp8"](x=x, scale=s).view(torch.uint8)), "fp8 chunks"
    assert torch.equal(tb.dequantize_per_tensor_fp8(x=fp8, scale=s), raw["dequantize_per_tensor_fp8"](x=fp8, scale=s)), "dequant chunks"
    sc, sh = torch.randn(1, 4096, device=dev, dtype=bf), torch.randn(1, 4096, device=dev, dtype=bf)
    got, ref = tb.adaln(x, sc, sh), raw["adaln"](x, sc, sh)  # positional on purpose: the bind path
    # same maths, eager rounds through bf16: 0.3% off an fp32 reference vs triton's 0.17%
    assert ((got.float() - ref.float()).norm() / ref.float().norm()).item() < 0.01, "adaln eager fallback"
    assert {"int8_linear", "quantize_per_tensor_fp8", "dequantize_per_tensor_fp8", "adaln"} <= _noted
    _LIMIT = 2**31 - 1
    print("paths: ok")

    # 2. The two failures measured live, at their real sizes, through ComfyUI's dispatch.
    w = torch.randint(-127, 128, (28672, 5376), device=dev, dtype=torch.int8)  # H3 mlp.fc1
    x = torch.randn(1, 84000, 5376, device=dev, dtype=bf)  # 9k rows past 74,898
    out = torch.ops.comfy_kitchen.int8_linear(x, w, s, None, DTYPE_TO_CODE[bf])
    ref = (x[0, -64:].float() @ w.float().T) * 0.01
    assert ((out[0, -64:].float() - ref).norm() / ref.norm()).item() < 0.02, "H3 int8_linear tail"
    del x, w, out
    x = torch.randn(140000, 16384, device=dev, dtype=bf)  # LTX ff input, 2.29e9 elements
    q = ck.quantize_per_tensor_fp8(x, s)
    assert torch.equal(q[-64:].view(torch.uint8), raw["quantize_per_tensor_fp8"](x=x[-64:], scale=s).view(torch.uint8)), "LTX fp8 tail"
    print("real sizes: ok")
    print("triton_int32: all checks passed")
    sys.exit(0)
