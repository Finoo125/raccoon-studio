"""RaccoonSwapNodes — pixel-boost face swap, vendored with the repo."""
from .node import RaccoonPixelBoostSwap
from .video_node import RaccoonDetectFaces, RaccoonHeadlessReference, RaccoonVideoFaceSwap

NODE_CLASS_MAPPINGS = {
    'RaccoonPixelBoostSwap': RaccoonPixelBoostSwap,
    'RaccoonVideoFaceSwap': RaccoonVideoFaceSwap,
    'RaccoonDetectFaces': RaccoonDetectFaces,
    'RaccoonHeadlessReference': RaccoonHeadlessReference,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    'RaccoonPixelBoostSwap': 'Pixel Boost Face Swap 🦝',
    'RaccoonVideoFaceSwap': 'Video Face Swap 🦝',
    'RaccoonDetectFaces': 'Detect Faces 🦝',
    'RaccoonHeadlessReference': 'Reference Without Face 🦝',
}
