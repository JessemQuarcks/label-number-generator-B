"""Image I/O helpers: data URLs <-> PIL, mask normalisation, model-friendly resizing."""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import math
import re

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from .errors import bad_request

MAX_INPUT_SIDE = 4096
# Guard against decompression bombs; we also check the header size before decoding.
Image.MAX_IMAGE_PIXELS = MAX_INPUT_SIDE * MAX_INPUT_SIDE * 2

_DATA_URL_RE = re.compile(r"^data:(?P<mime>[\w.+-]+/[\w.+-]+)?(?P<params>(;[\w.+-]+=[\w.+-]+)*)(?P<b64>;base64)?,", re.I)
ACCEPTED_MIME = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
_ACCEPTED_FORMATS = {"PNG", "JPEG", "WEBP", "MPO"}  # MPO = multi-picture JPEG from some cameras


# --------------------------------------------------------------------------- decoding


def decode_data_url(value: str, field: str = "image") -> bytes:
    """Return the raw bytes of a ``data:image/...;base64,`` URL (400 on bad input)."""
    if not isinstance(value, str) or not value:
        raise bad_request(f"'{field}' must be a data URL string")
    m = _DATA_URL_RE.match(value)
    if not m:
        raise bad_request(f"'{field}' must be a data URL like data:image/png;base64,...")
    mime = (m.group("mime") or "").lower()
    if mime not in ACCEPTED_MIME:
        raise bad_request(f"'{field}' has unsupported type {mime or '(none)'}; use png, jpeg or webp")
    if not m.group("b64"):
        raise bad_request(f"'{field}' must be base64 encoded")
    payload = value[m.end():]
    try:
        return base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise bad_request(f"'{field}' is not valid base64: {exc}") from None


def _open_checked(data: bytes, field: str, max_side: int) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
    except Exception:
        raise bad_request(f"'{field}' could not be decoded as an image") from None
    if img.format not in _ACCEPTED_FORMATS:
        raise bad_request(f"'{field}' has unsupported image format {img.format}")
    w, h = img.size
    if w < 1 or h < 1:
        raise bad_request(f"'{field}' is empty")
    if w > max_side or h > max_side:
        raise bad_request(f"'{field}' is {w}x{h}; the maximum is {max_side} px per side")
    try:
        img.load()
    except Exception:
        raise bad_request(f"'{field}' could not be decoded as an image") from None
    # Respect EXIF orientation for camera JPEGs so pixel coordinates match what the browser shows.
    # (Browsers apply EXIF orientation when drawing images.)
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    return img


def decode_image(value: str, field: str = "image", max_side: int = MAX_INPUT_SIDE) -> Image.Image:
    """Decode a data URL to an RGB PIL image. Transparent pixels are composited on white."""
    img = _open_checked(decode_data_url(value, field), field, max_side)
    return to_rgb(img)


def to_rgb(img: Image.Image) -> Image.Image:
    if img.mode == "RGB":
        return img
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        bg.alpha_composite(rgba)
        return bg.convert("RGB")
    return img.convert("RGB")


def to_mask(img: Image.Image) -> Image.Image:
    """Normalise any image to an ``L`` mask.

    Grayscale value is used, except when the image has an alpha channel and its colour
    channels are uniform - then the alpha channel carries the mask (e.g. a canvas export of
    black strokes on a transparent background).
    """
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    if not has_alpha:
        return img.convert("L") if img.mode != "L" else img
    rgba = img.convert("RGBA")
    gray = rgba.convert("RGB").convert("L")
    lo, hi = gray.getextrema()
    if lo == hi:
        return rgba.getchannel("A")
    return gray


def decode_mask(value: str, size: tuple[int, int] | None = None, field: str = "mask",
                max_side: int = MAX_INPUT_SIDE) -> Image.Image:
    """Decode a mask data URL to mode ``L``; optionally resize it to ``size`` (w, h)."""
    mask = to_mask(_open_checked(decode_data_url(value, field), field, max_side))
    if size is not None and mask.size != tuple(size):
        mask = mask.resize(tuple(size), Image.BILINEAR)
    return mask


# --------------------------------------------------------------------------- encoding


def encode_png(img: Image.Image) -> str:
    """Encode a PIL image as a PNG data URL (RGB/RGBA/L kept as-is, other modes -> RGB)."""
    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=3)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def encode_mask(mask: Image.Image | np.ndarray, size: tuple[int, int] | None = None) -> str:
    """Encode a mask (PIL or array) as an ``L`` PNG data URL, resized to ``size`` if given."""
    if not isinstance(mask, Image.Image):
        mask = mask_from_array(mask)
    if mask.mode != "L":
        mask = to_mask(mask)
    if size is not None and mask.size != tuple(size):
        mask = mask.resize(tuple(size), Image.BILINEAR)
    return encode_png(mask)


# --------------------------------------------------------------------------- arrays


def mask_from_array(arr: np.ndarray) -> Image.Image:
    """Float arrays are treated as 0..1, bool as 0/1, integers as 0..255."""
    arr = np.asarray(arr)
    if arr.ndim == 3:
        arr = arr[..., 0] if arr.shape[-1] in (1, 3, 4) else arr[0]
    if arr.dtype == bool:
        arr = arr.astype(np.uint8) * 255
    elif np.issubdtype(arr.dtype, np.floating):
        arr = np.clip(np.nan_to_num(arr) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    else:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="L")


def mask_to_array(mask: Image.Image) -> np.ndarray:
    """``L`` mask -> float32 array in 0..1."""
    return np.asarray(to_mask(mask), dtype=np.float32) / 255.0


def image_hash(img: Image.Image) -> str:
    h = hashlib.sha1()
    h.update(f"{img.mode}{img.size}".encode())
    h.update(img.tobytes())
    return h.hexdigest()


# --------------------------------------------------------------------------- resizing


def round_to_multiple(value: float, multiple: int) -> int:
    return max(multiple, int(round(value / multiple)) * multiple)


def fit_size(width: int, height: int, *, max_side: int = 1024, multiple: int = 8,
             target_area: int | None = None) -> tuple[int, int]:
    """Compute a model-friendly size with (approximately) the same aspect ratio.

    * ``target_area`` - scale (up or down) so that w*h ~= target_area: diffusion models
      work best near their native resolution. Without it we only ever downscale.
    * The longest side is capped at ``max_side``; sides are multiples of ``multiple``.
    """
    scale = math.sqrt(target_area / float(width * height)) if target_area else 1.0
    scale = min(scale, max_side / float(max(width, height)))
    w = round_to_multiple(width * scale, multiple)
    h = round_to_multiple(height * scale, multiple)
    # Rounding may push us over max_side.
    cap = (max_side // multiple) * multiple
    if w > cap:
        w = cap
    if h > cap:
        h = cap
    return max(multiple, w), max(multiple, h)


def resize(img: Image.Image, size: tuple[int, int], resample=Image.LANCZOS) -> Image.Image:
    size = (int(size[0]), int(size[1]))
    if img.size == size:
        return img
    if img.mode in ("L", "1", "I", "F"):
        resample = Image.BILINEAR
    return img.resize(size, resample)


def resize_cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize preserving aspect ratio so the image covers ``size``, then center-crop."""
    tw, th = size
    w, h = img.size
    if (w, h) == (tw, th):
        return img
    scale = max(tw / w, th / h)
    nw, nh = max(tw, round(w * scale)), max(th, round(h * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def feather(mask: Image.Image, radius: float) -> Image.Image:
    if radius <= 0:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(radius))


def dilate(mask: Image.Image, pixels: int) -> Image.Image:
    """Grow the white area of an L mask by ``pixels`` (binary-ish masks)."""
    if pixels <= 0:
        return mask
    size = 2 * int(pixels) + 1
    return mask.filter(ImageFilter.MaxFilter(size if size <= 99 else 99))


def paste_back(original: Image.Image, generated: Image.Image, mask: Image.Image,
               feather_px: float = 2.0) -> Image.Image:
    """Keep ``original`` outside ``mask`` (soft blend), ``generated`` inside."""
    generated = resize(generated.convert("RGB"), original.size)
    m = mask if mask.size == original.size else mask.resize(original.size, Image.BILINEAR)
    m = feather(m, feather_px)
    return Image.composite(generated, original.convert("RGB"), m)


def bbox_of_mask(mask: np.ndarray, threshold: float = 0.5) -> tuple[int, int, int, int] | None:
    """Bounding box (x0, y0, x1, y1) exclusive of values > threshold, or None if empty."""
    ys, xs = np.nonzero(mask > threshold)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def expand_box(box: tuple[int, int, int, int], margin: int, width: int, height: int,
               min_size: int = 0) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = x0 - margin, y0 - margin, x1 + margin, y1 + margin
    if min_size:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        half = min_size / 2
        if x1 - x0 < min_size:
            x0, x1 = int(cx - half), int(cx + half)
        if y1 - y0 < min_size:
            y0, y1 = int(cy - half), int(cy + half)
    return max(0, x0), max(0, y0), min(width, x1), min(height, y1)
