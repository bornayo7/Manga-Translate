"""Japanese crop recognition with aligned, truthful region outcomes."""

import logging

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


class MangaOCREngine:
    def __init__(self, *, model=None):
        if model is None:
            from manga_ocr import MangaOcr
            model = MangaOcr()
        self._ocr = model

    def process_regions(self, image: Image.Image, bboxes: list[list[int]]) -> list[dict]:
        """Keep input indices; failed inference is distinct from an empty crop.

        OcrRuntime owns input decoding, model reuse and worker serialization.
        Out-of-image boxes have explicit skipped outcomes. If every attempted
        inference fails, raise instead of reporting a successful empty result.
        """
        results = []
        attempted = failed = 0
        for bbox in bboxes:
            x1, y1, x2, y2 = bbox
            clamped = [max(0, min(x1, image.width)), max(0, min(y1, image.height)),
                       max(0, min(x2, image.width)), max(0, min(y2, image.height))]
            if clamped[2] <= clamped[0] or clamped[3] <= clamped[1]:
                results.append({"text": "", "bbox": clamped, "status": "outside_image"})
                continue
            attempted += 1
            try:
                with image.crop(tuple(clamped)) as cropped:
                    with ImageOps.expand(cropped, border=5, fill="white") as padded:
                        text = self._ocr(padded)
                if not isinstance(text, str):
                    raise RuntimeError("MangaOCR returned a non-text result.")
                text = text.strip()
                results.append({"text": text, "bbox": clamped,
                                "status": "recognized" if text else "empty"})
            except Exception:
                logger.exception("MangaOCR region recognition failed")
                failed += 1
                results.append({"text": "", "bbox": clamped, "status": "failed",
                                "error": "MangaOCR could not recognize this region."})
        if attempted and failed == attempted:
            raise RuntimeError(f"MangaOCR failed for all {attempted} region(s).")
        return results
