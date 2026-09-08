# =============================================================================
# VisionTranslate — Backend Tests
# =============================================================================
#
# Run with: pytest test_server.py -v
# Install test deps: pip install pytest httpx
#
# These tests verify the backend API endpoints without requiring OCR engines
# to be installed. They test request validation, error handling, and the
# health check endpoint.
# =============================================================================

import base64
import pathlib
import re

import pytest
from fastapi.testclient import TestClient
import security
import server

from conftest import TINY_PNG


client = TestClient(server.app)


def find_middleware(middleware_class):
    """Walk the built middleware stack to the live instance of a class.

    The stack is built lazily on the first request, so callers must have
    sent one request before asking.
    """
    layer = server.app.middleware_stack
    while layer is not None:
        if isinstance(layer, middleware_class):
            return layer
        layer = getattr(layer, "app", None)
    return None


def find_rate_limiter():
    return find_middleware(security.RateLimitMiddleware)


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Every test shares one TestClient IP, so drain the limiter between tests.

    Without this the suite silently starts failing with 429s once it grows
    past RATE_LIMIT_MAX_REQUESTS requests in a single process.
    """
    yield
    limiter = find_rate_limiter()
    if limiter is not None:
        limiter.requests.clear()


def install_fake_paddle(monkeypatch, process_image=None):
    """Make /ocr/paddle reachable with a fake engine; returns the class."""

    class FakePaddleEngine:
        requested_language = None

        @classmethod
        def get_instance(cls, language):
            cls.requested_language = language
            return cls()

        @classmethod
        def get_loaded_languages(cls):
            return []

        def process_image(self, image_bytes):
            if process_image is None:
                return []
            return process_image(image_bytes)

    monkeypatch.setattr(server, "PADDLE_AVAILABLE", True)
    monkeypatch.setattr(server, "PaddleOCREngine", FakePaddleEngine)
    return FakePaddleEngine


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

class TestHealthCheck:
    """Tests for the /health endpoint."""

    def test_health_returns_200(self):
        """Server should return 200 OK with status info."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_response_structure(self):
        """Response should contain all expected fields."""
        response = client.get("/health")
        data = response.json()
        assert data["status"] == "ok"
        assert "paddle_ocr_available" in data
        assert "paddle_ocr_loaded" in data
        assert "manga_ocr_available" in data
        assert "manga_ocr_loaded" in data
        assert "manga_full_available" in data
        assert "paddle_loaded_languages" in data
        assert data["manga_full_available"] is (
            data["paddle_ocr_available"] and data["manga_ocr_available"]
        )

    def test_health_models_not_loaded_initially(self):
        """OCR models should not be loaded until first request."""
        response = client.get("/health")
        data = response.json()
        assert data["paddle_ocr_loaded"] is False
        assert data["manga_ocr_loaded"] is False


# ---------------------------------------------------------------------------
# PaddleOCR Endpoint — Input Validation
# ---------------------------------------------------------------------------

class TestPaddleOCRValidation:
    """Tests for /ocr/paddle input validation."""

    def test_missing_image_field(self):
        """Request without 'image' field should return 422."""
        response = client.post("/ocr/paddle", json={})
        assert response.status_code == 422

    def test_empty_body(self):
        """Request with empty body should return 422."""
        response = client.post("/ocr/paddle")
        assert response.status_code == 422

    def test_invalid_base64_is_a_400(self, monkeypatch):
        """With an engine installed, undecodable base64 is the client's fault."""
        install_fake_paddle(monkeypatch)
        response = client.post("/ocr/paddle", json={"image": "not-valid-base64!!!"})
        assert response.status_code == 400
        assert "Invalid base64" in response.json()["detail"]

    def test_missing_engine_is_a_501(self, monkeypatch):
        """Without PaddleOCR installed the route reports 501, not a decode error."""
        monkeypatch.setattr(server, "PADDLE_AVAILABLE", False)
        response = client.post("/ocr/paddle", json={"image": "not-valid-base64!!!"})
        assert response.status_code == 501

    def test_unsupported_language_is_a_422(self, monkeypatch):
        install_fake_paddle(monkeypatch)
        response = client.post(
            "/ocr/paddle",
            json={"image": base64.b64encode(TINY_PNG).decode(), "lang": "klingon"},
        )
        assert response.status_code == 422
        assert "Unsupported PaddleOCR language" in response.json()["detail"]

    def test_oversized_decoded_image_is_a_413(self, monkeypatch):
        install_fake_paddle(monkeypatch)
        monkeypatch.setattr(security, "MAX_IMAGE_SIZE_BYTES", 16)
        response = client.post(
            "/ocr/paddle",
            json={"image": base64.b64encode(TINY_PNG).decode()},
        )
        assert response.status_code == 413
        assert "Image too large" in response.json()["detail"]

    def test_engine_value_error_is_a_400_and_other_failures_a_500(self, monkeypatch):
        def broken_image(_image_bytes):
            raise ValueError("Could not decode image: bad header")

        install_fake_paddle(monkeypatch, process_image=broken_image)
        payload = {"image": base64.b64encode(TINY_PNG).decode(), "lang": "en"}
        response = client.post("/ocr/paddle", json=payload)
        assert response.status_code == 400
        assert "Could not decode image" in response.json()["detail"]

        def crashed_engine(_image_bytes):
            raise RuntimeError("CUDA out of memory")

        install_fake_paddle(monkeypatch, process_image=crashed_engine)
        response = client.post("/ocr/paddle", json=payload)
        assert response.status_code == 500
        assert "OCR processing failed" in response.json()["detail"]


# ---------------------------------------------------------------------------
# MangaOCR Endpoint — Input Validation
# ---------------------------------------------------------------------------

class TestMangaOCRValidation:
    """Tests for /ocr/manga input validation."""

    def test_missing_fields(self):
        """Request without required fields should return 422."""
        response = client.post("/ocr/manga", json={})
        assert response.status_code == 422

    def test_missing_engine_is_a_501(self, monkeypatch):
        monkeypatch.setattr(server, "MANGA_AVAILABLE", False)
        response = client.post(
            "/ocr/manga",
            json={"image": base64.b64encode(TINY_PNG).decode(), "bboxes": [[0, 0, 1, 1]]},
        )
        assert response.status_code == 501

    def test_missing_bboxes(self):
        """Request with image but no bboxes should return 422."""
        response = client.post("/ocr/manga", json={"image": "abc123"})
        assert response.status_code == 422

    def test_empty_bboxes(self):
        """Request with empty bboxes list should fail schema validation."""
        response = client.post(
            "/ocr/manga",
            json={"image": "abc123", "bboxes": []}
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "bbox",
        [
            [0, 0, 10],
            [0, 0, 0, 10],
            [0, 10, 10, 5],
            [-1, 0, 10, 10],
            [0, 0, 100_001, 10],
            [0, 0, 10.5, 10],
        ],
    )
    def test_invalid_bbox_geometry_is_rejected(self, bbox):
        response = client.post(
            "/ocr/manga",
            json={"image": "abc123", "bboxes": [bbox]},
        )
        assert response.status_code == 422

    def test_too_many_bboxes_are_rejected(self):
        response = client.post(
            "/ocr/manga",
            json={
                "image": "abc123",
                "bboxes": [[0, 0, 1, 1]] * (server.MAX_MANGA_REGIONS + 1),
            },
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Base64 Decoding
# ---------------------------------------------------------------------------

class TestBase64Decoding:
    """Tests for base64 image handling."""

    def test_valid_base64_with_data_url_prefix(self):
        """Should handle data URL prefix gracefully."""
        b64_with_prefix = "data:image/png;base64," + base64.b64encode(TINY_PNG).decode()
        assert server.decode_base64_image(b64_with_prefix) == TINY_PNG

    def test_invalid_base64_is_rejected_strictly(self):
        with pytest.raises(Exception) as error:
            server.decode_base64_image("not-valid-base64!!!")
        assert error.value.status_code == 400


class TestPaddleLanguageContract:
    @pytest.mark.parametrize(
        ("input_language", "expected"),
        [("ja", "japan"), ("zh", "ch"), ("ko", "korean"), ("es", "es")],
    )
    def test_language_aliases(self, input_language, expected):
        assert server.normalize_paddle_language(input_language) == expected

    def test_unknown_language_is_rejected(self):
        with pytest.raises(Exception) as error:
            server.normalize_paddle_language("made-up-language")
        assert error.value.status_code == 422

    def test_mocked_paddle_response_and_language_routing(self, monkeypatch):
        def recognise(image_bytes):
            assert image_bytes == TINY_PNG
            return [{
                "text": "hola",
                "bbox": [1, 2, 11, 12],
                "confidence": 0.95,
                "orientation": "horizontal",
            }]

        FakePaddleEngine = install_fake_paddle(monkeypatch, process_image=recognise)
        response = client.post(
            "/ocr/paddle",
            json={"image": base64.b64encode(TINY_PNG).decode(), "lang": "es"},
        )

        assert response.status_code == 200
        assert FakePaddleEngine.requested_language == "es"
        assert response.json()["detections"][0]["text"] == "hola"


class TestMangaOCRContract:
    def test_mocked_manga_response_and_region_routing(self, monkeypatch):
        class FakeMangaEngine:
            _instance = None
            requested_regions = None

            @classmethod
            def get_instance(cls):
                cls._instance = cls()
                return cls._instance

            @classmethod
            def is_loaded(cls):
                return cls._instance is not None

            def process_regions(self, image_bytes, bboxes):
                assert image_bytes == TINY_PNG
                type(self).requested_regions = bboxes
                return [{"text": "こんにちは", "bbox": bboxes[0]}]

        monkeypatch.setattr(server, "MANGA_AVAILABLE", True)
        monkeypatch.setattr(server, "MangaOCREngine", FakeMangaEngine)
        bbox = [0, 0, 1, 1]
        response = client.post(
            "/ocr/manga",
            json={
                "image": base64.b64encode(TINY_PNG).decode(),
                "bboxes": [bbox],
            },
        )

        assert response.status_code == 200
        assert FakeMangaEngine.requested_regions == [bbox]
        assert response.json()["detections"] == [{"text": "こんにちは", "bbox": bbox}]


class TestRequestLimits:
    def test_oversized_content_length_is_rejected_before_json_parsing(self):
        response = client.post(
            "/ocr/paddle",
            content=b"{}",
            headers={"Content-Length": str(16 * 1024 * 1024)},
        )
        assert response.status_code == 413
        assert response.json()["code"] == "request_too_large"

    def test_oversized_streamed_body_is_rejected(self, monkeypatch):
        """A body that omits Content-Length is still capped while streaming."""
        client.get("/health")  # build the middleware stack
        body_limit = find_middleware(security.RequestBodyLimitMiddleware)
        assert body_limit is not None
        monkeypatch.setattr(body_limit, "max_body_bytes", 64)

        response = client.post(
            "/ocr/paddle",
            content=iter([b"x" * 40, b"x" * 40]),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert response.json()["code"] == "request_too_large"

    def test_manga_limits_match_the_extension_copy(self):
        """selectMangaBboxes() in the extension mirrors this validator's limits.

        The two live in different languages, so keep them from drifting the
        cheap way: read the extension's constants and compare.
        """
        text_js = pathlib.Path(__file__).resolve().parents[1] / "extension" / "shared" / "text.js"
        source = text_js.read_text(encoding="utf-8")

        def js_constant(name):
            match = re.search(rf"export const {name} = (\d+);", source)
            assert match, f"{name} not found in {text_js}"
            return int(match.group(1))

        assert js_constant("MAX_MANGA_REGIONS") == server.MAX_MANGA_REGIONS
        assert js_constant("MAX_MANGA_COORDINATE") == server.MAX_MANGA_COORDINATE
        assert js_constant("MAX_MANGA_TOTAL_REGION_PIXELS") == server.MAX_MANGA_TOTAL_REGION_PIXELS


class TestRateLimit:
    def test_limit_is_enforced_per_client_with_retry_after(self, monkeypatch):
        # The middleware stack is built lazily, so make one request first.
        client.post("/ocr/paddle", json={})
        limiter = find_rate_limiter()
        assert limiter is not None

        limiter.requests.clear()
        monkeypatch.setattr(limiter, "max_requests", 2)

        assert client.post("/ocr/paddle", json={}).status_code == 422
        assert client.post("/ocr/paddle", json={}).status_code == 422

        blocked = client.post("/ocr/paddle", json={})
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == str(limiter.window_seconds)

        # /health is exempt so monitoring keeps working under load.
        assert client.get("/health").status_code == 200

    def test_security_headers_are_present(self):
        response = client.get("/health")
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

class TestCORS:
    """Tests for CORS configuration."""

    def test_cors_allows_chrome_extension(self):
        """Should allow requests from chrome-extension:// origins."""
        response = client.options(
            "/health",
            headers={
                "Origin": "chrome-extension://abcdef123456",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200

    def test_cors_allows_localhost(self):
        """Should allow requests from localhost."""
        response = client.get(
            "/health",
            headers={"Origin": "http://localhost:3000"},
        )
        assert "access-control-allow-origin" in response.headers

    def test_cors_allows_127_loopback_dev_origin(self):
        response = client.get(
            "/health",
            headers={"Origin": "http://127.0.0.1:3000"},
        )
        assert response.headers.get("access-control-allow-origin") == "http://127.0.0.1:3000"


# ---------------------------------------------------------------------------
# Health responsiveness during model initialisation
# ---------------------------------------------------------------------------

class TestHealthDuringModelLoad:
    def test_health_and_unrelated_requests_answer_while_paddle_loads(self, monkeypatch):
        """/health must not queue behind the first model load.

        A fake engine blocks inside get_instance() until the test releases
        it, exactly where the real wrapper spends 5-15 s building a model.
        While that request is parked, /health (and any other request) must
        answer within a small budget and report the language as loading.
        """
        import asyncio
        import threading

        import httpx

        load_started = threading.Event()
        load_release = threading.Event()
        loading = set()

        class SlowPaddleEngine:
            @classmethod
            def get_instance(cls, language):
                loading.add(language)
                load_started.set()
                assert load_release.wait(timeout=5), "test never released the fake load"
                loading.discard(language)
                return cls()

            @classmethod
            def get_loaded_languages(cls):
                return []

            @classmethod
            def get_loading_languages(cls):
                return sorted(loading)

            def process_image(self, image_bytes):
                return []

        monkeypatch.setattr(server, "PADDLE_AVAILABLE", True)
        monkeypatch.setattr(server, "PaddleOCREngine", SlowPaddleEngine)

        async def scenario():
            transport = httpx.ASGITransport(app=server.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as async_client:
                ocr_task = asyncio.create_task(
                    async_client.post(
                        "/ocr/paddle",
                        json={"image": base64.b64encode(TINY_PNG).decode(), "lang": "ja"},
                    )
                )
                await asyncio.to_thread(load_started.wait, 5)
                assert load_started.is_set(), "the model load never started"

                health = await asyncio.wait_for(async_client.get("/health"), timeout=2.0)
                unrelated = await asyncio.wait_for(async_client.options("/health", headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                }), timeout=2.0)

                load_release.set()
                ocr = await asyncio.wait_for(ocr_task, timeout=5.0)
                return health, unrelated, ocr

        health, unrelated, ocr = asyncio.run(scenario())

        assert health.status_code == 200
        body = health.json()
        assert body["paddle_ocr_available"] is True
        assert body["paddle_ocr_loaded"] is False
        assert body["paddle_ocr_loading"] is True
        assert body["paddle_loading_languages"] == ["japan"]
        assert unrelated.status_code == 200
        assert ocr.status_code == 200

    def test_health_never_triggers_a_model_load(self, monkeypatch):
        calls = []

        class CountingEngine:
            @classmethod
            def get_instance(cls, language):
                calls.append(language)
                return cls()

            @classmethod
            def get_loaded_languages(cls):
                return []

            @classmethod
            def get_loading_languages(cls):
                return []

        monkeypatch.setattr(server, "PADDLE_AVAILABLE", True)
        monkeypatch.setattr(server, "PaddleOCREngine", CountingEngine)
        for _ in range(3):
            assert client.get("/health").status_code == 200
        assert calls == []
