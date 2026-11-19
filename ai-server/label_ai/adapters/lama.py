"""LaMa (big-lama, Apache-2.0) prompt-free object removal via a TorchScript export.

The TorchScript module's signature is ``forward(image, mask) -> image`` with image
``[1,3,H,W]`` float 0..1, mask ``[1,1,H,W]`` 0/1 (H, W multiples of 8); it already composites
the prediction into the masked area. Weights are fetched lazily with ``hf_hub_download``
(``repo`` + ``filename``) or from ``url`` (cached under ``torch.hub`` checkpoints).

To keep detail and memory in check we only process a crop around the mask (with context),
downscaled to ``max_side`` if needed, and paste the result back with a soft edge.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image

from ..imageio import bbox_of_mask, dilate, expand_box, feather
from ..registry import register_adapter
from .base import Adapter, RunContext


@register_adapter("lama")
class LamaAdapter(Adapter):
    capabilities = ("remove",)
    requires = ("torch", "huggingface_hub")

    def __init__(self, model_id: str, options: dict[str, Any]):
        super().__init__(model_id, options)
        self.model = None

    def _weights_path(self) -> str:
        if self.opt("url"):
            from pathlib import Path

            import torch

            target = Path(torch.hub.get_dir()) / "checkpoints" / Path(self.opt("url")).name
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                torch.hub.download_url_to_file(self.opt("url"), str(target), progress=False)
            return str(target)
        from huggingface_hub import hf_hub_download

        return hf_hub_download(self.repo, self.opt("filename", "big-lama.pt"), revision=self.opt("revision"))

    def load(self, device: str, dtype: Any) -> None:
        import torch

        path = self._weights_path()
        model = torch.jit.load(path, map_location="cpu")
        self.model = model.to(device).eval()

    def unload(self) -> None:
        self.model = None

    def _inpaint(self, image: Image.Image, mask: np.ndarray) -> Image.Image:
        import torch
        import torch.nn.functional as F

        img = torch.from_numpy(np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0).permute(2, 0, 1)[None]
        m = torch.from_numpy((mask > 0.5).astype(np.float32))[None, None]
        h, w = img.shape[-2:]
        ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
        if ph or pw:
            mode = "reflect" if ph < h and pw < w else "replicate"
            img = F.pad(img, (0, pw, 0, ph), mode=mode)
            m = F.pad(m, (0, pw, 0, ph), mode=mode)
        with torch.inference_mode():
            out = self.model(img.to(self.device), m.to(self.device))
        out = out[0, :, :h, :w].float().clamp(0, 1).permute(1, 2, 0).cpu().numpy()
        return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8))

    def remove(self, params: dict, ctx: RunContext) -> dict:
        image: Image.Image = params["image"]
        w, h = image.size
        mask_img = params["mask"].convert("L").point(lambda v: 255 if v > 16 else 0)
        grow = int(self.opt("dilate", 6))
        mask_img = dilate(mask_img, grow)
        m = np.asarray(mask_img, dtype=np.float32) / 255.0
        box = bbox_of_mask(m)
        if box is None:
            return {"images": [image], "seeds": [0]}
        bw, bh = box[2] - box[0], box[3] - box[1]
        context = int(max(32, self.opt("context", 1.0) * max(bw, bh)))
        x0, y0, x1, y1 = expand_box(box, context, w, h, min_size=256)
        crop = image.crop((x0, y0, x1, y1))
        cmask = m[y0:y1, x0:x1]
        cw, ch = crop.size
        max_side = int(self.opt("max_side", 1024))
        scale = min(1.0, max_side / float(max(cw, ch)))
        if scale < 1.0:
            sw, sh = max(8, round(cw * scale)), max(8, round(ch * scale))
            work = crop.resize((sw, sh), Image.LANCZOS)
            wmask = np.asarray(Image.fromarray((cmask * 255).astype(np.uint8)).resize((sw, sh), Image.BILINEAR),
                               dtype=np.float32) / 255.0
            wmask = (wmask > 0.1).astype(np.float32)
        else:
            work, wmask = crop, cmask
        ctx.progress(0.2, "Removing…")
        ctx.check_cancelled()
        filled = self._inpaint(work, wmask)
        if filled.size != crop.size:
            filled = filled.resize(crop.size, Image.LANCZOS)
        soft = feather(mask_img.crop((x0, y0, x1, y1)), float(self.opt("feather", 2.0)))
        result = image.copy()
        result.paste(Image.composite(filled, crop, soft), (x0, y0))
        ctx.progress(1.0)
        return {"images": [result], "seeds": [0]}
