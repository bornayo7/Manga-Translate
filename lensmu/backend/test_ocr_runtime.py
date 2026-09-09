"""Behavior at the OCR runtime seam, with controlled library adapters."""

import asyncio
import io
import threading

import pytest
from PIL import Image

import image_decoder
from conftest import TINY_PNG, make_png
from ocr_runtime import OcrError, OcrRuntime


class EmptyPaddle:
    def process_image(self, image):
        assert image.mode == "RGB"
        return []


def test_corrupt_and_oversized_pixels_are_rejected_before_loading(monkeypatch):
    loads = []
    runtime = OcrRuntime(paddle_factory=lambda key: loads.append(key) or EmptyPaddle())
    monkeypatch.setattr(image_decoder, "MAX_IMAGE_PIXELS", 15)

    async def scenario():
        for data, status in [(b"bad image", 400), (TINY_PNG, 413)]:
            with pytest.raises(OcrError) as caught:
                await runtime.paddle(data, "en")
            assert caught.value.status_code == status
        assert loads == []

    try:
        asyncio.run(scenario())
    finally:
        runtime.close()


def test_transparent_input_is_composited_to_visible_white():
    buffer = io.BytesIO()
    Image.new("RGBA", (2, 2), (0, 0, 0, 0)).save(buffer, format="PNG")
    with image_decoder.decode_image(buffer.getvalue()) as image:
        assert image.mode == "RGB"
        assert image.getpixel((0, 0)) == (255, 255, 255)


def test_model_cache_is_owned_by_runtime_and_bounded_by_language():
    loads = []
    runtime = OcrRuntime(paddle_factory=lambda key: loads.append(key) or EmptyPaddle())

    async def scenario():
        for language in ["japan", "en", "japan", "korean", "japan"]:
            await runtime.paddle(TINY_PNG, language)
        assert loads == ["japan", "en", "korean"]
        assert runtime.status()["paddle_loaded_languages"] == ["korean", "japan"]

    try:
        asyncio.run(scenario())
    finally:
        runtime.close()


@pytest.mark.parametrize("cancel_phase", ["load", "inference"])
def test_cancellation_keeps_capacity_until_actual_worker_finishes(cancel_phase):
    started, release = threading.Event(), threading.Event()
    counts = {"active": 0, "peak": 0, "loads": 0, "calls": 0}
    lock = threading.Lock()

    def hold():
        with lock:
            counts["active"] += 1
            counts["peak"] = max(counts["peak"], counts["active"])
        started.set()
        assert release.wait(5), "test failed to release worker"
        with lock:
            counts["active"] -= 1

    class Paddle:
        def process_image(self, image):
            counts["calls"] += 1
            if cancel_phase == "inference":
                hold()
            return []

    def factory(_key):
        counts["loads"] += 1
        if cancel_phase == "load":
            hold()
        return Paddle()

    runtime = OcrRuntime(paddle_factory=factory, max_pending=0)

    async def scenario():
        first = asyncio.create_task(runtime.paddle(TINY_PNG, "en"))
        assert await asyncio.to_thread(started.wait, 3)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        # With no waiting slots, abandoned work must still occupy capacity.
        with pytest.raises(OcrError) as caught:
            await runtime.paddle(TINY_PNG, "en")
        assert caught.value.status_code == 429
        release.set()

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        runtime.close()
    assert counts["peak"] == 1
    assert counts["loads"] == 1
    assert counts["calls"] == 1


def test_queued_cancellation_releases_its_slot_and_never_runs_the_cancelled_image():
    started, release = threading.Event(), threading.Event()
    widths = []

    class Paddle:
        def process_image(self, image):
            widths.append(image.width)
            if len(widths) == 1:
                started.set()
                assert release.wait(5)
            return []

    runtime = OcrRuntime(paddle_factory=lambda _key: Paddle(), max_pending=1)

    async def scenario():
        first = asyncio.create_task(runtime.paddle(make_png(4, 4), "en"))
        assert await asyncio.to_thread(started.wait, 3)
        cancelled = asyncio.create_task(runtime.paddle(make_png(5, 4), "en"))
        await asyncio.sleep(0)  # dispatch into the bounded worker queue
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled
        latest = asyncio.create_task(runtime.paddle(make_png(6, 4), "en"))
        release.set()
        await asyncio.gather(first, latest)

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        runtime.close()
    assert widths == [4, 6]


def test_loading_status_is_immediate_and_first_load_is_reused():
    started, release = threading.Event(), threading.Event()
    loads = []

    def factory(language):
        loads.append(language)
        started.set()
        assert release.wait(5)
        return EmptyPaddle()

    runtime = OcrRuntime(paddle_factory=factory)

    async def scenario():
        tasks = [asyncio.create_task(runtime.paddle(TINY_PNG, "en")) for _ in range(3)]
        assert await asyncio.to_thread(started.wait, 3)
        status = runtime.status()
        assert status["paddle_loading_languages"] == ["en"]
        assert status["paddle_loaded_languages"] == []
        release.set()
        await asyncio.gather(*tasks)
        assert runtime.status()["paddle_loaded_languages"] == ["en"]

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        runtime.close()
    assert loads == ["en"]
