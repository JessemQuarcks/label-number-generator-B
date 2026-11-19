"""Background job queue.

A single worker thread executes jobs one at a time (accelerator work is serial anyway).
Jobs report progress through :class:`RunContext`, can be cancelled while queued or running
(adapters call ``ctx.check_cancelled()``; diffusion loops do so every step) and are kept for
``ttl`` seconds after they finish.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from .adapters.base import RunContext
from .errors import ApiError, Cancelled, busy, not_found

log = logging.getLogger(__name__)

Runner = Callable[[str, "str | None", dict, RunContext], dict]

FINISHED = ("done", "error", "cancelled")


@dataclass
class Job:
    id: str
    capability: str
    model: str | None
    params: dict[str, Any]
    status: str = "queued"
    progress: float = 0.0
    message: str | None = None
    result: dict[str, Any] | None = None
    error: dict[str, str] | None = None
    created: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    done_event: threading.Event = field(default_factory=threading.Event)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "capability": self.capability,
            "model": self.model,
            "status": self.status,
            "progress": round(self.progress, 4),
            "message": self.message,
            "result": self.result,
            "error": self.error,
        }


class JobManager:
    def __init__(self, runner: Runner, *, max_queue: int = 16, ttl: float = 600.0):
        self._runner = runner
        self.max_queue = max_queue
        self.ttl = ttl
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._queue: "queue.Queue[Job | None]" = queue.Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ---- lifecycle -------------------------------------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._worker, name="label-ai-worker", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        with self._lock:
            for job in self._jobs.values():
                if job.status in ("queued", "running"):
                    job.cancel_event.set()
        self._queue.put(None)
        if self._thread:
            self._thread.join(timeout)

    # ---- public API ------------------------------------------------------------

    def submit(self, capability: str, model: str | None, params: dict[str, Any]) -> Job:
        self.cleanup()
        with self._lock:
            pending = sum(1 for j in self._jobs.values() if j.status in ("queued", "running"))
            if pending >= self.max_queue:
                raise busy(f"job queue is full ({self.max_queue} pending); try again later")
            job = Job(id=uuid.uuid4().hex, capability=capability, model=model, params=params)
            self._jobs[job.id] = job
        self.start()
        self._queue.put(job)
        return job

    def get(self, job_id: str) -> Job:
        self.cleanup()
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise not_found(f"unknown job {job_id!r}")
        return job

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        with self._lock:
            if job.status == "queued":
                self._finish(job, "cancelled", error={"code": "cancelled", "message": "Job was cancelled"})
            elif job.status == "running":
                job.cancel_event.set()
                job.message = "Cancelling…"
        return job

    def cleanup(self) -> None:
        now = time.monotonic()
        with self._lock:
            expired = [j.id for j in self._jobs.values()
                       if j.finished_at is not None and now - j.finished_at > self.ttl]
            for jid in expired:
                del self._jobs[jid]

    def wait(self, job_id: str, timeout: float | None = None) -> Job:
        job = self.get(job_id)
        job.done_event.wait(timeout)
        return job

    # ---- internals -------------------------------------------------------------

    def _finish(self, job: Job, status: str, *, result=None, error=None) -> None:
        job.status = status
        job.result = result
        job.error = error
        job.finished_at = time.monotonic()
        if status == "done":
            job.progress = 1.0
        job.params = {}  # free decoded images
        job.done_event.set()

    def _worker(self) -> None:
        while not self._stop.is_set():
            try:
                job = self._queue.get(timeout=30)
            except queue.Empty:
                self.cleanup()
                continue
            if job is None:
                break
            with self._lock:
                if job.status != "queued":  # cancelled while waiting
                    continue
                if job.cancel_event.is_set():
                    self._finish(job, "cancelled", error={"code": "cancelled", "message": "Job was cancelled"})
                    continue
                job.status = "running"
            self._run(job)

    def _run(self, job: Job) -> None:
        def progress(fraction: float, message: str | None) -> None:
            if fraction >= 0:
                job.progress = max(job.progress, min(1.0, fraction))
            if message is not None:
                job.message = message

        ctx = RunContext(progress, job.cancel_event)
        try:
            result = self._runner(job.capability, job.model, job.params, ctx)
            if job.cancel_event.is_set():
                raise Cancelled()
        except Cancelled:
            with self._lock:
                job.message = "Cancelled"
                self._finish(job, "cancelled", error={"code": "cancelled", "message": "Job was cancelled"})
            log.info("job %s cancelled", job.id)
        except ApiError as exc:
            with self._lock:
                self._finish(job, "error", error=exc.to_dict())
        except Exception as exc:
            log.error("job %s failed:\n%s", job.id, traceback.format_exc())
            with self._lock:
                self._finish(job, "error", error={"code": "internal", "message": f"{type(exc).__name__}: {exc}"})
        else:
            with self._lock:
                job.message = None
                self._finish(job, "done", result=result)
