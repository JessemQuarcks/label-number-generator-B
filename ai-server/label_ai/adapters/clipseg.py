"""CLIPSeg (Apache-2.0) - text-prompted segmentation ("select sky")."""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image

from ..imageio import mask_from_array
from ..registry import register_adapter
from .base import Adapter, RunContext


def threshold_mask(prob: np.ndarray, threshold: float, soften: float = 1.0) -> tuple[np.ndarray, bool]:
    """Probability map -> (soft-edged binary mask 0..1, found)."""
    import cv2

    found = bool((prob >= threshold).any())
    if not found:
        return np.zeros_like(prob, dtype=np.float32), False
    m = (prob >= threshold).astype(np.float32)
    if soften > 0:
        m = cv2.GaussianBlur(m, (0, 0), soften)
    return m, True


@register_adapter("clipseg")
class CLIPSegAdapter(Adapter):
    capabilities = ("segment_text",)
    requires = ("torch", "transformers")

    def __init__(self, model_id: str, options: dict[str, Any]):
        super().__init__(model_id, options)
        self.model = None
        self.processor = None

    def load(self, device: str, dtype: Any) -> None:
        from transformers import CLIPSegForImageSegmentation, CLIPSegProcessor

        self.processor = CLIPSegProcessor.from_pretrained(self.repo)
        self.model = CLIPSegForImageSegmentation.from_pretrained(self.repo, torch_dtype=dtype).to(device).eval()

    def unload(self) -> None:
        self.model = None
        self.processor = None

    def probability(self, image: Image.Image, prompt: str) -> np.ndarray:
        import torch
        import torch.nn.functional as F

        inputs = self.processor(text=[prompt], images=[image], padding="max_length", return_tensors="pt")
        inputs = {k: (v.to(self.device, self.model.dtype) if v.is_floating_point() else v.to(self.device))
                  for k, v in inputs.items()}
        with torch.inference_mode():
            logits = self.model(**inputs).logits
        logits = logits.float().reshape(1, 1, *logits.shape[-2:])
        prob = F.interpolate(logits.sigmoid(), size=(image.height, image.width), mode="bilinear", align_corners=False)
        return prob[0, 0].cpu().numpy()

    def segment_text(self, params: dict, ctx: RunContext) -> dict:
        ctx.progress(0.2, "Searching…")
        threshold = params.get("threshold")
        if threshold is None:
            threshold = float(self.opt("threshold", 0.35))
        prob = self.probability(params["image"], params["prompt"])
        mask, found = threshold_mask(prob, threshold)
        ctx.progress(1.0)
        return {"mask": mask_from_array(mask), "found": found}
