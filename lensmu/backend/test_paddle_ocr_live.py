"""Opt-in real-model matrix. VT_LIVE_OCR=1 enables downloads and inference.

Run this file alone in either pinned OCR profile. The default deterministic
suite never downloads models. VT_OCR_JAPANESE_FONT can point to a local CJK
font on machines that do not have a supported system font installed.
"""

import io
import json
import os
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from ocr_runtime import create_default_runtime

pytestmark = pytest.mark.skipif(os.environ.get('VT_LIVE_OCR') != '1',
                               reason='set VT_LIVE_OCR=1 for real OCR model downloads/inference')


def font(japanese=False):
    candidates = ([os.environ.get('VT_OCR_JAPANESE_FONT', ''),
                   'C:/Windows/Fonts/meiryo.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
                  if japanese else ['C:/Windows/Fonts/arial.ttf',
                                    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'])
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return ImageFont.truetype(candidate, 48)
    pytest.skip('No suitable local test font; set VT_OCR_JAPANESE_FONT for Japanese fixtures')


def render_sample(text, *, japanese=False, vertical=False, color='black', origin=(30, 40)):
    image = Image.new('RGB', (720, 360), 'white')
    draw = ImageDraw.Draw(image)
    face = font(japanese)
    if vertical:
        for index, character in enumerate(text):
            draw.text((origin[0], origin[1] + index * 54), character, font=face, fill=color)
    else:
        draw.text(origin, text, font=face, fill=color)
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


@pytest.fixture(scope='module')
def runtime():
    instance = create_default_runtime()
    yield instance
    instance.close()


@pytest.mark.parametrize('text,language,options', [
    ('HELLO WORLD 12345', 'en', {}),
    ('HELLO WORLD', 'en', {'color': 'red'}),
    ('こんにちは', 'japan', {'japanese': True}),
    ('日本語', 'japan', {'japanese': True, 'vertical': True}),
    ('HELLO', 'en', {'origin': (350, 150)}),
])
def test_real_paddle_reads_text_and_preserves_geometry(runtime, text, language, options):
    import asyncio
    assert runtime.status()['paddle_ocr_available'], 'Install the selected OCR requirements profile.'
    detections = asyncio.run(runtime.paddle(render_sample(text, **options), language))
    recognized = ''.join(item['text'] for item in detections).replace(' ', '')
    print(json.dumps({'language': language, 'options': options, 'recognized': recognized, 'detections': detections}))
    assert text.replace(' ', '') in recognized
    assert all(0 <= d['bbox'][0] < d['bbox'][2] <= 720 and 0 <= d['bbox'][1] < d['bbox'][3] <= 360 for d in detections)
    if options.get('origin'):
        assert min(d['bbox'][0] for d in detections) >= 300
        assert min(d['bbox'][1] for d in detections) >= 130


def test_real_paddle_empty_image_is_empty(runtime):
    import asyncio
    output = io.BytesIO()
    Image.new('RGB', (320, 120), 'white').save(output, format='PNG')
    assert asyncio.run(runtime.paddle(output.getvalue(), 'en')) == []


@pytest.mark.parametrize('text,vertical,bbox', [
    ('こんにちは', False, [20, 20, 320, 120]),
    ('日本語', True, [20, 20, 100, 240]),
])
def test_real_manga_reads_japanese_crops(runtime, text, vertical, bbox):
    import asyncio
    assert runtime.status()['manga_ocr_available'], 'Install the selected OCR requirements profile.'
    result = asyncio.run(runtime.manga(render_sample(text, japanese=True, vertical=vertical), [bbox]))
    print(json.dumps({'engine': 'manga', 'vertical': vertical, 'detections': result}))
    assert result[0]['status'] == 'recognized'
    assert text in result[0]['text']
