# =============================================================================
# VisionTranslate — opt-in PaddleOCR smoke test against the real package
# =============================================================================
#
# Skipped unless VT_LIVE_OCR=1 *and* paddleocr is importable. Downloads the
# detection/recognition models on first run (~100 MB) and runs a real
# initialisation plus inference on a rendered image, so it is never part of
# the default suite or CI.
#
#   VT_LIVE_OCR=1 pytest test_paddle_ocr_live.py -v
# =============================================================================

import io
import os

import pytest

from PIL import Image, ImageDraw

live = os.environ.get("VT_LIVE_OCR") == "1"
pytestmark = pytest.mark.skipif(not live, reason="set VT_LIVE_OCR=1 to run the real PaddleOCR smoke test")


def render_text_image(text: str) -> bytes:
    image = Image.new("RGB", (480, 120), (255, 255, 255))
    ImageDraw.Draw(image).text((20, 40), text, fill=(0, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_real_paddleocr_initialises_with_the_requested_language_and_reads_text():
    paddleocr = pytest.importorskip("paddleocr")
    from ocr_engines.paddle_ocr import PaddleOCREngine

    generation = PaddleOCREngine._detect_api_generation()
    kwargs = PaddleOCREngine._build_constructor_kwargs("en")
    assert kwargs["lang"] == "en", kwargs

    engine = PaddleOCREngine.get_instance("en")
    detections = engine.process_image(render_text_image("HELLO WORLD 12345"))

    print(f"paddleocr {getattr(paddleocr, '__version__', '?')} ({generation}) -> {detections}")
    assert isinstance(detections, list)
    assert any("HELLO" in detection["text"].upper() for detection in detections)
