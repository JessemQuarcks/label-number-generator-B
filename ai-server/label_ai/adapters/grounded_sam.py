"""Grounded-SAM: Grounding DINO (Apache-2.0) open-vocabulary boxes -> SAM masks (union).

Options: ``repo`` (detector), ``sam_repo``, ``sam_adapter`` ("sam" or "sam2"),
``threshold`` (box score), ``text_threshold``, ``max_detections``.
"""

from __future__ import annotations

import inspect
from typing import Any

import numpy as np

from ..imageio import mask_from_array
from ..registry import register_adapter
from .base import Adapter, RunContext
from .sam import Sam2Adapter, SamAdapter


def _detector_text(prompt: str) -> str:
    """Grounding DINO wants lower-case phrases each terminated by a period: "sky. tree."."""
    parts = [p.strip().lower().rstrip(".") for p in prompt.replace(";", ",").split(",")]
    parts = [p for p in parts if p]
    return " ".join(f"{p}." for p in parts) or prompt.lower()


@register_adapter("grounded_sam")
class GroundedSamAdapter(Adapter):
    capabilities = ("segment_text",)
    requires = ("torch", "transformers")

    def __init__(self, model_id: str, options: dict[str, Any]):
        super().__init__(model_id, options)
        self.detector = None
        self.processor = None
        sam_cls = Sam2Adapter if self.opt("sam_adapter", "sam") == "sam2" else SamAdapter
        self.sam = sam_cls(f"{model_id}/sam", {"repo": self.opt("sam_repo", "facebook/sam-vit-base"), "cache_size": 2})

    def load(self, device: str, dtype: Any) -> None:
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        self.processor = AutoProcessor.from_pretrained(self.repo)
        # Grounding DINO is numerically fragile in fp16; keep it in fp32 (it is small).
        self.detector = AutoModelForZeroShotObjectDetection.from_pretrained(self.repo).to(device).eval()
        self.sam.device, self.sam.dtype = device, dtype
        self.sam.load(device, dtype)

    def unload(self) -> None:
        self.detector = None
        self.processor = None
        self.sam.unload()

    def detect(self, image, prompt: str, threshold: float) -> list[list[float]]:
        import torch

        text = _detector_text(prompt)
        inputs = self.processor(images=image, text=text, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            outputs = self.detector(**inputs)
        post = self.processor.post_process_grounded_object_detection
        kwargs: dict[str, Any] = {
            "text_threshold": float(self.opt("text_threshold", 0.25)),
            "target_sizes": [(image.height, image.width)],
        }
        names = inspect.signature(post).parameters
        kwargs["threshold" if "threshold" in names else "box_threshold"] = threshold
        results = post(outputs, inputs["input_ids"], **kwargs)[0]
        boxes = results["boxes"].float().cpu().numpy().tolist()
        scores = results["scores"].float().cpu().numpy().tolist()
        order = np.argsort(scores)[::-1][: int(self.opt("max_detections", 16))]
        return [boxes[i] for i in order]

    def segment_text(self, params: dict, ctx: RunContext) -> dict:
        image = params["image"]
        threshold = params.get("threshold")
        if threshold is None:
            threshold = float(self.opt("threshold", 0.35))
        ctx.progress(0.1, "Detecting…")
        boxes = self.detect(image, params["prompt"], threshold)
        ctx.check_cancelled()
        if not boxes:
            return {"mask": mask_from_array(np.zeros((image.height, image.width), np.float32)), "found": False}
        w, h = image.size
        boxes = [[max(0.0, b[0]), max(0.0, b[1]), min(float(w), b[2]), min(float(h), b[3])] for b in boxes]
        boxes = [b for b in boxes if b[2] - b[0] >= 1 and b[3] - b[1] >= 1]
        if not boxes:
            return {"mask": mask_from_array(np.zeros((h, w), np.float32)), "found": False}
        mask, _ = self.sam.predict(image, [], boxes, False, ctx.subrange(0.4, 1.0))
        ctx.progress(1.0)
        return {"mask": mask_from_array(mask), "found": True}
