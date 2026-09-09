"""Constructor compatibility is tested through the actual adapter interface."""

import types

import pytest

from ocr_engines.paddle_ocr import PaddleOCREngine


class Paddle2x:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class Paddle3x:
    def __init__(self, lang=None, use_doc_orientation_classify=True,
                 use_doc_unwarping=True, use_textline_orientation=False,
                 text_det_thresh=None, text_det_unclip_ratio=None):
        self.kwargs = {key: value for key, value in locals().items() if key != 'self'}


@pytest.mark.parametrize('version', ['2.10.0', None])
def test_2x_constructor_receives_language_and_its_option_names(version):
    engine = PaddleOCREngine('korean', paddle_class=Paddle2x,
                             module=types.SimpleNamespace(__version__=version))
    assert engine._ocr.kwargs == {
        'lang': 'korean', 'use_angle_cls': True, 'det_db_thresh': 0.3,
        'det_db_unclip_ratio': 1.8, 'use_gpu': False, 'show_log': False,
    }


@pytest.mark.parametrize('version', ['3.2.0', None])
def test_3x_constructor_preserves_original_page_geometry(version):
    engine = PaddleOCREngine('japan', paddle_class=Paddle3x,
                             module=types.SimpleNamespace(__version__=version))
    assert engine._ocr.kwargs == {
        'lang': 'japan', 'use_doc_orientation_classify': False,
        'use_doc_unwarping': False, 'use_textline_orientation': True,
        'text_det_thresh': 0.3, 'text_det_unclip_ratio': 1.8,
    }


def test_unknown_constructor_is_refused():
    class Unknown:
        def __init__(self, lang=None):
            pass
    with pytest.raises(RuntimeError, match='Unsupported PaddleOCR'):
        PaddleOCREngine('en', paddle_class=Unknown, module=types.SimpleNamespace())


def test_constructor_cannot_silently_enable_document_transforms():
    class ChangedPaddle3:
        def __init__(self, lang=None, use_textline_orientation=True):
            pass
    with pytest.raises(RuntimeError, match='cannot disable document geometry'):
        PaddleOCREngine('en', paddle_class=ChangedPaddle3)
