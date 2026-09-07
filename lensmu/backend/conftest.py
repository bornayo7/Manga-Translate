"""Shared fixtures and helpers for the backend test suites."""

import io

from PIL import Image


def make_png(width: int = 4, height: int = 4) -> bytes:
    """Return a small, genuinely decodable PNG (PIL rejects hand-rolled ones)."""
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


TINY_PNG = make_png()
