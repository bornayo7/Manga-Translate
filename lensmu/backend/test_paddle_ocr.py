# =============================================================================
# VisionTranslate — PaddleOCR wrapper tests
# =============================================================================
#
# Run with: pytest -v
#
# The real `paddleocr` package is a multi-hundred-megabyte optional dependency
# that CI does not install. These tests stand in a tiny stub for it so the
# wrapper's caching, locking, and result-normalisation logic can still be
# exercised deterministically.
# =============================================================================

import importlib
import sys
import threading
import types

import pytest

from conftest import TINY_PNG


class FakePaddleOCR:
    """Minimal stand-in for paddleocr.PaddleOCR (3.x constructor names).

    Construction blocks on `load_release` (set by default) and signals
    `load_started`, so a test can hold a "model load" open for exactly as
    long as it needs without sleeping.
    """

    instances: list = []
    predict_result: list = []
    load_started = threading.Event()
    load_release = threading.Event()

    def __init__(
        self,
        lang="japan",
        use_textline_orientation=False,
        text_det_thresh=0.3,
        text_det_unclip_ratio=1.5,
    ):
        self.kwargs = {
            "lang": lang,
            "use_textline_orientation": use_textline_orientation,
            "text_det_thresh": text_det_thresh,
            "text_det_unclip_ratio": text_det_unclip_ratio,
        }
        type(self).load_started.set()
        assert type(self).load_release.wait(timeout=5), "test never released the fake model load"
        type(self).instances.append(self)

    def predict(self, image_array):
        return type(self).predict_result


def run_with_timeout(function, timeout: float):
    """Run `function` on a thread; return (finished, result)."""
    result = []
    worker = threading.Thread(target=lambda: result.append(function()), daemon=True)
    worker.start()
    worker.join(timeout)
    return (not worker.is_alive(), result[0] if result else None)


@pytest.fixture
def paddle_module(monkeypatch):
    """Import ocr_engines.paddle_ocr against the stub paddleocr package."""
    FakePaddleOCR.instances = []
    FakePaddleOCR.predict_result = []
    FakePaddleOCR.load_started = threading.Event()
    FakePaddleOCR.load_release = threading.Event()
    FakePaddleOCR.load_release.set()

    fake_package = types.ModuleType("paddleocr")
    fake_package.PaddleOCR = FakePaddleOCR
    monkeypatch.setitem(sys.modules, "paddleocr", fake_package)
    sys.modules.pop("ocr_engines.paddle_ocr", None)

    module = importlib.import_module("ocr_engines.paddle_ocr")
    module.PaddleOCREngine._instances.clear()
    yield module

    module.PaddleOCREngine._instances.clear()
    sys.modules.pop("ocr_engines.paddle_ocr", None)


def test_constructor_uses_3x_argument_names(paddle_module):
    paddle_module.PaddleOCREngine.get_instance("japan")

    assert FakePaddleOCR.instances[0].kwargs == {
        "lang": "japan",
        "use_textline_orientation": True,
        "text_det_thresh": 0.3,
        "text_det_unclip_ratio": 1.8,
    }


def test_instances_are_cached_per_language_and_evicted_lru(paddle_module):
    engine = paddle_module.PaddleOCREngine

    first = engine.get_instance("japan")
    assert engine.get_instance("JAPAN ") is first
    assert len(FakePaddleOCR.instances) == 1

    engine.get_instance("en")
    engine.get_instance("korean")

    assert engine.get_loaded_languages() == ["en", "korean"]
    assert len(FakePaddleOCR.instances) == 3

    # Touching a cached language marks it recently used, so the *other*
    # language is the one evicted next.
    engine.get_instance("en")
    engine.get_instance("ch")
    assert engine.get_loaded_languages() == ["en", "ch"]


def test_loaded_language_lookup_does_not_wait_for_a_model_load(paddle_module):
    engine = paddle_module.PaddleOCREngine
    FakePaddleOCR.load_release.clear()

    loader = threading.Thread(target=engine.get_instance, args=("japan",), daemon=True)
    loader.start()
    assert FakePaddleOCR.load_started.wait(timeout=5), "model load never started"

    # The model is now "loading". /health calls this on the event loop, so it
    # must return immediately rather than queue behind the load.
    finished, languages_during_load = run_with_timeout(engine.get_loaded_languages, timeout=1.0)

    FakePaddleOCR.load_release.set()
    loader.join(timeout=5)

    assert finished, "get_loaded_languages() blocked behind a model load"
    assert languages_during_load == []
    assert engine.get_loaded_languages() == ["japan"]


def test_concurrent_requests_build_one_model(paddle_module):
    engine = paddle_module.PaddleOCREngine
    FakePaddleOCR.load_release.clear()

    threads = [threading.Thread(target=engine.get_instance, args=("japan",), daemon=True) for _ in range(4)]
    for thread in threads:
        thread.start()
    assert FakePaddleOCR.load_started.wait(timeout=5)

    FakePaddleOCR.load_release.set()
    for thread in threads:
        thread.join(timeout=5)

    assert len(FakePaddleOCR.instances) == 1


def test_modern_results_are_normalised_filtered_and_sorted(paddle_module):
    FakePaddleOCR.predict_result = [
        {
            "rec_texts": ["second", "   ", "first", "tall", "zero"],
            "rec_scores": [0.91, 0.5, 0.87123, 0.7, 0.9],
            "rec_boxes": [
                [10, 50, 60, 70],
                [0, 0, 5, 5],
                [10, 10, 60, 30],
                [80, 10, 90, 60],
                [0, 0, 5, 0],
            ],
            "rec_polys": [
                [[10, 50], [60, 50], [60, 70], [10, 70]],
                [[0, 0], [5, 0], [5, 5], [0, 5]],
                [[10, 10], [60, 10], [60, 30], [10, 30]],
                [[80, 10], [90, 10], [90, 60], [80, 60]],
                [[0, 0], [5, 0], [5, 0], [0, 0]],
            ],
        }
    ]

    detections = paddle_module.PaddleOCREngine.get_instance("en").process_image(TINY_PNG)

    assert detections == [
        {"text": "first", "bbox": [10, 10, 60, 30], "confidence": 0.8712, "orientation": "horizontal"},
        {"text": "tall", "bbox": [80, 10, 90, 60], "confidence": 0.7, "orientation": "vertical"},
        {"text": "second", "bbox": [10, 50, 60, 70], "confidence": 0.91, "orientation": "horizontal"},
    ]


def test_undecodable_image_raises_value_error(paddle_module):
    engine = paddle_module.PaddleOCREngine.get_instance("en")

    with pytest.raises(ValueError):
        engine.process_image(b"definitely not an image")


def test_legacy_results_drop_blank_text_and_zero_area_boxes(paddle_module):
    legacy_page = [
        ([[10.4, 20.6], [50.2, 20.6], [50.2, 40.1], [10.4, 40.1]], ("hello", 0.98765)),
        ([[5, 5], [5, 5], [5, 5], [5, 5]], ("dot", 0.5)),
        ([[0, 0], [30, 0], [30, 12], [0, 12]], ("   ", 0.9)),
        ([[-3.5, 60], [12, 60], [12, 90.2], [-3.5, 90.2]], ("edge", 0.7)),
    ]

    detections = paddle_module.PaddleOCREngine._normalize_detections([legacy_page])

    assert detections == [
        {"text": "hello", "bbox": [10, 20, 51, 41], "confidence": 0.9877, "orientation": "horizontal"},
        {"text": "edge", "bbox": [0, 60, 12, 91], "confidence": 0.7, "orientation": "vertical"},
    ]


def test_normalised_boxes_never_carry_negative_coordinates(paddle_module):
    engine = paddle_module.PaddleOCREngine

    assert engine._normalize_box([-2.4, -0.6, 10.2, 5.5]) == [0, 0, 10, 6]
    assert engine._polygon_to_bbox([[-1, -1], [4, -1], [4, 3], [-1, 3]]) == [0, 0, 4, 3]
