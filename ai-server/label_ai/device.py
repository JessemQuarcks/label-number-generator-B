"""Device and dtype selection.

Everything torch-related is imported lazily so the server runs with only the core
dependencies installed (in which case the device is always ``cpu``).
"""

from __future__ import annotations

import importlib.util
import logging
from typing import Any

log = logging.getLogger(__name__)

VALID_DEVICES = ("auto", "cuda", "mps", "cpu")
_DTYPE_NAMES = {
    "float16": "float16",
    "fp16": "float16",
    "half": "float16",
    "bfloat16": "bfloat16",
    "bf16": "bfloat16",
    "float32": "float32",
    "fp32": "float32",
    "float": "float32",
}


def torch_installed() -> bool:
    return importlib.util.find_spec("torch") is not None


def select_device(preference: str = "auto") -> str:
    """Resolve ``auto|cuda|mps|cpu`` to a concrete device string.

    Falls back to ``cpu`` (with a warning) when the requested accelerator is not usable.
    """
    preference = (preference or "auto").lower()
    if preference not in VALID_DEVICES:
        raise ValueError(f"unknown device {preference!r}; expected one of {VALID_DEVICES}")
    if preference == "cpu" or not torch_installed():
        if preference not in ("auto", "cpu"):
            log.warning("torch is not installed; using cpu instead of %s", preference)
        return "cpu"
    import torch

    cuda_ok = torch.cuda.is_available()
    mps_ok = bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available()
    if preference == "cuda":
        if cuda_ok:
            return "cuda"
        log.warning("CUDA requested but not available; falling back to cpu")
        return "cpu"
    if preference == "mps":
        if mps_ok:
            return "mps"
        log.warning("MPS requested but not available; falling back to cpu")
        return "cpu"
    if cuda_ok:
        return "cuda"
    if mps_ok:
        return "mps"
    return "cpu"


def dtype_name_for(device: str, options: dict[str, Any] | None = None) -> str:
    """Pick a dtype *name* for a model on ``device``.

    Model options (from models.toml) that influence this:
      ``dtype``      - preferred dtype on CUDA (default float16)
      ``mps_dtype``  - dtype on Apple MPS (default float16)
      ``cpu_dtype``  - dtype on CPU (default float32)
    """
    options = options or {}
    if device == "cuda":
        name = _DTYPE_NAMES.get(str(options.get("dtype", "float16")).lower(), "float16")
        if name == "bfloat16" and torch_installed():
            import torch

            if not torch.cuda.is_bf16_supported():
                log.info("bfloat16 not supported on this GPU; using float16")
                name = "float16"
        return name
    if device == "mps":
        return _DTYPE_NAMES.get(str(options.get("mps_dtype", "float16")).lower(), "float16")
    return _DTYPE_NAMES.get(str(options.get("cpu_dtype", "float32")).lower(), "float32")


def to_torch_dtype(name: str):
    import torch

    return {"float16": torch.float16, "bfloat16": torch.bfloat16, "float32": torch.float32}[name]


def cuda_vram_gb() -> float | None:
    """Total VRAM of the current CUDA device in GiB (None if not on CUDA)."""
    if not torch_installed():
        return None
    import torch

    if not torch.cuda.is_available():
        return None
    props = torch.cuda.get_device_properties(torch.cuda.current_device())
    return props.total_memory / (1024**3)


def empty_cache(device: str) -> None:
    """Release cached accelerator memory after unloading a model."""
    import gc

    gc.collect()
    if not torch_installed():
        return
    import torch

    if device == "cuda" and torch.cuda.is_available():
        torch.cuda.empty_cache()
        try:
            torch.cuda.ipc_collect()
        except Exception:  # pragma: no cover - best effort
            pass
    elif device == "mps":
        try:
            torch.mps.empty_cache()
        except Exception:  # pragma: no cover - best effort
            pass


def make_generator(device: str, seed: int):
    """A seeded ``torch.Generator`` on the right device (CPU generator for MPS/CPU)."""
    import torch

    gen_device = "cuda" if device == "cuda" else "cpu"
    return torch.Generator(device=gen_device).manual_seed(int(seed))
