"""CLI entry point: ``python -m label_ai [--host] [--port] [--config] [--profile] [--device] [--allow-origin ...]``."""

from __future__ import annotations

import argparse
import logging
import os
import sys

from . import __version__


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="label_ai", description="Local open-weight AI server for the label editor")
    p.add_argument("--host", default=os.environ.get("LABEL_AI_HOST", "127.0.0.1"),
                   help="bind address (default 127.0.0.1; the server has no auth - keep it on loopback)")
    p.add_argument("--port", type=int, default=int(os.environ.get("LABEL_AI_PORT", "8765")))
    p.add_argument("--config", default=os.environ.get("LABEL_AI_CONFIG"), help="path to models.toml")
    p.add_argument("--profile", choices=("lite", "standard", "quality"), default=os.environ.get("LABEL_AI_PROFILE"),
                   help="default-model profile (default: [server].default_profile in models.toml, i.e. standard)")
    p.add_argument("--device", choices=("auto", "cuda", "mps", "cpu"), default=os.environ.get("LABEL_AI_DEVICE", "auto"))
    p.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN",
                   help="extra CORS origin to allow (repeatable), e.g. https://labels.example.com")
    p.add_argument("--max-loaded", type=int, default=None, help="override [server].max_loaded")
    p.add_argument("--log-level", default="info", choices=("debug", "info", "warning", "error"))
    p.add_argument("--version", action="version", version=f"label_ai {__version__}")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("label_ai")

    import uvicorn

    from .registry import Registry, load_config
    from .server import DEFAULT_ALLOWED_HOSTS, create_app

    config = load_config(args.config)
    if args.max_loaded is not None:
        config.setdefault("server", {})["max_loaded"] = args.max_loaded
    try:
        registry = Registry(config, profile=args.profile, device=args.device)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    allowed_hosts: list[str] | None = list(DEFAULT_ALLOWED_HOSTS)
    if args.host in ("0.0.0.0", "::", ""):
        log.warning("binding to all interfaces: the server has NO authentication; anyone on your network can use it")
        allowed_hosts = None
    elif args.host.lower() not in allowed_hosts:
        allowed_hosts.append(args.host.lower())

    app = create_app(registry, allow_origins=args.allow_origin, allowed_hosts=allowed_hosts)
    available = sum(1 for e in registry.entries.values() if registry.is_available(e))
    log.info("label_ai %s - device=%s profile=%s - %d/%d models available", __version__, registry.device,
             registry.profile, available, len(registry.entries))
    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)
    return 0


if __name__ == "__main__":
    sys.exit(main())
