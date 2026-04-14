# =============================================================================
# OCR Engines Package
# =============================================================================
#
# This package contains wrapper classes for two OCR engines:
#
#   1. PaddleOCR  (paddle_ocr.py)
#      - General-purpose OCR that works with 80+ languages
#      - Detects text regions (bounding boxes) AND recognizes the text
#      - Great first pass: find where all the text is on a page
#
#   2. MangaOCR   (manga_ocr.py)
#      - Specialized for Japanese manga/comic text
#      - Does NOT detect text regions -- you must provide cropped images
#      - Much more accurate than PaddleOCR for Japanese vertical text in
#        speech bubbles
#
# Typical workflow for the browser extension:
#   Step 1: User screenshots a region of a manga page
#   Step 2: Send screenshot to /ocr/paddle to get bounding boxes + rough text
#   Step 3: Send the same screenshot + bounding boxes to /ocr/manga to get
#            accurate Japanese text for each detected region
#   Step 4: Extension overlays translated text on the page
# =============================================================================

# Imports are done conditionally in server.py so the server can start
# even if OCR dependencies aren't installed. Don't import here to avoid
# forcing the ImportError at package-level.

__all__ = ["PaddleOCREngine", "MangaOCREngine"]
