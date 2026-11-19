import pytest

from label_ai import CAPABILITIES
from label_ai.errors import ApiError
from label_ai.registry import Registry, discover_adapters, load_config, module_available

from .conftest import FakeSlowAdapter, test_config

NO_TORCH = not module_available("torch")


def test_all_builtin_adapters_are_discovered():
    names = set(discover_adapters())
    assert {"sam", "sam2", "birefnet", "clipseg", "grounded_sam", "lama", "diffusion", "qwen_image_edit",
            "instruct_pix2pix", "grabcut", "grabcut_center", "guided_filter", "opencv_inpaint"} <= names


def test_models_toml_is_consistent():
    cfg = load_config()
    reg = Registry(cfg, device="cpu")
    assert reg.profile == "standard"
    assert set(reg.profiles) == {"lite", "standard", "quality"}
    for name, defaults in reg.profiles.items():
        assert set(defaults) == set(CAPABILITIES), name
        for cap, model_id in defaults.items():
            assert model_id in reg.entries, (name, cap, model_id)
            assert cap in reg.entries[model_id].capabilities, (name, cap, model_id)
    for entry in reg.entries.values():
        assert entry.config_error is None, entry.id
        assert entry.capabilities, entry.id
        assert entry.license and entry.license != "unknown", entry.id


@pytest.mark.skipif(not NO_TORCH, reason="checks the core-only fallback; torch is installed")
@pytest.mark.parametrize("profile", ["lite", "standard", "quality"])
def test_core_only_defaults_fall_back_to_classical(profile):
    reg = Registry(load_config(), profile=profile, device="cpu")
    assert reg.device == "cpu"
    assert reg.default_for("segment") == "grabcut"
    assert reg.default_for("subject") == "grabcut-center"
    assert reg.default_for("matte") == "guided-filter"
    assert reg.default_for("remove") == "opencv-telea"
    for cap in ("segment_text", "inpaint", "generate", "variations", "edit"):
        assert reg.default_for(cap) is None
    sam = reg.model_info(reg.entries["sam-vit-base"])
    assert sam["available"] is False and "requirements-models.txt" in sam["reason"]


def test_profile_default_and_fallback(registry):
    # standard -> generate: "fake" (available) is used
    assert registry.default_for("generate") == "fake"
    # standard -> segment: configured default is unavailable -> first available segment model
    assert registry.default_for("segment") == "grabcut"
    # no default configured -> first available model
    assert registry.default_for("matte") == "guided-filter"
    assert registry.default_for("edit") is None
    lite = Registry(test_config(), profile="lite", device="cpu")
    assert lite.default_for("generate") == "fake"


def test_unknown_profile_rejected():
    with pytest.raises(ValueError):
        Registry(test_config(), profile="nope", device="cpu")


def test_unknown_adapter_is_reported_not_fatal():
    cfg = test_config()
    cfg["models"]["weird"] = {"adapter": "does_not_exist", "capabilities": ["segment"]}
    reg = Registry(cfg, device="cpu")
    info = reg.model_info(reg.entries["weird"])
    assert info["available"] is False and "unknown adapter" in info["reason"]


def test_resolve_errors(registry):
    with pytest.raises(ApiError) as e:
        registry.resolve("segment", "nope")
    assert e.value.status == 404
    with pytest.raises(ApiError) as e:
        registry.resolve("segment", "opencv-telea")
    assert e.value.status == 409 and e.value.code == "model_unavailable"
    with pytest.raises(ApiError) as e:
        registry.resolve("segment", "unavailable-model")
    assert e.value.status == 409
    with pytest.raises(ApiError) as e:
        registry.resolve("edit", None)
    assert e.value.status == 409
    with pytest.raises(ApiError) as e:
        registry.resolve("teleport", None)
    assert e.value.status == 404


def test_lru_unloading_respects_max_loaded():
    cfg = test_config(max_loaded=1)
    reg = Registry(cfg, device="cpu")
    before = FakeSlowAdapter.unloads
    reg.ensure_loaded(reg.entries["fake"])
    assert reg.entries["fake"].loaded
    reg.ensure_loaded(reg.entries["fake-slow"])
    assert reg.entries["fake-slow"].loaded and not reg.entries["fake"].loaded
    assert FakeSlowAdapter.unloads == before + 1
    # light (classical) models do not count towards max_loaded
    reg.ensure_loaded(reg.entries["grabcut"])
    assert reg.entries["fake-slow"].loaded
    reg.unload("fake-slow")
    assert not reg.entries["fake-slow"].loaded
