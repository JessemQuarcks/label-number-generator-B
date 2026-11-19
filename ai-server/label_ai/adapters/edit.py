"""Instruction-based image editing ("make the label blue", "remove the text").

* ``qwen_image_edit``  - Qwen/Qwen-Image-Edit via diffusers QwenImageEditPipeline (Apache-2.0,
  20B MMDiT + Qwen2.5-VL text encoder, ~58 GB of bf16 weights: needs a very large GPU or CPU
  offload - see ``offload`` / ``min_vram_gb`` in models.toml).
* ``instruct_pix2pix`` - timbrooks/instruct-pix2pix (MIT, SD 1.5 based, small and fast).
"""

from __future__ import annotations

from typing import Any

from PIL import Image

from ..device import make_generator
from ..imageio import fit_size, resize
from ..registry import register_adapter
from .base import Adapter, RunContext
from .diffusion import call_pipeline, load_pipeline, place_pipeline


class _EditBase(Adapter):
    capabilities = ("edit",)
    requires = ("torch", "diffusers", "transformers", "accelerate")
    pipeline_class = ""
    defaults: dict[str, Any] = {}

    def __init__(self, model_id: str, options: dict[str, Any]):
        super().__init__(model_id, options)
        self.pipe = None

    def o(self, key: str):
        return self.options.get(key, self.defaults.get(key))

    def load(self, device: str, dtype: Any) -> None:
        self.pipe = load_pipeline(self.opt("pipeline", self.pipeline_class), self.repo, dtype, self.options)
        place_pipeline(self.pipe, device, self.options)

    def unload(self) -> None:
        if self.pipe is not None:
            try:
                self.pipe.maybe_free_model_hooks()
            except Exception:
                pass
        self.pipe = None

    def _work_image(self, image: Image.Image) -> Image.Image:
        native = int(self.o("native"))
        size = fit_size(*image.size, max_side=int(self.o("max_side")), multiple=int(self.o("multiple")),
                        target_area=native * native)
        return resize(image, size)

    def build_kwargs(self, params: dict, work: Image.Image) -> dict[str, Any]:  # pragma: no cover - abstract
        raise NotImplementedError

    def edit(self, params: dict, ctx: RunContext) -> dict:
        image: Image.Image = params["image"]
        work = self._work_image(image)
        seeds = params["seeds"]
        ctx.message(f"Editing with {self.model_id}…")
        images = []
        for i, seed in enumerate(seeds):
            sub = ctx.subrange(i / len(seeds), (i + 1) / len(seeds))
            kwargs = self.build_kwargs(params, work)
            kwargs["generator"] = make_generator(self.device, seed)
            out = call_pipeline(self.pipe, kwargs, sub, kwargs.get("num_inference_steps"))[0]
            images.append(resize(out, image.size))
        return {"images": images, "seeds": seeds}


@register_adapter("instruct_pix2pix")
class InstructPix2PixAdapter(_EditBase):
    pipeline_class = "StableDiffusionInstructPix2PixPipeline"
    defaults = {"native": 512, "max_side": 768, "multiple": 8, "steps": 20, "guidance": 7.5,
                "image_guidance": 1.5}

    def build_kwargs(self, params: dict, work: Image.Image) -> dict[str, Any]:
        return {
            "prompt": params["instruction"],
            "negative_prompt": params.get("negative_prompt"),
            "image": work,
            "num_inference_steps": params.get("steps") or int(self.o("steps")),
            "guidance_scale": params["guidance"] if params.get("guidance") is not None else float(self.o("guidance")),
            "image_guidance_scale": float(self.o("image_guidance")),
        }


@register_adapter("qwen_image_edit")
class QwenImageEditAdapter(_EditBase):
    pipeline_class = "QwenImageEditPipeline"
    min_versions = {"diffusers": "0.35"}
    defaults = {"native": 1024, "max_side": 1536, "multiple": 32, "steps": 30, "guidance": 4.0}

    def build_kwargs(self, params: dict, work: Image.Image) -> dict[str, Any]:
        return {
            "image": work,
            "prompt": params["instruction"],
            "negative_prompt": params.get("negative_prompt") or " ",
            "num_inference_steps": params.get("steps") or int(self.o("steps")),
            # Qwen-Image uses "true" classifier-free guidance; "guidance" maps onto true_cfg_scale.
            "true_cfg_scale": params["guidance"] if params.get("guidance") is not None else float(self.o("guidance")),
        }
