"""Segment Anything adapters (transformers).

* ``sam``  - SamModel / SamProcessor: facebook/sam-vit-*, Zigeng/SlimSAM-* ...
* ``sam2`` - Sam2Model / Sam2Processor (transformers >= 4.56): facebook/sam2.1-hiera-*

Image embeddings are cached (LRU) by a hash of the image pixels, so repeated clicks on the
same image only run the light prompt encoder + mask decoder.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Any

import numpy as np
from PIL import Image

from ..imageio import image_hash, mask_from_array
from ..registry import register_adapter
from .base import Adapter, RunContext


class _SamBase(Adapter):
    capabilities = ("segment",)
    requires = ("torch", "transformers")
    model_class = "SamModel"
    processor_class = "SamProcessor"

    def __init__(self, model_id: str, options: dict[str, Any]):
        super().__init__(model_id, options)
        self.model = None
        self.processor = None
        self._cache: OrderedDict[str, Any] = OrderedDict()

    def load(self, device: str, dtype: Any) -> None:
        import transformers

        model_cls = getattr(transformers, self.model_class)
        proc_cls = getattr(transformers, self.processor_class)
        self.processor = proc_cls.from_pretrained(self.repo)
        self.model = model_cls.from_pretrained(self.repo, torch_dtype=dtype).to(device).eval()

    def unload(self) -> None:
        self.model = None
        self.processor = None
        self._cache.clear()

    # ---- embeddings ------------------------------------------------------------

    def _embeddings(self, image: Image.Image, ctx: RunContext):
        import torch

        key = image_hash(image)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        ctx.progress(0.1, "Encoding image…")
        inputs = self.processor(images=image, return_tensors="pt")
        pixel_values = inputs["pixel_values"].to(self.device, self.model.dtype)
        with torch.inference_mode():
            emb = self.model.get_image_embeddings(pixel_values)
        self._cache[key] = emb
        while len(self._cache) > int(self.opt("cache_size", 4)):
            self._cache.popitem(last=False)
        return emb

    def _postprocess(self, pred_masks, inputs):
        """Low-res logits -> list of probability arrays at original size (per prompt, per mask)."""
        args = [pred_masks.float().cpu(), inputs["original_sizes"].cpu()]
        if "reshaped_input_sizes" in inputs:  # SAM v1 pads to a square; SAM2 does not
            args.append(inputs["reshaped_input_sizes"].cpu())
        masks = self.processor.post_process_masks(*args, binarize=False)[0]  # (prompts, n_masks, H, W)
        return masks.sigmoid().numpy()

    # ---- capability --------------------------------------------------------------

    def predict(self, image: Image.Image, points: list[dict], boxes: list[list[float]],
                multimask: bool | None, ctx: RunContext) -> tuple[np.ndarray, float]:
        """Return (probability mask HxW in 0..1, score). Multiple boxes are unioned."""
        import torch

        emb = self._embeddings(image, ctx)
        ctx.check_cancelled()
        ctx.progress(0.7, "Predicting mask…")
        if multimask is None:
            multimask = len(points) == 1 and not boxes  # SAM's advice for ambiguous single clicks
        kwargs: dict[str, Any] = {}
        pts = [[float(p["x"]), float(p["y"])] for p in points]
        labels = [int(p["label"]) for p in points]
        if boxes:
            kwargs["input_boxes"] = [[[float(v) for v in b] for b in boxes]]
            if pts:  # attach the clicks to every box prompt
                kwargs["input_points"] = [[pts for _ in boxes]]
                kwargs["input_labels"] = [[labels for _ in boxes]]
        else:
            kwargs["input_points"] = [[pts]]
            kwargs["input_labels"] = [[labels]]
        inputs = self.processor(images=image, return_tensors="pt", **kwargs)
        inputs.pop("pixel_values", None)
        model_inputs = {}
        for k, v in inputs.items():
            if k in ("original_sizes", "reshaped_input_sizes"):
                continue
            if hasattr(v, "to"):
                v = v.to(self.device)
                if v.is_floating_point():
                    v = v.to(self.model.dtype)
            model_inputs[k] = v
        with torch.inference_mode():
            out = self.model(image_embeddings=emb, multimask_output=bool(multimask), **model_inputs)
        probs = self._postprocess(out.pred_masks, inputs)  # (prompts, n, H, W)
        scores = out.iou_scores.float().cpu().numpy().reshape(probs.shape[0], -1)
        best = scores.argmax(axis=1)
        chosen = np.stack([probs[i, best[i]] for i in range(probs.shape[0])])
        mask = chosen.max(axis=0)
        score = float(np.mean([scores[i, best[i]] for i in range(len(best))]))
        return mask, score

    def segment(self, params: dict, ctx: RunContext) -> dict:
        mask, score = self.predict(params["image"], params["points"], params["boxes"], params.get("multimask"), ctx)
        ctx.progress(1.0)
        return {"mask": mask_from_array(mask), "score": score}


@register_adapter("sam")
class SamAdapter(_SamBase):
    model_class = "SamModel"
    processor_class = "SamProcessor"


@register_adapter("sam2")
class Sam2Adapter(_SamBase):
    model_class = "Sam2Model"
    processor_class = "Sam2Processor"
    min_versions = {"transformers": "4.56"}
