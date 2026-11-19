"""Classical (no-torch) adapters built on OpenCV + numpy.

They are real, CPU-only fallbacks so every capability that does not need generation works
with just the core requirements:

* ``grabcut``         segment       - GrabCut seeded from boxes / clicked points
* ``grabcut_center``  subject       - GrabCut seeded with an inset rectangle ("basic" subject)
* ``opencv_inpaint``  remove        - cv2.inpaint (Telea or Navier-Stokes)
* ``guided_filter``   matte         - colour guided filter (He et al.) on a trimap's unknown band
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from ..imageio import mask_from_array, mask_to_array
from ..registry import register_adapter
from .base import Adapter, RunContext


def _cv2():
    import cv2

    return cv2


def _work_scale(w: int, h: int, max_side: int) -> float:
    return min(1.0, max_side / float(max(w, h)))


def _to_bgr(img: Image.Image, scale: float) -> np.ndarray:
    cv2 = _cv2()
    if scale < 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    return cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2BGR)


def _upscale_mask(fg: np.ndarray, size: tuple[int, int], soften: float = 0.8) -> Image.Image:
    """Binary mask at work scale -> soft L mask at ``size`` (w, h)."""
    cv2 = _cv2()
    m = fg.astype(np.float32)
    if m.shape[1] != size[0] or m.shape[0] != size[1]:
        m = cv2.resize(m, size, interpolation=cv2.INTER_LINEAR)
    if soften > 0:
        m = cv2.GaussianBlur(m, (0, 0), soften)
    return mask_from_array(np.clip(m, 0.0, 1.0))


def _keep_components(fg: np.ndarray, seeds: list[tuple[int, int]] | None = None, min_rel_area: float = 0.02) -> np.ndarray:
    """Drop specks: keep components touching a seed point, or those >= min_rel_area of the largest."""
    cv2 = _cv2()
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg.astype(np.uint8), connectivity=8)
    if n <= 1:
        return fg
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = set()
    if seeds:
        for x, y in seeds:
            if 0 <= y < labels.shape[0] and 0 <= x < labels.shape[1] and labels[y, x] > 0:
                keep.add(int(labels[y, x]))
    if not keep:
        largest = float(areas.max())
        keep = {i + 1 for i, a in enumerate(areas) if a >= largest * min_rel_area}
    return np.isin(labels, list(keep))


def _run_grabcut(bgr: np.ndarray, gc_mask: np.ndarray, iters: int) -> np.ndarray:
    cv2 = _cv2()
    fg_like = np.isin(gc_mask, (cv2.GC_FGD, cv2.GC_PR_FGD))
    if not fg_like.any():
        return np.zeros(gc_mask.shape, bool)
    if fg_like.all():
        # GrabCut needs some background samples: treat the image border as probable background.
        gc_mask[0, :] = gc_mask[-1, :] = cv2.GC_PR_BGD
        gc_mask[:, 0] = gc_mask[:, -1] = cv2.GC_PR_BGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, gc_mask, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        # Degenerate input (e.g. a flat-colour image): fall back to the seed mask itself.
        pass
    return np.isin(gc_mask, (cv2.GC_FGD, cv2.GC_PR_FGD))


@register_adapter("grabcut")
class GrabCutSegment(Adapter):
    capabilities = ("segment",)
    requires = ("cv2", "numpy")
    heavy = False

    def segment(self, params: dict, ctx: RunContext) -> dict:
        cv2 = _cv2()
        image: Image.Image = params["image"]
        w, h = image.size
        scale = _work_scale(w, h, int(self.opt("max_side", 1024)))
        bgr = _to_bgr(image, scale)
        hh, ww = bgr.shape[:2]
        iters = int(self.opt("iterations", 5))
        pts = [(int(round(p["x"] * scale)), int(round(p["y"] * scale)), p["label"]) for p in params["points"]]
        dot = max(2, int(round(min(ww, hh) * 0.01)))
        boxes = [[v * scale for v in b] for b in params["boxes"]]

        def add_points(gc: np.ndarray, region: tuple[int, int, int, int] | None) -> None:
            for x, y, label in pts:
                if region and not (region[0] <= x < region[2] and region[1] <= y < region[3]):
                    if label == 1:
                        continue
                cv2.circle(gc, (x, y), dot, cv2.GC_FGD if label == 1 else cv2.GC_BGD, -1)

        union = np.zeros((hh, ww), bool)
        if boxes:
            for i, (x0, y0, x1, y1) in enumerate(boxes):
                ctx.check_cancelled()
                ctx.progress(i / len(boxes), "Segmenting…")
                rx0, ry0 = int(np.floor(x0)), int(np.floor(y0))
                rx1, ry1 = max(rx0 + 1, int(np.ceil(x1))), max(ry0 + 1, int(np.ceil(y1)))
                gc = np.full((hh, ww), cv2.GC_BGD, np.uint8)
                gc[ry0:ry1, rx0:rx1] = cv2.GC_PR_FGD
                add_points(gc, (rx0, ry0, rx1, ry1))
                fg = _run_grabcut(bgr, gc, iters)
                fg[:ry0, :] = False
                fg[ry1:, :] = False
                fg[:, :rx0] = False
                fg[:, rx1:] = False
                seeds = [(x, y) for x, y, lab in pts if lab == 1]
                union |= _keep_components(fg, seeds or None)
        else:
            fg_pts = [(x, y) for x, y, lab in pts if lab == 1]
            if fg_pts:
                xs, ys = [p[0] for p in fg_pts], [p[1] for p in fg_pts]
                pad = int(max(0.2 * min(ww, hh), 0.75 * max(max(xs) - min(xs), max(ys) - min(ys)), 16))
                rx0, ry0 = max(0, min(xs) - pad), max(0, min(ys) - pad)
                rx1, ry1 = min(ww, max(xs) + pad + 1), min(hh, max(ys) + pad + 1)
                gc = np.full((hh, ww), cv2.GC_BGD, np.uint8)
                gc[ry0:ry1, rx0:rx1] = cv2.GC_PR_BGD
                near = max(dot * 3, int(round(min(ww, hh) * 0.06)))
                for x, y in fg_pts:
                    cv2.circle(gc, (x, y), near, cv2.GC_PR_FGD, -1)
                add_points(gc, None)
                fg = _run_grabcut(bgr, gc, iters)
                union = _keep_components(fg, fg_pts)
        ctx.progress(1.0)
        score = float(union.mean() > 0)
        return {"mask": _upscale_mask(union, (w, h)), "score": score}


@register_adapter("grabcut_center")
class GrabCutSubject(Adapter):
    capabilities = ("subject",)
    requires = ("cv2", "numpy")
    heavy = False

    def subject(self, params: dict, ctx: RunContext) -> dict:
        cv2 = _cv2()
        image: Image.Image = params["image"]
        w, h = image.size
        scale = _work_scale(w, h, int(self.opt("max_side", 768)))
        bgr = _to_bgr(image, scale)
        hh, ww = bgr.shape[:2]
        inset = float(self.opt("inset", 0.05))
        dx, dy = max(1, int(ww * inset)), max(1, int(hh * inset))
        gc = np.full((hh, ww), cv2.GC_BGD, np.uint8)
        gc[dy:hh - dy, dx:ww - dx] = cv2.GC_PR_FGD
        ctx.progress(0.1, "Finding subject…")
        fg = _run_grabcut(bgr, gc, int(self.opt("iterations", 5)))
        fg = _keep_components(fg, None, min_rel_area=0.05)
        ctx.progress(1.0)
        return {"mask": _upscale_mask(fg, (w, h), soften=1.0)}


@register_adapter("opencv_inpaint")
class OpenCVInpaint(Adapter):
    capabilities = ("remove",)
    requires = ("cv2", "numpy")
    heavy = False

    def remove(self, params: dict, ctx: RunContext) -> dict:
        cv2 = _cv2()
        image: Image.Image = params["image"]
        mask = np.asarray(params["mask"].convert("L"))
        binary = (mask > int(self.opt("threshold", 16))).astype(np.uint8) * 255
        if not binary.any():
            return {"images": [image], "seeds": [0]}
        grow = int(self.opt("dilate", 3))
        if grow > 0:
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1))
            binary = cv2.dilate(binary, k)
        ctx.progress(0.2, "Filling…")
        method = cv2.INPAINT_NS if str(self.opt("method", "telea")).lower() == "ns" else cv2.INPAINT_TELEA
        bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
        out = cv2.inpaint(bgr, binary, float(self.opt("radius", 5)), method)
        result = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
        ctx.progress(1.0)
        return {"images": [result], "seeds": [0]}


# --------------------------------------------------------------------------- guided filter


def _box_sum_axis(a: np.ndarray, r: int, axis: int) -> np.ndarray:
    n = a.shape[axis]
    c = np.cumsum(a, axis=axis, dtype=np.float64)
    zero_shape = list(c.shape)
    zero_shape[axis] = 1
    c = np.concatenate([np.zeros(zero_shape, c.dtype), c], axis=axis)
    idx = np.arange(n)
    hi = np.minimum(idx + r + 1, n)
    lo = np.maximum(idx - r, 0)
    return np.take(c, hi, axis=axis) - np.take(c, lo, axis=axis)


def box_mean(a: np.ndarray, r: int) -> np.ndarray:
    """Mean over a (2r+1)^2 window, normalised at the borders (pure numpy, O(N))."""
    h, w = a.shape[:2]
    s = _box_sum_axis(_box_sum_axis(a, r, 0), r, 1)
    iy, ix = np.arange(h), np.arange(w)
    cy = np.minimum(iy + r + 1, h) - np.maximum(iy - r, 0)
    cx = np.minimum(ix + r + 1, w) - np.maximum(ix - r, 0)
    n = np.outer(cy, cx).astype(np.float64)
    if a.ndim == 3:
        n = n[..., None]
    return (s / n).astype(np.float32)


def guided_filter_color(guide: np.ndarray, p: np.ndarray, r: int, eps: float) -> np.ndarray:
    """Colour guided filter (He, Sun & Tang). guide: HxWx3 in 0..1, p: HxW in 0..1."""
    I = guide.astype(np.float32)
    p = p.astype(np.float32)
    mean_I = box_mean(I, r)
    mean_p = box_mean(p, r)
    mean_Ip = box_mean(I * p[..., None], r)
    cov_Ip = mean_Ip - mean_I * mean_p[..., None]
    Ir, Ig, Ib = I[..., 0], I[..., 1], I[..., 2]
    mr, mg, mb = mean_I[..., 0], mean_I[..., 1], mean_I[..., 2]
    rr = box_mean(Ir * Ir, r) - mr * mr + eps
    rg = box_mean(Ir * Ig, r) - mr * mg
    rb = box_mean(Ir * Ib, r) - mr * mb
    gg = box_mean(Ig * Ig, r) - mg * mg + eps
    gb = box_mean(Ig * Ib, r) - mg * mb
    bb = box_mean(Ib * Ib, r) - mb * mb + eps
    inv_rr = gg * bb - gb * gb
    inv_rg = gb * rb - rg * bb
    inv_rb = rg * gb - gg * rb
    inv_gg = rr * bb - rb * rb
    inv_gb = rb * rg - rr * gb
    inv_bb = rr * gg - rg * rg
    det = rr * inv_rr + rg * inv_rg + rb * inv_rb
    det = np.where(np.abs(det) < 1e-12, 1e-12, det)
    cr, cg, cb = cov_Ip[..., 0], cov_Ip[..., 1], cov_Ip[..., 2]
    a_r = (cr * inv_rr + cg * inv_rg + cb * inv_rb) / det
    a_g = (cr * inv_rg + cg * inv_gg + cb * inv_gb) / det
    a_b = (cr * inv_rb + cg * inv_gb + cb * inv_bb) / det
    b = mean_p - a_r * mr - a_g * mg - a_b * mb
    q = box_mean(a_r, r) * Ir + box_mean(a_g, r) * Ig + box_mean(a_b, r) * Ib + box_mean(b, r)
    return np.clip(q, 0.0, 1.0)


def make_trimap(mask: np.ndarray, radius: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """From a 0..1 mask: (known_fg, known_bg, unknown) boolean arrays.

    The unknown band extends ``radius`` px on both sides of the mask edge.
    """
    cv2 = _cv2()
    binary = (mask >= 0.5).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    fg = cv2.erode(binary, k).astype(bool)
    bg = ~cv2.dilate(binary, k).astype(bool)
    # Pixels that were already soft (feathered) in the input are unknown too.
    soft = (mask > 0.02) & (mask < 0.98)
    fg &= ~soft
    bg &= ~soft
    unknown = ~(fg | bg)
    return fg, bg, unknown


@register_adapter("guided_filter")
class GuidedFilterMatte(Adapter):
    capabilities = ("matte",)
    requires = ("cv2", "numpy")
    heavy = False

    def matte(self, params: dict, ctx: RunContext) -> dict:
        image: Image.Image = params["image"]
        m = mask_to_array(params["mask"])
        radius = int(params.get("radius") or self.opt("radius", 10))
        fg, bg, unknown = make_trimap(m, radius)
        if not unknown.any():
            return {"mask": mask_from_array(m)}
        ys, xs = np.nonzero(unknown)
        r = int(min(64, max(2, self.opt("filter_radius", 0) or radius)))
        h, w = m.shape
        x0, x1 = max(0, xs.min() - r - 2), min(w, xs.max() + r + 3)
        y0, y1 = max(0, ys.min() - r - 2), min(h, ys.max() + r + 3)
        ctx.progress(0.2, "Refining edges…")
        guide = np.asarray(image.convert("RGB").crop((x0, y0, x1, y1)), dtype=np.float32) / 255.0
        p = m[y0:y1, x0:x1].copy()
        eps = float(self.opt("eps", 1e-4))
        max_px = int(self.opt("max_pixels", 4_000_000))  # bound memory on huge crops
        ch, cw = p.shape
        if ch * cw > max_px:
            cv2 = _cv2()
            s = (max_px / float(ch * cw)) ** 0.5
            sw, sh = max(1, int(cw * s)), max(1, int(ch * s))
            q_small = guided_filter_color(cv2.resize(guide, (sw, sh), interpolation=cv2.INTER_AREA),
                                          cv2.resize(p, (sw, sh), interpolation=cv2.INTER_AREA),
                                          max(1, int(r * s)), eps)
            q = cv2.resize(q_small, (cw, ch), interpolation=cv2.INTER_LINEAR)
        else:
            q = guided_filter_color(guide, p, r, eps)
        ctx.check_cancelled()
        out = m.copy()
        u = unknown[y0:y1, x0:x1]
        region = out[y0:y1, x0:x1]
        region[u] = q[u]
        out[fg] = 1.0
        out[bg] = 0.0
        ctx.progress(1.0)
        return {"mask": mask_from_array(out)}
