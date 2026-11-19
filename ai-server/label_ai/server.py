"""FastAPI application: routes, CORS, error mapping, result encoding."""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Iterable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import CAPABILITIES, __version__
from .adapters.base import RunContext
from .errors import ApiError, bad_request, not_found
from .imageio import encode_mask, encode_png, resize, resize_cover
from .jobs import JobManager
from .params import output_size, validate
from .registry import ModelEntry, Registry

log = logging.getLogger(__name__)

DEFAULT_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"
DEFAULT_ALLOWED_HOSTS = ("localhost", "127.0.0.1", "[::1]", "::1")

MASK_CAPS = {"segment", "subject", "segment_text", "matte"}
IMAGE_CAPS = {"remove", "inpaint", "generate", "variations", "edit"}


# --------------------------------------------------------------------------- results


def encode_result(capability: str, raw: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    """Turn an adapter's raw result (PIL images) into the JSON contract, enforcing sizes."""
    if not isinstance(raw, dict):
        raise TypeError(f"adapter returned {type(raw).__name__}, expected dict")
    size = output_size(capability, params)
    if capability in MASK_CAPS:
        mask = raw.get("mask")
        if mask is None:
            raise RuntimeError("adapter returned no mask")
        out: dict[str, Any] = {"mask": mask if isinstance(mask, str) else encode_mask(mask, size)}
        if capability == "segment":
            out["score"] = float(raw.get("score", 0.0))
        if capability == "segment_text":
            out["found"] = bool(raw.get("found", False))
        return out
    images = raw.get("images") or []
    if not images:
        raise RuntimeError("adapter returned no images")
    encoded = []
    for img in images:
        if isinstance(img, str):
            encoded.append(img)
            continue
        img = img.convert("RGB") if img.mode not in ("RGB", "RGBA") else img
        if size is not None and img.size != tuple(size):
            img = resize_cover(img, size) if capability == "generate" else resize(img, size)
        encoded.append(encode_png(img))
    if capability == "remove":
        seeds = [0] * len(encoded)
    else:
        seeds = [int(s) for s in raw.get("seeds", params.get("seeds", []))][: len(encoded)]
        while len(seeds) < len(encoded):
            seeds.append(int(params.get("seed", 0)) + len(seeds))
    return {"images": encoded, "seeds": seeds}


# --------------------------------------------------------------------------- app


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def _host_allowed(host_header: str, allowed: set[str]) -> bool:
    if "*" in allowed:
        return True
    host = host_header.strip().lower()
    if host.startswith("["):  # [::1]:8765
        host = host[: host.find("]") + 1] if "]" in host else host
    elif host.count(":") == 1:
        host = host.split(":", 1)[0]
    return host in allowed


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise bad_request("request body must be valid JSON") from None
    if not isinstance(data, dict):
        raise bad_request("request body must be a JSON object")
    return data


def _model_arg(body: dict[str, Any]) -> str | None:
    model = body.get("model")
    if model is None or model == "":
        return None
    if not isinstance(model, str):
        raise bad_request("'model' must be a string")
    return model


def create_app(
    registry: Registry,
    *,
    allow_origins: Iterable[str] = (),
    allow_origin_regex: str | None = DEFAULT_ORIGIN_REGEX,
    allowed_hosts: Iterable[str] | None = DEFAULT_ALLOWED_HOSTS,
    max_queue: int = 16,
    job_ttl: float = 600.0,
) -> FastAPI:
    """Build the FastAPI app.

    ``allowed_hosts`` guards against DNS-rebinding (requests whose Host header is not a
    loopback name are rejected). Pass ``None`` or ``["*"]`` to disable the check.
    """

    def run_now(capability: str, model_id: str | None, params: dict[str, Any], ctx: RunContext) -> dict[str, Any]:
        entry: ModelEntry = registry.resolve(capability, model_id)
        if entry.heavy:
            # Wait for the accelerator, but stay responsive to cancellation while waiting.
            while not registry.gpu_lock.acquire(timeout=0.25):
                ctx.check_cancelled()
            try:
                raw = registry.execute(entry, capability, params, ctx)
            finally:
                registry.gpu_lock.release()
        else:
            raw = registry.execute(entry, capability, params, ctx)
        ctx.check_cancelled()
        return encode_result(capability, raw, params)

    jobs = JobManager(run_now, max_queue=max_queue, ttl=job_ttl)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        jobs.start()
        try:
            yield
        finally:
            jobs.stop()
            registry.unload_all()

    app = FastAPI(title="label_ai", version=__version__, lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)
    app.state.registry = registry
    app.state.jobs = jobs

    # ---- middleware (last added = outermost) ---------------------------------

    @app.middleware("http")
    async def catch_all(request: Request, call_next):
        try:
            return await call_next(request)
        except ApiError as exc:
            return _err(exc.status, exc.code, exc.message)
        except Exception as exc:  # keep CORS headers on 500s
            log.exception("unhandled error on %s %s", request.method, request.url.path)
            return _err(500, "internal", f"{type(exc).__name__}: {exc}")

    hosts = set(h.lower() for h in allowed_hosts) if allowed_hosts else {"*"}

    @app.middleware("http")
    async def check_host(request: Request, call_next):
        if not _host_allowed(request.headers.get("host", ""), hosts):
            return _err(400, "bad_request", "invalid Host header")
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allow_origins),
        allow_origin_regex=allow_origin_regex,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        max_age=600,
    )

    # ---- error handlers ------------------------------------------------------

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError):
        return _err(exc.status, exc.code, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException):
        code = "not_found" if exc.status_code == 404 else "internal" if exc.status_code >= 500 else "bad_request"
        return _err(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        return _err(400, "bad_request", str(exc.errors()))

    # ---- routes ---------------------------------------------------------------

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": __version__, "device": registry.device, "profile": registry.profile}

    @app.get("/api/models")
    async def models():
        return registry.models_payload()

    @app.post("/api/run/{capability}")
    async def run(capability: str, request: Request):
        if capability not in CAPABILITIES:
            raise not_found(f"unknown capability {capability!r}")
        body = await _body(request)
        model_id = _model_arg(body)
        entry = registry.resolve(capability, model_id)
        params = await run_in_threadpool(validate, capability, body.get("params"))
        ctx = RunContext()
        return await run_in_threadpool(run_now, capability, entry.id, params, ctx)

    @app.post("/api/jobs", status_code=202)
    async def submit_job(request: Request):
        body = await _body(request)
        capability = body.get("capability")
        if not isinstance(capability, str) or not capability:
            raise bad_request("'capability' is required")
        if capability not in CAPABILITIES:
            raise not_found(f"unknown capability {capability!r}")
        entry = registry.resolve(capability, _model_arg(body))
        params = await run_in_threadpool(validate, capability, body.get("params"))
        job = jobs.submit(capability, entry.id, params)
        return JSONResponse({"id": job.id, "status": job.status}, status_code=202)

    @app.get("/api/jobs/{job_id}")
    async def get_job(job_id: str):
        return jobs.get(job_id).to_dict()

    @app.delete("/api/jobs/{job_id}")
    async def cancel_job(job_id: str):
        job = jobs.cancel(job_id)
        return {"id": job.id, "status": job.status}

    @app.post("/api/models/{model_id}/unload")
    async def unload_model(model_id: str):
        entry = registry.entries.get(model_id)
        if entry is None:
            raise not_found(f"unknown model {model_id!r}")

        def _unload():
            if entry.heavy and entry.loaded:
                with registry.gpu_lock:  # wait for a running job using the accelerator
                    registry.unload(model_id)
            else:
                registry.unload(model_id)

        await run_in_threadpool(_unload)
        return {"id": model_id, "loaded": False}

    return app
