"""Diffusers-based generation adapters: text-to-image, img2img ("variations") and inpainting.

One ``diffusion`` adapter class serves a whole model family; a models.toml entry picks the
family and restricts capabilities, e.g.::

    [models.sdxl]
    adapter = "diffusion"
    family = "sdxl"                        # sd15 | sdxl | flux
    repo = "stabilityai/stable-diffusion-xl-base-1.0"
    capabilities = ["generate", "variations"]

Pipelines for the other capabilities are derived with ``Pipeline.from_pipe`` so the weights
are shared (e.g. ``generate`` + ``variations`` on one model cost one load).

Useful options (all optional): ``steps``, ``guidance``, ``strength``, ``native`` (native
resolution, used as target area), ``max_side``, ``multiple``, ``variant`` ("fp16"), ``vae``
(replacement VAE repo), ``offload`` ("auto" | "none" | "model" | "sequential"),
``min_vram_gb`` / ``model_offload_min_vram_gb`` (thresholds for offload = "auto"),
``safety_checker`` (SD 1.5; default true), ``max_sequence_length`` (Flux), ``vae_tiling``,
``attention_slicing``, ``pipelines = { generate = "...", variations = "...", inpaint = "..." }``
(override diffusers class names - lets you add new diffusers architectures from TOML only).
"""

from __future__ import annotations

import inspect
import logging
import math
from typing import Any

from PIL import Image

from ..device import cuda_vram_gb, make_generator
from ..errors import Cancelled, model_unavailable
from ..imageio import dilate, fit_size, paste_back, resize, resize_cover
from ..registry import register_adapter
from .base import Adapter, RunContext

log = logging.getLogger(__name__)

FAMILIES: dict[str, dict[str, Any]] = {
    "sd15": {
        "pipelines": {
            "generate": "StableDiffusionPipeline",
            "variations": "StableDiffusionImg2ImgPipeline",
            "inpaint": "StableDiffusionInpaintPipeline",
        },
        "native": 512, "max_side": 768, "multiple": 8, "steps": 30, "guidance": 7.5,
        "negative_prompt": True,
    },
    "sdxl": {
        "pipelines": {
            "generate": "StableDiffusionXLPipeline",
            "variations": "StableDiffusionXLImg2ImgPipeline",
            "inpaint": "StableDiffusionXLInpaintPipeline",
        },
        "native": 1024, "max_side": 1536, "multiple": 8, "steps": 30, "guidance": 6.0,
        "negative_prompt": True,
    },
    "flux": {
        "pipelines": {
            "generate": "FluxPipeline",
            "variations": "FluxImg2ImgPipeline",
            "inpaint": "FluxInpaintPipeline",
        },
        "native": 1024, "max_side": 1536, "multiple": 16, "steps": 4, "guidance": 0.0,
        "negative_prompt": False, "max_sequence_length": 256,
    },
}


# --------------------------------------------------------------------------- shared helpers


def load_pipeline(class_name: str, repo: str, dtype: Any, options: dict[str, Any]):
    """``from_pretrained`` with the configured dtype / variant / VAE / safety-checker options."""
    import diffusers

    cls = getattr(diffusers, class_name, None)
    if cls is None:
        raise RuntimeError(f"diffusers {diffusers.__version__} has no {class_name}; pip install -U diffusers")
    kwargs: dict[str, Any] = {"torch_dtype": dtype}
    if options.get("revision"):
        kwargs["revision"] = options["revision"]
    if options.get("vae"):
        kwargs["vae"] = diffusers.AutoencoderKL.from_pretrained(options["vae"], torch_dtype=dtype)
    if options.get("safety_checker") is False:
        kwargs["safety_checker"] = None
        kwargs["requires_safety_checker"] = False
    variant = options.get("variant")
    try:
        if variant:
            try:
                return cls.from_pretrained(repo, variant=variant, **kwargs)
            except (OSError, ValueError) as exc:
                if _is_gated(exc):
                    raise
                log.info("variant %r not available for %s (%s); loading default weights", variant, repo, exc)
        return cls.from_pretrained(repo, **kwargs)
    except Exception as exc:
        if _is_gated(exc):
            raise model_unavailable(
                f"{repo} is gated on Hugging Face: accept its (free) license at https://huggingface.co/{repo} "
                "and log in once with `hf auth login` (or set HF_TOKEN), then retry") from exc
        raise


def _is_gated(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return "gated" in text or "401" in text or "access to model" in text


def place_pipeline(pipe, device: str, options: dict[str, Any]) -> str:
    """Move a pipeline to ``device`` or enable CPU offload. Returns the mode used."""
    mode = str(options.get("offload", "auto")).lower()
    if device == "cuda":
        if mode == "auto":
            vram = cuda_vram_gb() or 0.0
            if vram >= float(options.get("min_vram_gb", 0)):
                mode = "none"
            elif vram >= float(options.get("model_offload_min_vram_gb", 0)):
                mode = "model"
            else:
                mode = "sequential"
            log.info("VRAM %.1f GiB -> offload=%s", vram, mode)
        if mode == "model":
            pipe.enable_model_cpu_offload()
        elif mode == "sequential":
            pipe.enable_sequential_cpu_offload()
        else:
            mode = "none"
            pipe.to("cuda")
    else:
        mode = "none"
        pipe.to(device)
    if options.get("attention_slicing", device == "mps"):
        try:
            pipe.enable_attention_slicing()
        except Exception:  # not every pipeline supports it
            pass
    if options.get("vae_tiling"):
        try:
            pipe.vae.enable_tiling()
        except Exception:
            pass
    if hasattr(pipe, "set_progress_bar_config"):
        pipe.set_progress_bar_config(disable=True)
    return mode


def call_pipeline(pipe, kwargs: dict[str, Any], ctx: RunContext, steps_hint: int | None = None):
    """Call a diffusers pipeline with progress + cancellation, dropping unsupported kwargs."""
    import torch

    params = inspect.signature(pipe.__call__).parameters
    accepts_any = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values())
    call_kwargs = {k: v for k, v in kwargs.items() if v is not None and (accepts_any or k in params)}

    if "callback_on_step_end" in params:
        def on_step_end(p, step, timestep, cb_kwargs):
            if ctx.cancelled:
                raise Cancelled()
            total = getattr(p, "num_timesteps", None) or steps_hint or 1
            ctx.progress(min(1.0, (step + 1) / max(1, total)))
            return cb_kwargs

        call_kwargs["callback_on_step_end"] = on_step_end
    ctx.check_cancelled()
    with torch.inference_mode():
        out = pipe(**call_kwargs)
    ctx.check_cancelled()
    return out.images


def img2img_steps(steps: int, strength: float, scale: bool) -> int:
    """With ``scale`` the *executed* denoising steps ~= ``steps`` regardless of strength."""
    if not scale or strength >= 1.0:
        return steps
    return min(150, max(steps, math.ceil(steps / max(strength, 0.05))))


# --------------------------------------------------------------------------- adapter


@register_adapter("diffusion")
class DiffusionAdapter(Adapter):
    capabilities = ("generate", "variations", "inpaint")
    requires = ("torch", "diffusers", "transformers", "accelerate")

    def __init__(self, model_id: str, options: dict[str, Any]):
        super().__init__(model_id, options)
        family = str(self.opt("family", "sd15"))
        if family not in FAMILIES and not self.opt("pipelines"):
            raise ValueError(f"model {model_id}: unknown diffusion family {family!r}")
        self.family = dict(FAMILIES.get(family, {}))
        self.family.update({k: v for k, v in options.items() if k in ("native", "max_side", "multiple", "steps",
                                                                       "guidance", "max_sequence_length")})
        self.pipeline_names = dict(self.family.get("pipelines", {}))
        self.pipeline_names.update(self.opt("pipelines", {}) or {})
        self._pipes: dict[str, Any] = {}
        self._active: str | None = None
        self._current = None
        self._offload = "none"

    def load(self, device: str, dtype: Any) -> None:
        # Pipelines are created on first use of each capability (see _pipe).
        import diffusers  # noqa: F401  (fail fast if missing)

    def unload(self) -> None:
        for pipe in self._pipes.values():
            try:
                pipe.maybe_free_model_hooks()
            except Exception:
                pass
        self._pipes.clear()
        self._active = None
        self._current = None

    def _pipe(self, capability: str, ctx: RunContext):
        import diffusers

        name = self.pipeline_names.get(capability)
        if not name:
            raise RuntimeError(f"model {self.model_id} has no pipeline for {capability}")
        if capability not in self._pipes:
            if self._pipes:
                base = next(iter(self._pipes.values()))
                cls = getattr(diffusers, name)
                pipe = cls.from_pipe(base)
            else:
                ctx.message(f"Loading model {self.model_id}… (first run downloads weights)")
                pipe = load_pipeline(name, self.repo, self.dtype, self.options)
                self._offload = place_pipeline(pipe, self.device, self.options)
                self._active = capability
            self._pipes[capability] = pipe
        pipe = self._pipes[capability]
        if self._active != capability:
            if self._offload != "none":  # re-install offload hooks for the derived pipeline
                place_pipeline(pipe, self.device, self.options)
            elif hasattr(pipe, "set_progress_bar_config"):
                pipe.set_progress_bar_config(disable=True)
            self._active = capability
        return pipe

    # ---- parameter helpers ---------------------------------------------------------

    def _size_for(self, w: int, h: int) -> tuple[int, int]:
        native = int(self.family.get("native", 1024))
        return fit_size(w, h, max_side=int(self.family.get("max_side", native)),
                        multiple=int(self.family.get("multiple", 8)), target_area=native * native)

    def _common(self, params: dict) -> dict[str, Any]:
        kw: dict[str, Any] = {
            "num_inference_steps": params.get("steps") or int(self.family.get("steps", 30)),
            "guidance_scale": params["guidance"] if params.get("guidance") is not None
            else float(self.family.get("guidance", 7.5)),
        }
        if self.family.get("negative_prompt", True):
            kw["negative_prompt"] = params.get("negative_prompt") or self.opt("negative_prompt")
        if self.family.get("max_sequence_length"):
            kw["max_sequence_length"] = int(self.family["max_sequence_length"])
        return kw

    def _loop(self, params: dict, ctx: RunContext, build) -> dict:
        seeds = params["seeds"]
        images = []
        for i, seed in enumerate(seeds):
            sub = ctx.subrange(i / len(seeds), (i + 1) / len(seeds))
            kwargs = build()
            kwargs["generator"] = make_generator(self.device, seed)
            images.append(call_pipeline(self._current, kwargs, sub, kwargs.get("num_inference_steps"))[0])
        return {"images": images, "seeds": seeds}

    # ---- capabilities ----------------------------------------------------------------

    def generate(self, params: dict, ctx: RunContext) -> dict:
        self._current = self._pipe("generate", ctx)
        tw, th = params["width"], params["height"]
        mw, mh = self._size_for(tw, th)
        ctx.message(f"Generating with {self.model_id}…")

        def build():
            return {"prompt": params["prompt"], "width": mw, "height": mh, **self._common(params)}

        out = self._loop(params, ctx, build)
        out["images"] = [resize_cover(img, (tw, th)) for img in out["images"]]
        return out

    def variations(self, params: dict, ctx: RunContext) -> dict:
        self._current = self._pipe("variations", ctx)
        image: Image.Image = params["image"]
        mw, mh = self._size_for(*image.size)
        work = resize(image, (mw, mh))
        strength = float(params.get("strength") or 0.55)
        prompt = params.get("prompt") or self.opt("variation_prompt", "")
        ctx.message(f"Generating variations with {self.model_id}…")

        def build():
            kw = self._common(params)
            kw["num_inference_steps"] = img2img_steps(kw["num_inference_steps"], strength,
                                                      bool(self.opt("scale_img2img_steps", True)))
            return {"prompt": prompt, "image": work, "strength": strength, "width": mw, "height": mh, **kw}

        out = self._loop(params, ctx, build)
        out["images"] = [resize(img, image.size) for img in out["images"]]
        return out

    def inpaint(self, params: dict, ctx: RunContext) -> dict:
        self._current = self._pipe("inpaint", ctx)
        image: Image.Image = params["image"]
        mask: Image.Image = params["mask"]
        mw, mh = self._size_for(*image.size)
        work = resize(image, (mw, mh))
        grown = dilate(mask, int(self.opt("mask_grow", 4)))
        work_mask = resize(grown, (mw, mh))
        strength = params.get("strength")
        if strength is None:
            strength = float(self.opt("strength", 1.0))
        ctx.message(f"Inpainting with {self.model_id}…")

        def build():
            kw = self._common(params)
            kw["num_inference_steps"] = img2img_steps(kw["num_inference_steps"], strength,
                                                      bool(self.opt("scale_img2img_steps", True)))
            return {"prompt": params["prompt"], "image": work, "mask_image": work_mask, "strength": strength,
                    "width": mw, "height": mh, **kw}

        out = self._loop(params, ctx, build)
        feather_px = float(self.opt("feather", max(2.0, min(image.size) / 256)))
        out["images"] = [paste_back(image, img, grown, feather_px) for img in out["images"]]
        return out
