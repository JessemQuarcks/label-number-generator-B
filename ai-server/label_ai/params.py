"""Request parameter validation. Produces normalised params with decoded PIL images.

Validation happens in the request handler (before a job is queued) so bad input is
reported as HTTP 400 immediately.
"""

from __future__ import annotations

import math
import secrets
from typing import Any

from .errors import bad_request
from .imageio import MAX_INPUT_SIDE, decode_image, decode_mask

MAX_COUNT = 4
MAX_PROMPT = 4000
MIN_GEN_SIDE, MAX_GEN_SIDE = 64, 2048
MAX_SEED = 2**32 - 1


def _int(params: dict, key: str, default=None, *, lo=None, hi=None, required=False):
    v = params.get(key)
    if v is None:
        if required:
            raise bad_request(f"'{key}' is required")
        return default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not v.is_integer()):
        raise bad_request(f"'{key}' must be an integer")
    v = int(v)
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise bad_request(f"'{key}' must be between {lo} and {hi}")
    return v


def _float(params: dict, key: str, default=None, *, lo=None, hi=None, lo_exclusive=False):
    v = params.get(key)
    if v is None:
        return default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise bad_request(f"'{key}' must be a number")
    v = float(v)
    if lo is not None and (v < lo or (lo_exclusive and v == lo)):
        raise bad_request(f"'{key}' must be {'>' if lo_exclusive else '>='} {lo}")
    if hi is not None and v > hi:
        raise bad_request(f"'{key}' must be <= {hi}")
    return v


def _str(params: dict, key: str, default=None, *, required=False, allow_empty=False):
    v = params.get(key)
    if v is None:
        if required:
            raise bad_request(f"'{key}' is required")
        return default
    if not isinstance(v, str):
        raise bad_request(f"'{key}' must be a string")
    v = v.strip()
    if required and not v and not allow_empty:
        raise bad_request(f"'{key}' must not be empty")
    if len(v) > MAX_PROMPT:
        raise bad_request(f"'{key}' is too long (max {MAX_PROMPT} characters)")
    return v


def _bool(params: dict, key: str, default=None):
    v = params.get(key)
    if v is None:
        return default
    if not isinstance(v, bool):
        raise bad_request(f"'{key}' must be a boolean")
    return v


def _image(params: dict) -> Any:
    if params.get("image") is None:
        raise bad_request("'image' is required")
    return decode_image(params["image"], "image", MAX_INPUT_SIDE)


def _mask(params: dict, size) -> Any:
    if params.get("mask") is None:
        raise bad_request("'mask' is required")
    return decode_mask(params["mask"], size, "mask", MAX_INPUT_SIDE)


def _num(v, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise bad_request(f"{what} must be a finite number")
    return float(v)


def _points(params: dict, w: int, h: int) -> list[dict]:
    raw = params.get("points")
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise bad_request("'points' must be a list of {x, y, label}")
    if len(raw) > 64:
        raise bad_request("too many points (max 64)")
    out = []
    for i, p in enumerate(raw):
        if not isinstance(p, dict):
            raise bad_request(f"points[{i}] must be an object {{x, y, label}}")
        x = min(max(_num(p.get("x"), f"points[{i}].x"), 0.0), w - 1.0)
        y = min(max(_num(p.get("y"), f"points[{i}].y"), 0.0), h - 1.0)
        label = p.get("label", 1)
        if isinstance(label, bool) or label not in (0, 1):
            raise bad_request(f"points[{i}].label must be 0 (background) or 1 (foreground)")
        out.append({"x": x, "y": y, "label": int(label)})
    return out


def _boxes(params: dict, w: int, h: int) -> list[list[float]]:
    raw = params.get("boxes")
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise bad_request("'boxes' must be a list of [x0, y0, x1, y1]")
    if len(raw) > 32:
        raise bad_request("too many boxes (max 32)")
    out = []
    for i, b in enumerate(raw):
        if not isinstance(b, (list, tuple)) or len(b) != 4:
            raise bad_request(f"boxes[{i}] must be [x0, y0, x1, y1]")
        x0, y0, x1, y1 = (_num(v, f"boxes[{i}]") for v in b)
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        x0, x1 = min(max(x0, 0.0), float(w)), min(max(x1, 0.0), float(w))
        y0, y1 = min(max(y0, 0.0), float(h)), min(max(y1, 0.0), float(h))
        if x1 - x0 < 1 or y1 - y0 < 1:
            raise bad_request(f"boxes[{i}] is empty or outside the image")
        out.append([x0, y0, x1, y1])
    return out


def _gen_common(params: dict, out: dict) -> None:
    out["negative_prompt"] = _str(params, "negative_prompt", None)
    out["count"] = _int(params, "count", 1, lo=1, hi=MAX_COUNT)
    seed = _int(params, "seed", None, lo=0, hi=MAX_SEED)
    if seed is None:
        seed = secrets.randbelow(2**31)
    # seed, seed+1, ... for the requested count (wrapping within 32 bits)
    out["seed"] = seed
    out["seeds"] = [(seed + i) % (MAX_SEED + 1) for i in range(out["count"])]
    out["steps"] = _int(params, "steps", None, lo=1, hi=150)
    out["guidance"] = _float(params, "guidance", None, lo=0.0, hi=30.0)


def validate(capability: str, params: Any) -> dict[str, Any]:
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise bad_request("'params' must be an object")
    out: dict[str, Any] = {}

    if capability == "segment":
        img = out["image"] = _image(params)
        out["points"] = _points(params, *img.size)
        out["boxes"] = _boxes(params, *img.size)
        if not out["points"] and not out["boxes"]:
            raise bad_request("segment needs at least one point or box")
        out["multimask"] = _bool(params, "multimask", None)
    elif capability == "subject":
        out["image"] = _image(params)
    elif capability == "segment_text":
        out["image"] = _image(params)
        out["prompt"] = _str(params, "prompt", required=True)
        out["threshold"] = _float(params, "threshold", None, lo=0.0, hi=1.0)
    elif capability == "matte":
        img = out["image"] = _image(params)
        out["mask"] = _mask(params, img.size)
        out["radius"] = _int(params, "radius", None, lo=1, hi=512)
    elif capability == "remove":
        img = out["image"] = _image(params)
        out["mask"] = _mask(params, img.size)
    elif capability == "inpaint":
        img = out["image"] = _image(params)
        out["mask"] = _mask(params, img.size)
        out["prompt"] = _str(params, "prompt", required=True)
        _gen_common(params, out)
        out["strength"] = _float(params, "strength", None, lo=0.0, hi=1.0, lo_exclusive=True)
    elif capability == "generate":
        out["prompt"] = _str(params, "prompt", required=True)
        out["width"] = _int(params, "width", required=True, lo=MIN_GEN_SIDE, hi=MAX_GEN_SIDE)
        out["height"] = _int(params, "height", required=True, lo=MIN_GEN_SIDE, hi=MAX_GEN_SIDE)
        _gen_common(params, out)
    elif capability == "variations":
        out["image"] = _image(params)
        out["prompt"] = _str(params, "prompt", "") or ""
        out["strength"] = _float(params, "strength", 0.55, lo=0.0, hi=1.0, lo_exclusive=True)
        _gen_common(params, out)
    elif capability == "edit":
        out["image"] = _image(params)
        out["instruction"] = _str(params, "instruction", required=True)
        _gen_common(params, out)
    else:  # pragma: no cover - resolved earlier
        raise bad_request(f"unknown capability {capability!r}")
    return out


def output_size(capability: str, params: dict[str, Any]) -> tuple[int, int] | None:
    """The pixel size every image/mask in the response must have."""
    if capability == "generate":
        return params["width"], params["height"]
    img = params.get("image")
    return img.size if img is not None else None
