"""Multi-character face swap over a whole clip, plus the face detector that
feeds the app's swap picker.

Three things separate this from `node.py`'s image swap, and all three only
matter once there is more than one frame: faces are matched to characters by
identity rather than by index, landmarks are smoothed across frames so the swap
stops flickering, and an occlusion mask keeps whatever is in front of the face in
front of it.
"""
import os
import re

import cv2
import numpy as np
import torch

import comfy.utils
import folder_paths

if __package__:
    from . import swap_math, swapper
    from .node import (_analyser, _from_bgr, _resolve_model, _source_face,
                       _swap_face, _swap_model_files, _to_bgr)
else:  # direct execution outside the package (tests)
    import swap_math
    import swapper
    from node import (_analyser, _from_bgr, _resolve_model, _source_face,
                      _swap_face, _swap_model_files, _to_bgr)

# Character slots. Four, matching the app's LoRA-slot convention; a fifth would
# be three node inputs, a picker row and a form field for a case nobody has hit.
MAX_CHARACTERS = 4

# FaceFusion's occlusion segmenter lives in its own models dir, so its filename
# can never collide with a swapper's.
_OCCLUDER_DIR = 'facefusion'

# The "no occlusion mask" choice. A combo of installed files rather than a
# boolean, so /object_info answers "is the occluder downloaded?" through the
# same mechanism the app already uses for swap models, LoRAs and face models —
# a boolean would have needed its own disk-probing endpoint to avoid offering a
# toggle that just raises. ComfyUI re-evaluates INPUT_TYPES per request, so a
# freshly downloaded model appears without a restart.
OCCLUSION_OFF = 'off'

# The gate (`gate` input): where the swapper cannot work, the original face
# stays. Taken from the owner's Video Helper (tools/swap/refine.py, "the rule
# is perfect"), measured there on H3 takes: drinking — a vial over the mouth,
# head turned 35-43°, detector score 0.5-0.6 — bent her nose and eyes, while a
# head thrown back but facing the camera (score 0.78-0.90) swapped fine.
GATE_SCORE = 0.65
# The helper reads 33° off MediaPipe, which the ComfyUI env does not have.
# 1k3d68 (in buffalo_l already) reads turns wider: 37 here flagged the same
# frames as MediaPipe's 33 on 99.4% of 651 frames from 12 helper takes, none
# missed (2026-10-26). It also sees near-profiles MediaPipe finds no face in
# at all, which the helper therefore swapped; those are exactly the turned
# heads the rule is for.
GATE_YAW = 37.0


def occluder_files(names=None):
    """`off` plus whatever occluders are installed. `names` is injectable for tests."""
    if names is None:
        d = os.path.join(folder_paths.models_dir, _OCCLUDER_DIR)
        names = sorted(f for f in os.listdir(d) if f.endswith('.onnx')) if os.path.isdir(d) else []
    return [OCCLUSION_OFF] + list(names)


def _occluder_path(filename):
    p = os.path.join(folder_paths.models_dir, _OCCLUDER_DIR, filename)
    if not os.path.exists(p):
        raise FileNotFoundError(
            f'occlusion is set to {filename}, which is not in models/{_OCCLUDER_DIR}/ — '
            'download it from the Models page, or set occlusion to off')
    return p


def default_video_model(files=None):
    """Preferred swapper for video, falling back to whatever is installed.

    alphaface over inswapper on two counts. Cost: pixel boost runs
    `(boost / model_size)^2` passes per face per frame, so a 256px model at 512
    boost is 4 passes against inswapper_128's 16 — a 4x difference paid on every
    frame. Quality: it is the off-angle-robust one, and a clip is mostly faces
    that are not looking at the camera. inswapper still wins likeness on frontal
    stills (0.868 vs 0.851, measured 2026-09-05), which is why it stays the image
    default and not this one.

    `files` is injectable so the preference order is testable without the models
    on disk.
    """
    files = _swap_model_files() if files is None else files
    for preferred in ('alphaface_256.onnx', 'hyperswap_1c_256.onnx'):
        if preferred in files:
            return preferred
    return files[0]


def assign_faces(faces, ref_embeddings, threshold, tracked=None):
    """Pair detected faces to character references by arcface similarity.

    Returns `[(face_index, character_index)]` — each face and each character used
    at most once, best match first.

    Why this and not a face index: position order (left-to-right, or ReActor's
    largest-first) reorders itself mid-clip the moment characters move, cross or
    leave frame, and the swap then jumps to the wrong person for a stretch.
    Identity is stable through all of that.

    Greedy over the whole similarity matrix rather than an argmax per face, so
    two faces that both resemble one reference cannot both claim it: the better
    match takes it, and the other is left for its own reference or dropped.

    **`tracked` is what makes this work on real footage.** Measured on an 8 s H3
    clip (2026-09-07): the SAME character scores anywhere from 0.13 to 0.98
    against a single reference taken from its own middle frame, because generated
    video drifts the face — hardest across shot cuts. A static reference
    therefore drops the character into the same similarity band as a stranger,
    and half the clip goes unswapped, which reads as the face flickering between
    two identities and is worse than not swapping at all.

    So each character also carries the embedding it matched in the PREVIOUS
    frame, and a face need only resemble either. One hop, re-anchored every
    frame: consecutive frames really are the same face, so the chain is sound,
    while a stranger resembles neither the reference nor the last match and is
    still rejected. Discrimination between two configured characters improves
    too — each is compared against a recent view of itself rather than a stale one.
    """
    if not faces or not ref_embeddings:
        return []
    tracked = tracked or {}
    sims = np.array([[max(swap_math.cosine(f.embedding, ref_embeddings[c]),
                          swap_math.cosine(f.embedding, tracked[c]) if c in tracked else -1.0)
                      for c in range(len(ref_embeddings))]
                     for f in faces], dtype=np.float32)
    pairs = []
    for _ in range(min(len(faces), len(ref_embeddings))):
        fi, ci = np.unravel_index(int(np.argmax(sims)), sims.shape)
        # 0 means "take the best face": arcface cosine is signed, and a stranger
        # (Edit's still-original person against the new face) sits around and
        # below 0, so a literal `< 0` test would drop it frame by frame.
        if threshold > 0 and sims[fi, ci] < threshold:
            break
        pairs.append((int(fi), int(ci)))
        sims[fi, :] = -2.0
        sims[:, ci] = -2.0
    return pairs


def frame_at(position, frame_count):
    """Batch index for a 0..1 position through a clip, clamped into the batch.

    Clamped rather than trusted: a caller reading `currentTime / duration` off a
    <video> can hand over 1.0000001 at the very end, and an out-of-range index
    would silently pick the wrong frame rather than fail.
    """
    if frame_count <= 1:
        return 0
    return int(min(max(round(float(position) * (frame_count - 1)), 0), frame_count - 1))


def safe_stem(name):
    """Filename stem from caller-supplied text.

    This value becomes a path we write to, so everything outside [A-Za-z0-9_-]
    goes: a prefix carrying `..` or a separator would otherwise write outside
    ComfyUI's input directory.
    """
    stem = re.sub(r'[^A-Za-z0-9_-]', '', str(name))[:64]
    return stem or 'raccoon_ref'


class RaccoonVideoFaceSwap:
    CATEGORY = 'RaccoonStudio'
    FUNCTION = 'execute'
    RETURN_TYPES = ('IMAGE',)
    # So the per-character coverage report reaches /history, where the app shows
    # it. Without it a two-second turn-away and a broken swap look identical.
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for i in range(1, MAX_CHARACTERS + 1):
            optional[f'reference_{i}'] = ('IMAGE',)
            optional[f'face_model_{i}'] = ('FACE_MODEL',)
            optional[f'source_image_{i}'] = ('IMAGE',)
        return {
            'required': {
                'image': ('IMAGE',),
                'pixel_boost': (['512x512', '768x768', '1024x1024'], {'default': '512x512'}),
                'identity': ('FLOAT', {'default': swapper.IDENTITY_NEUTRAL,
                                       'min': 0.0, 'max': 1.0, 'step': 0.05}),
                # Same-person arcface cosine within one clip runs high (the face
                # is literally the same render); different people sit near 0.
                # 0.3 is a floor that separates them without dropping a face that
                # has turned or fallen into shadow.
                'match_threshold': ('FLOAT', {'default': 0.3, 'min': 0.0, 'max': 1.0, 'step': 0.05}),
                # Below the analyzer's own 0.5 default, on purpose: a
                # three-quarter turn scores under 0.5 and vanishes, and a frame
                # that silently goes unswapped mid-clip reads as a broken swap.
                # Extra detections are cheap here in a way they are not for the
                # image node — a false positive matches no reference and is
                # dropped, instead of shifting a face index.
                'min_score': ('FLOAT', {'default': 0.4, 'min': 0.1, 'max': 0.9, 'step': 0.05}),
                'smooth': ('FLOAT', {'default': 0.4, 'min': 0.0, 'max': 0.9, 'step': 0.1}),
                # Off by default: the model is an optional download, and a
                # builder must never name a file that is not on disk.
                'occlusion': (occluder_files(), {'default': OCCLUSION_OFF}),
            },
            # `swap_model` is OPTIONAL, and that is load-bearing rather than lax.
            # A graph posted through /prompt carries no widget values, so a
            # *required* input the caller omits is rejected outright with
            # `required_input_missing` — and the caller cannot sensibly fill this
            # one, because it must never name a file that is not on disk. Leaving
            # it optional lets the node read the disk itself. (Caught by the live
            # schema check, 2026-09-07; the GUI still shows it as a widget.)
            'optional': {
                'swap_model': (_swap_model_files(),),
                # Off for a swap spliced into a longer render (H3 Edit): there a
                # clip with no matching face is delivered unswapped with a note,
                # instead of throwing away minutes of work at the last node.
                'strict': ('BOOLEAN', {'default': True}),
                # Keep the original face where the swap cannot work: an unsure
                # detection (something in front of the face) or a head turned
                # past GATE_YAW, faded in and out. The app turns it on for a
                # clip rendered with "Swap faces first" only.
                'gate': ('BOOLEAN', {'default': False}),
                **optional,
            },
        }

    def execute(self, image, pixel_boost, identity, match_threshold,
                min_score, smooth, occlusion, swap_model=None, strict=True, gate=False, **slots):
        swap_model = swap_model or default_video_model()
        cfg = swapper.model_config(swap_model)
        boost = int(pixel_boost.split('x')[0])
        model_path = _resolve_model(swap_model)
        occluder = None if occlusion in (OCCLUSION_OFF, None, '') else _occluder_path(occlusion)
        mask = swap_math.box_mask(boost)

        # Resolve the slots BEFORE loading the swapper: every way this can be
        # misconfigured is knowable here, and a bad slot should not cost the user
        # a multi-second ONNX load first.
        characters = self._characters(slots, model_path, cfg)
        if not characters:
            raise ValueError('RaccoonVideoFaceSwap: no character slots are filled — '
                             'each one needs a reference plus a face model or photo')
        session = swapper.get_session(model_path)

        total = int(image.shape[0])
        # ponytail: the whole clip is one float32 batch, so peak RAM is ~2x it
        # (~6 GB for 243 frames at 768x1344, more once RIFE and the upscale have
        # run). Swap VHS_LoadVideoPath + VHS_BatchManager in if that ceiling is
        # ever hit — the swap is per-frame stateless apart from the landmark EMA,
        # so chunking costs a couple of frames of smoothing at each seam.
        out = torch.empty_like(image)
        counts = [0] * len(characters)
        smoothed = {}
        # Each character's embedding from the previous frame — see `assign_faces`
        # for why a static reference alone leaves half a clip unswapped.
        tracked = {}
        ref_embeddings = [c['ref_embedding'] for c in characters]
        # Per-frame progress. Without it the app's queue bar sits at zero for the
        # whole job, because this is ONE ComfyUI node and ComfyUI reports
        # progress per node — a several-minute swap of a long clip is then
        # indistinguishable from a hung one.
        # Two passes over the frames: find and track the faces first, swap
        # second, because the gate's fade has to see a risky frame coming.
        pbar = comfy.utils.ProgressBar(2 * total)
        plan = []  # per frame: [(character, face embedding, smoothed kps)]
        risky = np.zeros((total, len(characters)), dtype=bool)

        for i in range(total):
            frame = _to_bgr(image, i)
            # Every target face needs its embedding: that is what the character
            # matching runs on, so there is no detection-only fast path here the
            # way the image node has one.
            faces = _analyser().get(frame, with_embedding=True, min_score=min_score)
            matched = assign_faces(faces, ref_embeddings, match_threshold, tracked)
            # Anchor on the PRE-swap embeddings: after the swap the face is the
            # replacement identity, and tracking that would compare the next
            # frame's generated face against the wrong person entirely.
            for fi, ci in matched:
                tracked[ci] = faces[fi].embedding
            # A character absent this frame loses its anchor, so a later
            # re-appearance has to earn the match against the user's reference
            # rather than against a stale hop from before it left.
            for ci in [c for c in tracked if c not in {m[1] for m in matched}]:
                del tracked[ci]
            row = []
            for fi, ci in matched:
                face = faces[fi]
                kps = swap_math.smooth_kps(smoothed.get(ci),
                                           np.asarray(face.kps, dtype=np.float32), smooth)
                smoothed[ci] = kps
                row.append((ci, face.embedding, kps))
                if gate:
                    risky[i, ci] = face.det_score < GATE_SCORE or self._turned(frame, face)
            if gate:
                # Absent counts as risky too, so the swap fades in after a
                # character appears instead of popping on with them.
                for ci in set(range(len(characters))) - {m[1] for m in matched}:
                    risky[i, ci] = True
            plan.append(row)
            pbar.update(1)

        weights = (np.stack([swap_math.gate_weights(risky[:, c]) for c in range(len(characters))], axis=1)
                   if gate else np.ones((total, len(characters)), dtype=np.float32))
        kept = [0] * len(characters)
        for i in range(total):
            frame = _to_bgr(image, i)
            for ci, face_embedding, kps in plan[i]:
                w = float(weights[i, ci])
                if w <= 0:
                    kept[ci] += 1
                    continue
                emb = swapper.balance_embedding(characters[ci]['embedding'], cfg['kind'],
                                                face_embedding, identity)
                swapped = _swap_face(frame, kps, session, cfg, boost, emb, mask, occluder)
                if swapped is None:  # degenerate landmarks — leave this face alone
                    continue
                # Chain onto the swapped frame, so two characters in one shot do
                # not each composite over the other's work. Outside the face the
                # two frames are the same, so a whole-frame blend is the face's.
                frame = swapped if w >= 1 else cv2.addWeighted(swapped, w, frame, 1 - w, 0)
                counts[ci] += 1
            out[i] = _from_bgr(frame)
            pbar.update(1)

        if any(kept) and not any(counts):
            report = f'{total} frames · the original face kept on every frame (turned or covered)'
            print(f'[RaccoonSwapNodes] {report}')
            return {'ui': {'text': [report]}, 'result': (image,)}
        if not any(counts) and not strict:
            report = f'{total} frames · no face matched — clip left unswapped'
            print(f'[RaccoonSwapNodes] {report}')
            return {'ui': {'text': [report]}, 'result': (image,)}
        if not any(counts):
            raise ValueError(
                'RaccoonVideoFaceSwap: no reference matched any face in the clip — '
                'pick the reference faces from a frame of THIS video, or lower '
                'match_threshold')
        report = ' · '.join([f'{total} frames'] +
                            [f"slot {c['slot']}: {n}/{total}" + (f' (original kept on {k})' if k else '')
                             for c, n, k in zip(characters, counts, kept)])
        print(f'[RaccoonSwapNodes] {report}')
        return {'ui': {'text': [report]}, 'result': (out,)}

    _warned_no_yaw = False

    def _turned(self, frame, face):
        """Head turned past GATE_YAW. Without 1k3d68 on disk the gate still
        runs on the detector score alone — said once, not per frame."""
        points = _analyser().landmarks3d(frame, face.bbox)
        if points is None:
            if not RaccoonVideoFaceSwap._warned_no_yaw:
                print('[RaccoonSwapNodes] buffalo_l has no 1k3d68.onnx: the gate skips the head-turn check')
                RaccoonVideoFaceSwap._warned_no_yaw = True
            return False
        return abs(swap_math.head_yaw(points)) > GATE_YAW

    def _characters(self, slots, model_path, cfg):
        """Resolve the filled slots into `{slot, ref_embedding, embedding}`.

        A half-filled slot is an error, never a skip. Ignoring one renders a clip
        that looks like a success and still has the wrong face in it — the most
        expensive silent failure here, because the only way to notice is to watch
        the whole thing.
        """
        characters = []
        for i in range(1, MAX_CHARACTERS + 1):
            reference = slots.get(f'reference_{i}')
            face_model = slots.get(f'face_model_{i}')
            source_image = slots.get(f'source_image_{i}')
            if reference is None and face_model is None and source_image is None:
                continue
            if reference is None:
                raise ValueError(
                    f'RaccoonVideoFaceSwap: slot {i} has a replacement face but no reference — '
                    'the reference is what says WHICH face in the video to replace, so it '
                    'cannot be inferred')
            ref_faces = _analyser().get(_to_bgr(reference), with_embedding=True)
            if not ref_faces:
                raise ValueError(f'RaccoonVideoFaceSwap: no face found in reference {i} — '
                                 'pick a frame where that character is clearly visible')
            ref = max(ref_faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            src = _source_face(face_model, source_image, f'RaccoonVideoFaceSwap slot {i}')
            characters.append({
                'slot': i,
                'ref_embedding': ref.embedding,
                'embedding': swapper.source_embedding(model_path, cfg['kind'], src),
            })
        return characters



# Fraction of the lowest face's height kept below the chin, so a collar or a
# strap that starts right under the jaw is not cut off with the head.
HEADLESS_MARGIN = 0.10
# Below this many rows there is no garment left to show, so the picture goes
# through whole: a face-only portrait as an "outfit" is a user error the
# render will make visible, not one this node can fix by sending 20 rows.
HEADLESS_MIN_ROWS = 96


def headless_crop(frame_bgr, faces):
    """Rows below the lowest detected chin, or the frame itself if none is found.

    One crop, not a mask: H3 sees whatever is in the picture, and a blurred or
    blacked-out head is still a head-shaped thing in the reference.
    """
    if not faces:
        return frame_bgr
    h = frame_bgr.shape[0]
    chin = max(float(f.bbox[3]) for f in faces)
    tallest = max(float(f.bbox[3] - f.bbox[1]) for f in faces)
    y0 = min(h, int(round(chin + tallest * HEADLESS_MARGIN)))
    if h - y0 < HEADLESS_MIN_ROWS:
        return frame_bgr
    return frame_bgr[y0:]


class RaccoonHeadlessReference:
    """A reference picture with its face(s) cropped away.

    For MiniMax H3 outfit and prop references. Measured 2026-09-13 with the same
    seed throughout: an outfit picture showing someone WEARING the outfit
    carries a second identity, and with two pictures of that person against one
    of the character, H3 rendered that person — no prompt wording moved it. The
    same picture cropped below the chin rendered the character in the outfit.
    A picture with no face passes through unchanged, so wiring this in front of
    every outfit/prop slot costs nothing when the user already sent a garment.
    """

    CATEGORY = 'RaccoonStudio'
    FUNCTION = 'execute'
    RETURN_TYPES = ('IMAGE',)
    RETURN_NAMES = ('image',)

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'image': ('IMAGE',)}}

    def execute(self, image):
        out = []
        for i in range(int(image.shape[0])):
            frame = _to_bgr(image, i)
            faces = _analyser().get(frame, with_embedding=False, min_score=0.4)
            out.append(_from_bgr(np.ascontiguousarray(headless_crop(frame, faces))))
        # Frames may now differ in height (they will not in practice: a batch
        # here is one still), so stack only when they agree.
        if len({tuple(o.shape) for o in out}) == 1:
            return (torch.stack(out),)
        return (out[0].unsqueeze(0),)

class RaccoonDetectFaces:
    """Detect the faces in one frame and write them out as crops.

    Feeds the app's swap picker: the crops are both the thumbnails a human picks
    from and the reference images the matcher embeds, so what you clicked on is
    literally what the swap matches against.
    """

    CATEGORY = 'RaccoonStudio'
    FUNCTION = 'execute'
    RETURN_TYPES = ()
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'image': ('IMAGE',),
                # A fraction of the clip rather than a frame number, because the
                # caller is a scrubber and does not know the frame rate: a
                # position maps straight off currentTime/duration, while a frame
                # index would need an fps the app cannot see (H3 pins 24, RIFE
                # makes it 36, LTX varies). ImageFromBatch would not have helped
                # — GetVideoComponents decodes the whole clip either way, so
                # picking here costs nothing and removes a node.
                'position': ('FLOAT', {'default': 0.5, 'min': 0.0, 'max': 1.0, 'step': 0.01}),
                'name_prefix': ('STRING', {'default': 'raccoon_ref'}),
                'max_faces': ('INT', {'default': MAX_CHARACTERS, 'min': 1, 'max': 8}),
                'min_score': ('FLOAT', {'default': 0.4, 'min': 0.1, 'max': 0.9, 'step': 0.05}),
            },
        }

    def execute(self, image, position, name_prefix, max_faces, min_score):
        frame = _to_bgr(image, frame_at(position, int(image.shape[0])))
        # Left-to-right, so the thumbnail order matches what is on screen.
        faces = sorted(_analyser().get(frame, with_embedding=False, min_score=min_score),
                       key=lambda f: f.bbox[0])[:max_faces]
        if not faces:
            raise ValueError('RaccoonDetectFaces: no face found in this frame — '
                             'scrub to one where a face is clearly visible')

        # Written into ComfyUI's INPUT dir rather than temp: the swap graph then
        # reads each crop back through a plain LoadImage with no annotation, and
        # temp is cleared on restart while a picker session can outlive one.
        out_dir = folder_paths.get_input_directory()
        stem = safe_stem(name_prefix)
        images = []
        for i, face in enumerate(faces):
            filename = f'{stem}_{i}.png'
            cv2.imwrite(os.path.join(out_dir, filename), swap_math.loose_crop(frame, face.bbox))
            images.append({'filename': filename, 'subfolder': '', 'type': 'input'})
        return {'ui': {'images': images}}
