"""Adapter base class and the run context passed to capability methods.

An *adapter* wraps one model architecture (SAM, BiRefNet, a diffusers pipeline family...).
A *model* (an entry in ``models.toml``) is an adapter + options (repo id, dtype, steps...).
One adapter instance is created per model entry.

To add a new architecture, create ``label_ai/adapters/<name>.py``::

    from .base import Adapter
    from ..registry import register_adapter

    @register_adapter("my_arch")
    class MyAdapter(Adapter):
        capabilities = ("subject",)
        requires = ("torch", "transformers")      # import names checked with find_spec

        def load(self, device, dtype):
            import torch, transformers            # heavy imports go here, never at module top
            self.model = ...

        def unload(self):
            self.model = None

        def subject(self, params, ctx):
            image = params["image"]                # PIL RGB
            ctx.progress(0.5, "Thinking...")
            ctx.check_cancelled()
            return {"mask": some_pil_L_mask}       # resized/encoded by the server

and reference it from ``models.toml`` with ``adapter = "my_arch"``.
"""

from __future__ import annotations

import threading
from typing import Any, Callable

from ..errors import Cancelled

ProgressFn = Callable[[float, "str | None"], None]


class RunContext:
    """Passed to every capability call: progress reporting + cooperative cancellation."""

    def __init__(self, progress: ProgressFn | None = None, cancel_event: threading.Event | None = None):
        self._progress = progress
        self._cancel = cancel_event or threading.Event()
        # Sub-range mapping so helpers (e.g. a diffusion loop for image i of n) can report
        # 0..1 locally while the job shows overall progress.
        self._lo = 0.0
        self._hi = 1.0

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def check_cancelled(self) -> None:
        if self._cancel.is_set():
            raise Cancelled()

    def progress(self, fraction: float, message: str | None = None) -> None:
        if self._progress is None:
            return
        fraction = min(1.0, max(0.0, float(fraction)))
        self._progress(self._lo + (self._hi - self._lo) * fraction, message)

    def message(self, message: str) -> None:
        """Update the message without moving the progress bar."""
        if self._progress is not None:
            self._progress(-1.0, message)

    def subrange(self, lo: float, hi: float) -> "RunContext":
        """A child context whose progress 0..1 maps onto [lo, hi] of this context."""
        child = RunContext(self._progress, self._cancel)
        span = self._hi - self._lo
        child._lo = self._lo + span * lo
        child._hi = self._lo + span * hi
        return child


class Adapter:
    """Base class for model adapters.

    Class attributes:
      capabilities  capabilities this adapter *can* serve (a models.toml entry may restrict them)
      requires      importable module names needed (availability is checked with find_spec)
      min_versions  {distribution: "x.y"} minimum package versions (checked via importlib.metadata)
      heavy         heavy models are loaded on the accelerator, count towards ``max_loaded`` and
                    run serialised with all other heavy work. Classical CPU adapters set False.
    """

    capabilities: tuple[str, ...] = ()
    requires: tuple[str, ...] = ()
    min_versions: dict[str, str] = {}
    heavy: bool = True
    install_hint: str = "pip install -r requirements-models.txt"

    def __init__(self, model_id: str, options: dict[str, Any]):
        self.model_id = model_id
        self.options = dict(options)
        self.device: str = "cpu"
        self.dtype: Any = None  # torch dtype once loaded (None for non-torch adapters)

    # ---- lifecycle ---------------------------------------------------------------

    def load(self, device: str, dtype: Any) -> None:
        """Load weights (downloading lazily via the Hugging Face cache)."""

    def unload(self) -> None:
        """Drop references to weights so memory can be reclaimed."""

    @classmethod
    def check_available(cls, options: dict[str, Any]) -> str | None:
        """Extra availability check; return a reason string if unavailable, else None.

        Must be cheap - never import torch or download anything here.
        """
        return None

    # ---- helpers -----------------------------------------------------------------

    def opt(self, key: str, default: Any = None) -> Any:
        return self.options.get(key, default)

    @property
    def repo(self) -> str:
        repo = self.options.get("repo")
        if not repo:
            raise RuntimeError(f"model {self.model_id!r} has no 'repo' configured")
        return repo

    # Capability methods (implemented by subclasses as needed):
    #   segment(params, ctx) -> {"mask": PIL L, "score": float}
    #   subject(params, ctx) -> {"mask": PIL L}
    #   segment_text(params, ctx) -> {"mask": PIL L, "found": bool}
    #   matte(params, ctx) -> {"mask": PIL L}
    #   remove(params, ctx) -> {"images": [PIL], "seeds": [0]}
    #   inpaint / generate / variations / edit (params, ctx) -> {"images": [PIL...], "seeds": [int...]}
