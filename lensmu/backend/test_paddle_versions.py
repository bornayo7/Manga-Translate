# =============================================================================
# VisionTranslate — PaddleOCR constructor adapter across API generations
# =============================================================================
#
# PaddleOCR 2.x declares ``PaddleOCR.__init__(self, **kwargs)`` and 3.x
# declares explicit keyword parameters. The adapter must send each
# generation its own option names; checking names against a **kwargs
# signature finds nothing, which is how 2.x used to receive no language at
# all. These fixtures reproduce both signatures.
# =============================================================================

import importlib
import inspect
import sys
import types

import pytest


class Paddle2xLike:
    """paddleocr 2.7-2.10: everything arrives through **kwargs."""

    instances: list = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        type(self).instances.append(self)

    def ocr(self, image_array, cls=True):
        return [[]]


class Paddle3xLike:
    """paddleocr 3.x: explicit keyword parameters, unknown names rejected."""

    instances: list = []

    def __init__(
        self,
        doc_orientation_classify_model_name=None,
        lang=None,
        ocr_version=None,
        use_doc_orientation_classify=None,
        use_doc_unwarping=None,
        use_textline_orientation=None,
        text_det_thresh=None,
        text_det_unclip_ratio=None,
        device=None,
    ):
        self.kwargs = {
            "lang": lang,
            "use_textline_orientation": use_textline_orientation,
            "text_det_thresh": text_det_thresh,
            "text_det_unclip_ratio": text_det_unclip_ratio,
            "device": device,
        }
        type(self).instances.append(self)

    def predict(self, image_array):
        return []


def load_wrapper(monkeypatch, paddle_class, version=None):
    fake_package = types.ModuleType("paddleocr")
    fake_package.PaddleOCR = paddle_class
    if version is not None:
        fake_package.__version__ = version
    monkeypatch.setitem(sys.modules, "paddleocr", fake_package)
    sys.modules.pop("ocr_engines.paddle_ocr", None)
    module = importlib.import_module("ocr_engines.paddle_ocr")
    module.PaddleOCREngine._instances.clear()
    paddle_class.instances = []
    return module


@pytest.fixture(autouse=True)
def restore_module():
    yield
    sys.modules.pop("ocr_engines.paddle_ocr", None)


def test_2x_var_kwargs_constructor_receives_the_2x_names_and_the_language(monkeypatch):
    # The signature exposes no option names at all.
    assert all(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in list(inspect.signature(Paddle2xLike.__init__).parameters.values())[1:]
    )

    module = load_wrapper(monkeypatch, Paddle2xLike, version="2.10.0")
    module.PaddleOCREngine.get_instance("korean")

    assert Paddle2xLike.instances[0].kwargs == {
        "lang": "korean",
        "use_angle_cls": True,
        "det_db_thresh": 0.3,
        "det_db_unclip_ratio": 1.8,
        "use_gpu": False,
        "show_log": False,
    }


def test_2x_without_version_metadata_is_still_recognised_by_its_signature(monkeypatch):
    module = load_wrapper(monkeypatch, Paddle2xLike)
    assert module.PaddleOCREngine._detect_api_generation(Paddle2xLike, sys.modules["paddleocr"]) == "v2"
    module.PaddleOCREngine.get_instance("en")
    assert Paddle2xLike.instances[0].kwargs["lang"] == "en"
    assert "use_textline_orientation" not in Paddle2xLike.instances[0].kwargs


def test_3x_explicit_constructor_receives_only_the_3x_names(monkeypatch):
    module = load_wrapper(monkeypatch, Paddle3xLike, version="3.2.0")
    module.PaddleOCREngine.get_instance("japan")

    assert Paddle3xLike.instances[0].kwargs == {
        "lang": "japan",
        "use_textline_orientation": True,
        "text_det_thresh": 0.3,
        "text_det_unclip_ratio": 1.8,
        "device": None,
    }


def test_3x_signature_wins_over_a_missing_or_odd_version_string(monkeypatch):
    module = load_wrapper(monkeypatch, Paddle3xLike)
    assert module.PaddleOCREngine._detect_api_generation(Paddle3xLike, sys.modules["paddleocr"]) == "v3"


def test_a_constructor_matching_neither_generation_is_refused_instead_of_silently_misconfigured(monkeypatch):
    class Unknown:
        def __init__(self, lang=None):
            pass

    module = load_wrapper(monkeypatch, Unknown)
    with pytest.raises(RuntimeError, match="Unsupported PaddleOCR"):
        module.PaddleOCREngine._detect_api_generation(Unknown, sys.modules["paddleocr"])
