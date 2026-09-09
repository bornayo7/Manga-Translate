"""Library adapter tests through construction and recognition, without models."""

import pytest
from PIL import Image

from ocr_engines.paddle_ocr import PaddleOCREngine


class FakePaddle:
    def __init__(self, lang=None, use_doc_orientation_classify=True, use_doc_unwarping=True,
                 use_textline_orientation=False, text_det_thresh=0.3, text_det_unclip_ratio=1.5):
        self.settings = locals().copy()
        self.result = []
        self.pixels = None

    def predict(self, pixels):
        self.pixels = pixels
        return self.result


@pytest.fixture
def engine():
    return PaddleOCREngine('en', paddle_class=FakePaddle)


def test_original_coordinates_and_bgr_pixels_are_preserved(engine):
    image = Image.new('RGB', (80, 30), (255, 0, 0))
    engine._ocr.result = [{
        'rec_texts': ['red'], 'rec_scores': [0.95],
        'rec_boxes': [[10, 5, 30, 20]],
    }]
    result = engine.process_image(image)
    assert engine._ocr.pixels[0, 0].tolist() == [0, 0, 255]
    assert engine._ocr.pixels.shape == (30, 80, 3)
    assert engine._ocr.settings['use_doc_orientation_classify'] is False
    assert engine._ocr.settings['use_doc_unwarping'] is False
    assert result[0]['bbox'] == [10, 5, 30, 20]


def test_modern_results_are_filtered_clamped_and_sorted(engine):
    engine._ocr.result = [{
        'rec_texts': ['second', '   ', 'first', 'tall', 'zero', 'outside'],
        'rec_scores': [0.91, 0.5, 0.87123, 0.7, 0.9, 0.9],
        'rec_boxes': [[10, 50, 60, 70], [0, 0, 5, 5], [10, 10, 60, 30],
                      [80, 10, 110, 90], [0, 0, 5, 0], [120, 120, 150, 160]],
    }]
    result = engine.process_image(Image.new('RGB', (100, 100)))
    assert result == [
        {'text': 'first', 'bbox': [10, 10, 60, 30], 'confidence': 0.8712, 'orientation': 'horizontal'},
        {'text': 'tall', 'bbox': [80, 10, 100, 90], 'confidence': 0.7, 'orientation': 'vertical'},
        {'text': 'second', 'bbox': [10, 50, 60, 70], 'confidence': 0.91, 'orientation': 'horizontal'},
    ]


def test_legacy_polygons_cover_fractional_glyph_edges(engine):
    engine._ocr.result = [[
        ([[10.4, 20.6], [50.2, 20.6], [50.2, 40.1], [10.4, 40.1]], ('hello', 0.98765)),
        ([[5, 5], [5, 5], [5, 5], [5, 5]], ('dot', 0.5)),
        ([[0, 0], [30, 0], [30, 12], [0, 12]], ('   ', 0.9)),
        ([[-3.5, 60], [12, 60], [12, 90.2], [-3.5, 90.2]], ('edge', 0.7)),
    ]]
    assert engine.process_image(Image.new('RGB', (100, 100))) == [
        {'text': 'hello', 'bbox': [10, 20, 51, 41], 'confidence': 0.9877, 'orientation': 'horizontal'},
        {'text': 'edge', 'bbox': [0, 60, 12, 91], 'confidence': 0.7, 'orientation': 'vertical'},
    ]


@pytest.mark.parametrize('result', [[{'error': 'bad model'}], [{}], [object()], {'rec_texts': []}])
def test_unknown_or_failed_payload_is_not_no_text(engine, result):
    engine._ocr.result = result
    with pytest.raises(RuntimeError, match='invalid|failed'):
        engine.process_image(Image.new('RGB', (4, 4)))


@pytest.mark.parametrize('result', [[], [None], [[]], [{'rec_texts': [], 'rec_scores': []}]])
def test_valid_empty_results_are_empty(engine, result):
    engine._ocr.result = result
    assert engine.process_image(Image.new('RGB', (4, 4))) == []


def test_non_finite_confidence_is_rejected(engine):
    engine._ocr.result = [{'rec_texts': ['text'], 'rec_scores': [float('nan')], 'rec_boxes': [[0, 0, 4, 4]]}]
    with pytest.raises(RuntimeError, match='non-finite'):
        engine.process_image(Image.new('RGB', (4, 4)))


@pytest.mark.parametrize('payload', [
    {'rec_texts': None},
    {'rec_texts': 'text'},
    {'rec_texts': ['text'], 'rec_scores': [0.9]},
    {'rec_texts': ['text'], 'rec_boxes': [[0, 0, 4, 4]]},
    {'rec_texts': [12], 'rec_scores': [0.9], 'rec_boxes': [[0, 0, 4, 4]]},
])
def test_incomplete_recognition_is_not_successful_empty(engine, payload):
    engine._ocr.result = [payload]
    with pytest.raises(RuntimeError, match='invalid|incomplete'):
        engine.process_image(Image.new('RGB', (4, 4)))
