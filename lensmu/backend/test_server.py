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
import pytest
from fastapi.testclient import TestClient
from server import app


client = TestClient(app)


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

    def test_invalid_base64(self):
        """Request with invalid base64 should return 400 or 501."""
        response = client.post("/ocr/paddle", json={"image": "not-valid-base64!!!"})
        # 501 if PaddleOCR not installed, 400 if installed but bad image
        assert response.status_code in [400, 501]


# ---------------------------------------------------------------------------
# MangaOCR Endpoint — Input Validation
# ---------------------------------------------------------------------------

class TestMangaOCRValidation:
    """Tests for /ocr/manga input validation."""

    def test_missing_fields(self):
        """Request without required fields should return 422."""
        response = client.post("/ocr/manga", json={})
        assert response.status_code == 422

    def test_missing_bboxes(self):
        """Request with image but no bboxes should return 422."""
        response = client.post("/ocr/manga", json={"image": "abc123"})
        assert response.status_code == 422

    def test_empty_bboxes(self):
        """Request with empty bboxes list should return 400 or 501."""
        response = client.post(
            "/ocr/manga",
            json={"image": "abc123", "bboxes": []}
        )
        # 501 if MangaOCR not installed, 400 if installed but empty bboxes
        assert response.status_code in [400, 501]


# ---------------------------------------------------------------------------
# Base64 Decoding
# ---------------------------------------------------------------------------

class TestBase64Decoding:
    """Tests for base64 image handling."""

    def test_valid_base64_with_data_url_prefix(self):
        """Should handle data URL prefix gracefully."""
        # Create a tiny valid PNG (1x1 pixel, red)
        # This tests that the data URL prefix is stripped correctly
        tiny_png = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
            b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00'
            b'\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00'
            b'\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        b64_with_prefix = "data:image/png;base64," + base64.b64encode(tiny_png).decode()

        response = client.post(
            "/ocr/paddle",
            json={"image": b64_with_prefix}
        )
        # Should NOT return 400 for bad base64 — the prefix should be stripped
        # Will return 501 if PaddleOCR isn't installed, which is fine
        assert response.status_code != 400 or "Invalid base64" not in response.json().get("detail", "")


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
