"""Shared fixtures. Tests run with only the core requirements (no torch)."""

from __future__ import annotations

import base64
import io
import time
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from label_ai.adapters.base import Adapter, RunContext
from label_ai.registry import Registry, register_adapter
from label_ai.server import create_app

# --------------------------------------------------------------------------- fake adapters


@register_adapter("fake_slow")
class FakeSlowAdapter(Adapter):
    """A 'heavy' adapter that pretends to run a diffusion loop."""

    capabilities = ("generate", "subject", "segment_text", "inpaint", "variations")
    requires = ()
    heavy = True
    loads = 0
    unloads = 0

    def load(self, device, dtype):
        type(self).loads += 1
        self.loaded_marker = True

    def unload(self):
        type(self).unloads += 1

    def generate(self, params: dict, ctx: RunContext) -> dict:
        steps = int(self.opt("steps", 10))
        delay = float(self.opt("delay", 0.02))
        images = []
        for i, seed in enumerate(params["seeds"]):
            for s in range(steps):
                ctx.check_cancelled()
                time.sleep(delay)
                ctx.progress((i + (s + 1) / steps) / len(params["seeds"]), f"step {s + 1}/{steps}")
            # deliberately the wrong size: the server must resize to width x height
            images.append(Image.new("RGB", (50, 30), (seed % 256, 0, 0)))
        return {"images": images, "seeds": params["seeds"]}

    def _same(self, params: dict, ctx: RunContext) -> dict:
        return {"images": [params["image"]] * params["count"], "seeds": params["seeds"]}

    inpaint = variations = _same

    def segment_text(self, params: dict, ctx: RunContext) -> dict:
        w, h = params["image"].size
        return {"mask": np.zeros((h, w), np.float32), "found": False}

    def subject(self, params: dict, ctx: RunContext) -> dict:
        w, h = params["image"].size
        m = np.zeros((h // 2, w // 2), np.float32)  # wrong size on purpose
        m[h // 8: 3 * h // 8, w // 8: 3 * w // 8] = 1.0
        return {"mask": m}


@register_adapter("fake_needs_missing_module")
class FakeUnavailableAdapter(Adapter):
    capabilities = ("generate", "segment")
    requires = ("definitely_not_an_installed_module_xyz",)


# --------------------------------------------------------------------------- helpers


def data_url(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[fmt]
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()


def decode_url(url: str) -> Image.Image:
    assert url.startswith("data:image/png;base64,")
    img = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))
    img.load()
    return img


OBJ_BOX = (50, 30, 110, 90)  # x0, y0, x1, y1 of the red square in the synthetic image


@pytest.fixture
def synthetic_image() -> Image.Image:
    """160x120 noisy grey background with a solid red square at OBJ_BOX."""
    rng = np.random.default_rng(0)
    arr = (rng.normal(128, 12, (120, 160, 3))).clip(0, 255).astype(np.uint8)
    x0, y0, x1, y1 = OBJ_BOX
    arr[y0:y1, x0:x1] = (220, 30, 30)
    return Image.fromarray(arr, "RGB")


@pytest.fixture
def square_mask() -> Image.Image:
    m = np.zeros((120, 160), np.uint8)
    x0, y0, x1, y1 = OBJ_BOX
    m[y0:y1, x0:x1] = 255
    return Image.fromarray(m, "L")


def test_config(**server: Any) -> dict:
    return {
        "server": {"default_profile": "standard", "max_loaded": 2, **server},
        "profiles": {
            "lite": {"defaults": {"segment": "grabcut"}},
            "standard": {"defaults": {"segment": "unavailable-model", "generate": "fake", "subject": "grabcut-center"}},
            "quality": {"defaults": {}},
        },
        "models": {
            "unavailable-model": {"adapter": "fake_needs_missing_module", "name": "Missing deps",
                                  "license": "MIT", "capabilities": ["segment", "generate"]},
            "grabcut": {"adapter": "grabcut", "name": "GrabCut", "license": "Apache-2.0"},
            "grabcut-center": {"adapter": "grabcut_center", "license": "Apache-2.0"},
            "guided-filter": {"adapter": "guided_filter", "license": "MIT"},
            "opencv-telea": {"adapter": "opencv_inpaint", "license": "Apache-2.0"},
            "fake": {"adapter": "fake_slow", "name": "Fake", "license": "MIT", "size": "1 KB",
                     "capabilities": ["generate"], "steps": 10, "delay": 0.02},
            "fake-slow": {"adapter": "fake_slow", "license": "MIT", "capabilities": ["generate", "subject"],
                          "steps": 200, "delay": 0.02},
            "fake-all": {"adapter": "fake_slow", "license": "MIT",
                         "capabilities": ["segment_text", "inpaint", "variations"]},
        },
    }


# pytest would otherwise try to collect the helper above as a test
test_config.__test__ = False  # type: ignore[attr-defined]


@pytest.fixture
def registry() -> Registry:
    return Registry(test_config(), device="cpu")


@pytest.fixture
def client(registry):
    app = create_app(registry, allow_origins=["https://labels.example.com"], max_queue=3, job_ttl=600)
    with TestClient(app, base_url="http://localhost") as c:
        yield c
