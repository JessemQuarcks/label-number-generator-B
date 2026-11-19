"""Error types shared by the server, registry, job queue and adapters."""

from __future__ import annotations


class ApiError(Exception):
    """An error that maps directly onto an HTTP response ``{"error": {"code", "message"}}``."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message}


def bad_request(message: str) -> ApiError:
    return ApiError(400, "bad_request", message)


def not_found(message: str) -> ApiError:
    return ApiError(404, "not_found", message)


def model_unavailable(message: str) -> ApiError:
    return ApiError(409, "model_unavailable", message)


def busy(message: str) -> ApiError:
    return ApiError(429, "busy", message)


class Cancelled(Exception):
    """Raised inside a running job when the client cancelled it."""

    def __init__(self, message: str = "Job was cancelled"):
        super().__init__(message)
