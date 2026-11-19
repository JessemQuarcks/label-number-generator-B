"""BiRefNet (MIT) - salient object segmentation ("select subject") and matting.

Loaded with ``AutoModelForImageSegmentation.from_pretrained(repo, trust_remote_code=True)``;
the remote code imports torchvision, timm, einops and kornia.

* ``subject``: whole image at ``resolution`` (1024x1024), ImageNet normalisation, sigmoid of
  the last output.
* ``matte``: a trimap is built from the incoming mask; the model runs on a crop around the
  unknown band and only the unknown band takes the predicted alpha (known fg/bg are kept).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image

from ..imageio import expand_box, mask_from_array, mask_to_array
from ..registry import register_adapter
from .base import Adapter, RunContext
from .classical import make_trimap

_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


@register_adapter("birefnet")
class BiRefNetAdapter(Adapter):
    capabilities = ("subject", "matte")
    requires = ("torch", "torchvision", "transformers", "timm", "einops", "kornia")

    def __init__(self, model_id: str, options: dict[str, Any]):
        super().__init__(model_id, options)
        self.model = None

    def load(self, device: str, dtype: Any) -> None:
        import torch
        from transformers import AutoModelForImageSegmentation

        model = AutoModelForImageSegmentation.from_pretrained(self.repo, trust_remote_code=True,
                                                              revision=self.opt("revision"))
        torch.set_float32_matmul_precision("high")
        self.model = model.to(device=device, dtype=dtype).eval()

    def unload(self) -> None:
        self.model = None

    def _predict(self, image: Image.Image) -> np.ndarray:
        """RGB PIL -> alpha (H, W) float 0..1 at the image's size."""
        import torch
        import torch.nn.functional as F

        res = int(self.opt("resolution", 1024))
        arr = np.asarray(image.convert("RGB").resize((res, res), Image.BILINEAR), dtype=np.float32) / 255.0
        arr = (arr - _MEAN) / _STD
        x = torch.from_numpy(arr.transpose(2, 0, 1)).unsqueeze(0).to(self.device, self.model.dtype)
        with torch.inference_mode():
            preds = self.model(x)
            pred = preds[-1] if isinstance(preds, (list, tuple)) else preds
            pred = pred.float().sigmoid()
            pred = F.interpolate(pred, size=(image.height, image.width), mode="bilinear", align_corners=False)
        return pred[0, 0].cpu().numpy()

    def subject(self, params: dict, ctx: RunContext) -> dict:
        ctx.progress(0.2, "Finding subject…")
        alpha = self._predict(params["image"])
        ctx.progress(1.0)
        return {"mask": mask_from_array(alpha)}

    def matte(self, params: dict, ctx: RunContext) -> dict:
        image: Image.Image = params["image"]
        m = mask_to_array(params["mask"])
        radius = int(params.get("radius") or self.opt("radius", 10))
        fg, bg, unknown = make_trimap(m, radius)
        if not unknown.any():
            return {"mask": mask_from_array(m)}
        # Crop around the whole selection (plus margin) so the model sees the subject in context
        # at the highest possible resolution.
        ys, xs = np.nonzero(unknown | fg)
        h, w = m.shape
        bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        margin = int(max(radius * 2, 0.1 * max(bw, bh)))
        x0, y0, x1, y1 = expand_box((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
                                    margin, w, h, min_size=64)
        ctx.progress(0.2, "Refining edges…")
        alpha = self._predict(image.crop((x0, y0, x1, y1)))
        ctx.check_cancelled()
        out = m.copy()
        u = unknown[y0:y1, x0:x1]
        region = out[y0:y1, x0:x1]
        region[u] = alpha[u]
        out[fg] = 1.0
        out[bg] = 0.0
        ctx.progress(1.0)
        return {"mask": mask_from_array(out)}
