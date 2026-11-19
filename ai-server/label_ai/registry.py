"""Model registry: adapter registration, models.toml loading, availability, lazy load/unload.

Concepts
--------
* ``@register_adapter("name")`` registers an :class:`~label_ai.adapters.base.Adapter` subclass.
  All modules in ``label_ai/adapters/`` are imported automatically, so dropping a new file
  there is enough to make its adapters available.
* ``models.toml`` declares *models* (adapter + options) and *profiles* (capability -> default
  model id).
* Models are instantiated lazily, loaded on first use and unloaded LRU-style so that at most
  ``max_loaded`` heavy models are resident at once.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import importlib.util
import logging
import pkgutil
import re
import threading
import time
try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib  # type: ignore[no-redef]
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import CAPABILITIES
from .adapters.base import Adapter, RunContext
from .device import dtype_name_for, empty_cache, select_device, to_torch_dtype, torch_installed
from .errors import model_unavailable, not_found

log = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "models.toml"
PROFILES = ("lite", "standard", "quality")
_RESERVED_KEYS = {"adapter", "name", "description", "license", "size", "capabilities"}

# --------------------------------------------------------------------------- adapter registry

_ADAPTERS: dict[str, type[Adapter]] = {}
_discovered = False
_discover_lock = threading.Lock()


def register_adapter(name: str):
    """Class decorator registering an Adapter subclass under ``name`` (used in models.toml)."""

    def deco(cls: type[Adapter]) -> type[Adapter]:
        if not (isinstance(cls, type) and issubclass(cls, Adapter)):
            raise TypeError(f"@register_adapter({name!r}) must decorate an Adapter subclass")
        bad = [c for c in cls.capabilities if c not in CAPABILITIES]
        if bad:
            raise ValueError(f"adapter {name!r} declares unknown capabilities {bad}")
        _ADAPTERS[name] = cls
        cls.adapter_name = name  # type: ignore[attr-defined]
        return cls

    return deco


def discover_adapters() -> dict[str, type[Adapter]]:
    """Import every module in ``label_ai.adapters`` (once) so their decorators run."""
    global _discovered
    with _discover_lock:
        if not _discovered:
            from . import adapters as pkg

            for mod in pkgutil.iter_modules(pkg.__path__):
                if mod.name.startswith("_") or mod.name == "base":
                    continue
                try:
                    importlib.import_module(f"{pkg.__name__}.{mod.name}")
                except Exception:  # an adapter module must never take the server down
                    log.exception("failed to import adapter module %s", mod.name)
            _discovered = True
    return dict(_ADAPTERS)


def get_adapter_class(name: str) -> type[Adapter] | None:
    discover_adapters()
    return _ADAPTERS.get(name)


# --------------------------------------------------------------------------- availability

_spec_cache: dict[str, bool] = {}


def module_available(name: str) -> bool:
    if name not in _spec_cache:
        try:
            _spec_cache[name] = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            _spec_cache[name] = False
    return _spec_cache[name]


def _version_tuple(v: str) -> tuple[int, ...]:
    parts = []
    for p in v.split("."):
        m = re.match(r"\d+", p)
        if not m:
            break
        parts.append(int(m.group()))
    return tuple(parts)


def version_at_least(dist: str, minimum: str) -> bool | None:
    """True/False if the distribution is installed, None if it is not installed."""
    try:
        installed = importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError:
        return None
    return _version_tuple(installed) >= _version_tuple(minimum)


# --------------------------------------------------------------------------- config


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    path = Path(path) if path else DEFAULT_CONFIG_PATH
    with open(path, "rb") as fh:
        return tomllib.load(fh)


@dataclass
class ModelEntry:
    id: str
    adapter: str
    name: str
    description: str
    license: str
    size: str | None
    capabilities: list[str]
    options: dict[str, Any]
    adapter_cls: type[Adapter] | None
    config_error: str | None = None
    instance: Adapter | None = None
    loaded: bool = False
    last_used: float = 0.0
    lock: threading.RLock = field(default_factory=threading.RLock)

    @property
    def heavy(self) -> bool:
        return bool(self.adapter_cls.heavy) if self.adapter_cls else False

    @property
    def exclusive(self) -> bool:
        return bool(self.options.get("exclusive", False))


class Registry:
    def __init__(self, config: dict[str, Any], *, profile: str | None = None, device: str = "auto"):
        discover_adapters()
        self.config = config
        server_cfg = config.get("server", {})
        self.max_loaded = max(1, int(server_cfg.get("max_loaded", 2)))
        self.profiles: dict[str, dict[str, str]] = {
            name: dict((p or {}).get("defaults", {})) for name, p in config.get("profiles", {}).items()
        }
        self.profile = profile or server_cfg.get("default_profile", "standard")
        if self.profiles and self.profile not in self.profiles:
            raise ValueError(f"unknown profile {self.profile!r}; available: {sorted(self.profiles)}")
        self.device = select_device(device)
        self.entries: OrderedDict[str, ModelEntry] = OrderedDict()
        for model_id, spec in config.get("models", {}).items():
            self.entries[model_id] = self._make_entry(model_id, dict(spec))
        self._state_lock = threading.RLock()
        # Serialises all heavy (accelerator) work: the job worker and synchronous /api/run.
        self.gpu_lock = threading.Lock()
        self._availability_cache: dict[str, str | None] = {}

    @classmethod
    def from_file(cls, path: str | Path | None = None, **kwargs) -> "Registry":
        return cls(load_config(path), **kwargs)

    # ---- construction --------------------------------------------------------

    def _make_entry(self, model_id: str, spec: dict[str, Any]) -> ModelEntry:
        adapter_name = str(spec.get("adapter", ""))
        cls = get_adapter_class(adapter_name)
        error = None
        caps = spec.get("capabilities")
        if cls is None:
            error = f"unknown adapter {adapter_name!r}"
            caps = [c for c in (caps or []) if c in CAPABILITIES]
        else:
            if caps is None:
                caps = list(cls.capabilities)
            unsupported = [c for c in caps if c not in cls.capabilities]
            if unsupported:
                log.warning("model %s: adapter %s cannot serve %s; ignoring", model_id, adapter_name, unsupported)
            caps = [c for c in caps if c in cls.capabilities]
        options = {k: v for k, v in spec.items() if k not in _RESERVED_KEYS}
        return ModelEntry(
            id=model_id,
            adapter=adapter_name,
            name=str(spec.get("name", model_id)),
            description=str(spec.get("description", "")),
            license=str(spec.get("license", "unknown")),
            size=str(spec["size"]) if spec.get("size") is not None else None,
            capabilities=list(caps),
            options=options,
            adapter_cls=cls,
            config_error=error,
        )

    # ---- availability & defaults --------------------------------------------

    def unavailable_reason(self, entry: ModelEntry) -> str | None:
        if entry.id in self._availability_cache:
            return self._availability_cache[entry.id]
        reason = self._compute_reason(entry)
        self._availability_cache[entry.id] = reason
        return reason

    def _compute_reason(self, entry: ModelEntry) -> str | None:
        if entry.config_error:
            return entry.config_error
        cls = entry.adapter_cls
        assert cls is not None
        requires = list(cls.requires) + list(entry.options.get("requires", []))
        missing = [m for m in requires if not module_available(m)]
        if missing:
            return f"missing python packages: {', '.join(missing)} - {cls.install_hint}"
        min_versions = dict(cls.min_versions)
        min_versions.update(entry.options.get("min_versions", {}))
        for dist, minimum in min_versions.items():
            ok = version_at_least(dist, minimum)
            if ok is None:
                return f"missing python package: {dist} - {cls.install_hint}"
            if not ok:
                return f"needs {dist}>={minimum} (installed {importlib.metadata.version(dist)}) - pip install -U '{dist}>={minimum}'"
        try:
            return cls.check_available(entry.options)
        except Exception as exc:  # pragma: no cover - defensive
            return f"availability check failed: {exc}"

    def is_available(self, entry: ModelEntry) -> bool:
        return self.unavailable_reason(entry) is None

    def models_for(self, capability: str) -> list[ModelEntry]:
        return [e for e in self.entries.values() if capability in e.capabilities]

    def default_for(self, capability: str) -> str | None:
        configured = self.profiles.get(self.profile, {}).get(capability)
        if configured:
            entry = self.entries.get(configured)
            if entry and capability in entry.capabilities and self.is_available(entry):
                return entry.id
        for entry in self.models_for(capability):
            if self.is_available(entry):
                return entry.id
        return None

    def model_info(self, entry: ModelEntry) -> dict[str, Any]:
        reason = self.unavailable_reason(entry)
        return {
            "id": entry.id,
            "name": entry.name,
            "capabilities": list(entry.capabilities),
            "description": entry.description,
            "license": entry.license,
            "available": reason is None,
            "loaded": entry.loaded,
            "reason": reason,
            "size": entry.size,
        }

    def models_payload(self) -> dict[str, Any]:
        return {
            "capabilities": {
                cap: {
                    "default": self.default_for(cap),
                    "models": [self.model_info(e) for e in self.models_for(cap)],
                }
                for cap in CAPABILITIES
            }
        }

    # ---- resolution ----------------------------------------------------------

    def resolve(self, capability: str, model_id: str | None) -> ModelEntry:
        if capability not in CAPABILITIES:
            raise not_found(f"unknown capability {capability!r}")
        if model_id is None:
            default = self.default_for(capability)
            if default is None:
                hint = ""
                if self.models_for(capability):
                    hint = " - " + (self.unavailable_reason(self.models_for(capability)[0]) or "")
                raise model_unavailable(f"no available model for capability {capability!r}{hint}")
            return self.entries[default]
        entry = self.entries.get(model_id)
        if entry is None:
            raise not_found(f"unknown model {model_id!r}")
        if capability not in entry.capabilities:
            raise model_unavailable(f"model {model_id!r} does not serve capability {capability!r}")
        reason = self.unavailable_reason(entry)
        if reason:
            raise model_unavailable(f"model {model_id!r} is unavailable: {reason}")
        return entry

    # ---- lifecycle -----------------------------------------------------------

    def _instance(self, entry: ModelEntry) -> Adapter:
        if entry.instance is None:
            assert entry.adapter_cls is not None
            entry.instance = entry.adapter_cls(entry.id, entry.options)
        return entry.instance

    def ensure_loaded(self, entry: ModelEntry, ctx: RunContext | None = None) -> Adapter:
        with self._state_lock:
            inst = self._instance(entry)
            if entry.loaded:
                entry.last_used = time.monotonic()
                return inst
            if entry.heavy:
                self._make_room_for(entry)
        with entry.lock:
            if not entry.loaded:
                if ctx is not None:
                    ctx.message(f"Loading model {entry.id}…")
                log.info("loading model %s (adapter %s) on %s", entry.id, entry.adapter, self.device)
                dtype = None
                if torch_installed() and entry.adapter_cls and "torch" in entry.adapter_cls.requires:
                    dtype = to_torch_dtype(dtype_name_for(self.device, entry.options))
                inst.device, inst.dtype = self.device, dtype
                t0 = time.monotonic()
                try:
                    inst.load(self.device, dtype)
                except BaseException:
                    try:
                        inst.unload()
                    except Exception:
                        pass
                    entry.instance = None
                    if entry.heavy:
                        empty_cache(self.device)
                    raise
                entry.loaded = True
                log.info("loaded %s in %.1fs", entry.id, time.monotonic() - t0)
                if ctx is not None:
                    ctx.message(f"Running {entry.id}…")
            entry.last_used = time.monotonic()
        return inst

    def _make_room_for(self, entry: ModelEntry) -> None:
        loaded = [e for e in self.entries.values() if e.loaded and e.heavy and e.id != entry.id]
        if entry.exclusive or any(e.exclusive for e in loaded):
            victims = loaded
        else:
            loaded.sort(key=lambda e: e.last_used)
            victims = loaded[: max(0, len(loaded) - (self.max_loaded - 1))]
        for victim in victims:
            log.info("unloading %s to make room for %s", victim.id, entry.id)
            self._unload_entry(victim)

    def _unload_entry(self, entry: ModelEntry) -> None:
        with entry.lock:
            if entry.instance is not None and entry.loaded:
                try:
                    entry.instance.unload()
                except Exception:  # pragma: no cover - best effort
                    log.exception("error unloading %s", entry.id)
            entry.loaded = False
            entry.instance = None
        if entry.heavy:
            empty_cache(self.device)

    def unload(self, model_id: str) -> None:
        entry = self.entries.get(model_id)
        if entry is None:
            raise not_found(f"unknown model {model_id!r}")
        with self._state_lock:
            self._unload_entry(entry)

    def unload_all(self) -> None:
        for entry in self.entries.values():
            if entry.loaded:
                self._unload_entry(entry)

    # ---- execution -----------------------------------------------------------

    def execute(self, entry: ModelEntry, capability: str, params: dict[str, Any], ctx: RunContext) -> dict[str, Any]:
        """Load (if needed) and run. Callers serialise heavy work via ``gpu_lock``."""
        ctx.check_cancelled()
        inst = self.ensure_loaded(entry, ctx)
        ctx.check_cancelled()
        method = getattr(inst, capability, None)
        if method is None:
            raise model_unavailable(f"model {entry.id!r} does not implement {capability!r}")
        result = method(params, ctx)
        entry.last_used = time.monotonic()
        return result
