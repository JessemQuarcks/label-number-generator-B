"""Model adapters. Every module in this package is imported automatically by the registry
(``label_ai.registry.discover_adapters``); modules starting with ``_`` are skipped."""

from .base import Adapter, RunContext

__all__ = ["Adapter", "RunContext"]
