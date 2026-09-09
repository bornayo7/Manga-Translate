"""Real Manga adapter behavior with a tiny deterministic model substitute."""

import base64

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from conftest import TINY_PNG
from ocr_engines.manga_ocr import MangaOCREngine
from ocr_runtime import OcrRuntime
from server import create_app


def test_crops_are_clamped_padded_and_aligned():
    sizes = []
    model = lambda image: sizes.append(image.size) or "  日本語  "
    engine = MangaOCREngine(model=model)
    result = engine.process_regions(Image.new("RGB", (20, 20)), [[0, 0, 10, 10], [18, 18, 30, 30], [30, 30, 40, 40]])
    assert sizes == [(20, 20), (12, 12)]
    assert [item["bbox"] for item in result] == [[0, 0, 10, 10], [18, 18, 20, 20], [20, 20, 20, 20]]
    assert [item["status"] for item in result] == ["recognized", "recognized", "outside_image"]


def test_empty_recognition_is_not_a_model_failure():
    result = MangaOCREngine(model=lambda _image: "").process_regions(Image.new("RGB", (4, 4)), [[0, 0, 4, 4]])
    assert result == [{"text": "", "bbox": [0, 0, 4, 4], "status": "empty"}]


@pytest.mark.parametrize("partial", [False, True])
def test_model_errors_surface_through_http(partial):
    calls = []

    def model(_image):
        calls.append(True)
        if partial and len(calls) == 1:
            return "日本語"
        raise RuntimeError("controlled model failure")

    runtime = OcrRuntime(manga_factory=lambda _key: MangaOCREngine(model=model))
    with TestClient(create_app(runtime)) as client:
        response = client.post("/ocr/manga", json={
            "image": base64.b64encode(TINY_PNG).decode(),
            "bboxes": [[0, 0, 4, 4], [1, 1, 3, 3]],
        })
    if not partial:
        assert response.status_code == 500
        assert response.json()["code"] == "ocr_failed"
        assert "failed for all" in response.json()["detail"]
    else:
        assert response.status_code == 200
        body = response.json()
        assert body["failed_regions"] == [1]
        assert body["warnings"] == ["MangaOCR failed to recognize 1 region(s)."]
        assert [item["status"] for item in body["detections"]] == ["recognized", "failed"]
