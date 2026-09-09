"""Bounded OCR execution; HTTP callers never own a model's worker lifetime."""

import asyncio
import importlib.util
import logging
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

if __package__:
    from .image_decoder import ImageInputError, decode_image
else:
    from image_decoder import ImageInputError, decode_image

logger = logging.getLogger("vt.runtime")


class OcrError(Exception):
    """A stable failure returned across the runtime's interface."""

    def __init__(self, message: str, *, status_code: int = 500, code: str = "ocr_failed"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class _EngineWorker:
    """One actual worker per engine, with bounded admitted work and model cache."""

    def __init__(self, name, factory, *, max_pending, max_models=1):
        self.name = name
        self.factory = factory
        self.max_models = max_models
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"ocr-{name}")
        self._capacity = threading.BoundedSemaphore(max_pending + 1)
        self._lock = threading.Lock()
        self._models = OrderedDict()
        self._loading = set()
        self._admitted = 0
        self._closed = False

    def snapshot(self):
        with self._lock:
            return {
                "available": self.factory is not None,
                "loaded": list(self._models),
                "loading": sorted(self._loading),
                "admitted": self._admitted,
            }

    def submit(self, key, image_bytes, method, *args):
        if self.factory is None:
            raise OcrError(
                f"{self.name} is not installed. See requirements-ocr.txt.",
                status_code=501, code="ocr_unavailable",
            )
        if not self._capacity.acquire(blocking=False):
            raise OcrError(
                f"{self.name} is busy. Retry after the current images finish.",
                status_code=429, code="ocr_busy",
            )
        with self._lock:
            if self._closed:
                self._capacity.release()
                raise OcrError("OCR runtime is shutting down.", status_code=503, code="ocr_closed")
            self._admitted += 1
            try:
                future = self._executor.submit(self._process, key, image_bytes, method, args)
            except BaseException:
                self._admitted -= 1
                self._capacity.release()
                raise
        # A cancelled asyncio waiter cannot cancel a running concurrent Future.
        # This callback runs only when work finishes or queued work is cancelled.
        future.add_done_callback(self._release)
        return future

    def _release(self, _future):
        with self._lock:
            self._admitted -= 1
        self._capacity.release()

    def _model(self, key):
        with self._lock:
            if key in self._models:
                self._models.move_to_end(key)
                return self._models[key]
            self._loading.add(key)
        try:
            model = self.factory(key)
        finally:
            with self._lock:
                self._loading.discard(key)
        with self._lock:
            self._models[key] = model
            while len(self._models) > self.max_models:
                self._models.popitem(last=False)
        return model

    def _process(self, key, image_bytes, method, args):
        try:
            # Admission precedes decompression; validation precedes model load.
            with decode_image(image_bytes) as image:
                model = self._model(key)
                return getattr(model, method)(image, *args)
        except ImageInputError as error:
            raise OcrError(
                str(error), status_code=413 if error.too_large else 400,
                code="invalid_image",
            ) from error
        except Exception as error:
            logger.exception("%s processing failed", self.name)
            raise OcrError(f"{self.name} processing failed: {error}") from error

    def close(self):
        with self._lock:
            self._closed = True
        self._executor.shutdown(wait=True, cancel_futures=True)
        with self._lock:
            self._models.clear()


class OcrRuntime:
    """Own model loading, bounded admission, execution, cancellation and status.

    Factories construct an adapter for a model key. Each adapter receives an
    already validated RGB PIL image. There is one worker per engine, at most
    `max_pending` queued requests per engine, and two cached Paddle languages.
    Cancelling an await stops accepting its result; it never frees capacity
    while the underlying model is still running.
    """

    def __init__(self, *, paddle_factory=None, manga_factory=None, max_pending=4):
        if not isinstance(max_pending, int) or max_pending < 0:
            raise ValueError("max_pending must be a non-negative integer")
        self._paddle = _EngineWorker("PaddleOCR", paddle_factory, max_pending=max_pending, max_models=2)
        self._manga = _EngineWorker("MangaOCR", manga_factory, max_pending=max_pending)

    async def paddle(self, image_bytes: bytes, language: str):
        return await asyncio.wrap_future(
            self._paddle.submit(language, image_bytes, "process_image")
        )

    async def manga(self, image_bytes: bytes, bboxes: list[list[int]]):
        return await asyncio.wrap_future(
            self._manga.submit("japan", image_bytes, "process_regions", bboxes)
        )

    def status(self):
        paddle, manga = self._paddle.snapshot(), self._manga.snapshot()
        return {
            "paddle_ocr_available": paddle["available"],
            "paddle_ocr_loaded": bool(paddle["loaded"]),
            "paddle_ocr_loading": bool(paddle["loading"]),
            "manga_ocr_available": manga["available"],
            "manga_ocr_loaded": bool(manga["loaded"]),
            "manga_ocr_loading": bool(manga["loading"]),
            "manga_full_available": paddle["available"] and manga["available"],
            "paddle_loaded_languages": paddle["loaded"],
            "paddle_loading_languages": paddle["loading"],
        }

    def close(self):
        """Drain active workers and cancel queued work during app shutdown."""
        self._paddle.close()
        self._manga.close()


def create_default_runtime():
    """Discover installed packages without loading OCR libraries or models."""
    def paddle_factory(language):
        if __package__:
            from .ocr_engines.paddle_ocr import PaddleOCREngine
        else:
            from ocr_engines.paddle_ocr import PaddleOCREngine
        return PaddleOCREngine(language)

    def manga_factory(_language):
        if __package__:
            from .ocr_engines.manga_ocr import MangaOCREngine
        else:
            from ocr_engines.manga_ocr import MangaOCREngine
        return MangaOCREngine()

    return OcrRuntime(
        paddle_factory=paddle_factory if all(
            importlib.util.find_spec(name) is not None for name in ("paddleocr", "paddle")
        ) else None,
        manga_factory=manga_factory if importlib.util.find_spec("manga_ocr") else None,
    )
