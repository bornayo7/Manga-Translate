# =============================================================================
# MangaOCR Wrapper for VisionTranslate
# =============================================================================
#
# MangaOCR is a specialized OCR model for Japanese manga text. It is based on
# a Vision Encoder-Decoder architecture (ViT encoder + GPT-2 decoder) that
# was fine-tuned specifically on manga text images.
#
# WHY WE NEED IT (in addition to PaddleOCR):
#   PaddleOCR is good at DETECTING where text is, but its Japanese text
#   RECOGNITION accuracy is mediocre, especially for:
#     - Vertical Japanese text (common in manga speech bubbles)
#     - Stylized/handwritten fonts used in manga
#     - Text with furigana (small reading guides above kanji)
#     - Onomatopoeia (sound effects drawn as part of the art)
#
#   MangaOCR excels at all of these because it was trained on actual manga
#   panels. However, it does NOT detect text regions -- it only recognizes
#   text from a pre-cropped image.
#
# TYPICAL WORKFLOW:
#   1. PaddleOCR detects text regions (bounding boxes) in the full image.
#   2. We crop each bounding box region from the original image.
#   3. MangaOCR reads the text in each cropped region.
#   4. We return the recognized text + original bounding box coordinates.
#
# MODEL SIZE:
#   MangaOCR downloads a ~400 MB model on first use. It is stored in the
#   HuggingFace cache directory (~/.cache/huggingface/).
#
# SINGLETON PATTERN:
#   Same as PaddleOCR -- the model is loaded once and reused for all requests.
# =============================================================================

import io
import logging
import threading
from typing import Optional

from PIL import Image
from manga_ocr import MangaOcr

logger = logging.getLogger(__name__)


class MangaOCREngine:
    """
    Singleton wrapper around the manga-ocr library.

    Usage:
        engine = MangaOCREngine.get_instance()

        # Option 1: Recognize text from a single cropped image
        text = engine.process_image(raw_image_bytes)

        # Option 2: Recognize text from multiple regions of a full image
        results = engine.process_regions(full_image_bytes, bboxes)
        # results = [{"text": "recognized text", "bbox": [x1, y1, x2, y2]}, ...]
    """

    # --- Singleton machinery ---------------------------------------------------
    _instance: Optional["MangaOCREngine"] = None
    _lock: threading.Lock = threading.Lock()

    def __init__(self) -> None:
        """
        Initialize MangaOCR.

        On first run, this will download the model (~400 MB) from HuggingFace.
        Subsequent runs load from cache (~/.cache/huggingface/).

        The MangaOcr() constructor accepts these optional arguments:
          - pretrained_model_name_or_path: HuggingFace model ID or local path.
            Default is "kha-white/manga-ocr-base" which is the standard model.
          - force_cpu: Force CPU inference even if GPU is available.
            We don't set this -- manga-ocr auto-detects GPU availability.
        """
        logger.info(
            "Initializing MangaOCR engine "
            "(first run will download ~400 MB model)..."
        )
        self._ocr = MangaOcr()
        logger.info("MangaOCR engine initialized successfully.")

    @classmethod
    def get_instance(cls) -> "MangaOCREngine":
        """
        Return the singleton MangaOCREngine instance, creating it on first call.

        Thread-safe: uses a lock to prevent duplicate initialization.
        """
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def process_image(self, image_bytes: bytes) -> str:
        """
        Recognize Japanese text from a single cropped image.

        This method is for when you already have a cropped image containing
        just the text you want to recognize (e.g., a single speech bubble
        that was cropped from a larger page).

        Args:
            image_bytes: Raw image file bytes (PNG, JPEG, WebP, etc.)
                         Must be the decoded file content, NOT base64.

        Returns:
            A string of recognized Japanese text. MangaOCR returns the text
            as-is (no confidence score is available from this model).

        Example:
            Given an image of a manga speech bubble containing "こんにちは",
            this method returns the string "こんにちは".
        """
        try:
            pil_image = Image.open(io.BytesIO(image_bytes))
            # MangaOCR works with RGB images. Convert in case the input is
            # RGBA (PNG transparency), grayscale, or palette mode.
            pil_image = pil_image.convert("RGB")
        except Exception as e:
            logger.error(f"Failed to decode image: {e}")
            raise ValueError(f"Could not decode image: {e}")

        # MangaOcr.__call__ accepts a PIL Image and returns a string.
        # It runs the image through the ViT encoder and generates text
        # with the GPT-2 decoder using beam search.
        text = self._ocr(pil_image)
        return text

    def process_regions(
        self,
        image_bytes: bytes,
        bboxes: list[list[int]],
    ) -> list[dict]:
        """
        Recognize text from multiple rectangular regions of a single image.

        This is the primary method used in the PaddleOCR -> MangaOCR pipeline:
          1. PaddleOCR detects text bounding boxes in the full page image.
          2. The browser extension sends those bounding boxes + the same image
             to this method.
          3. We crop each bounding box region and run MangaOCR on it.
          4. We return the recognized text paired with its bounding box.

        Args:
            image_bytes: Raw bytes of the FULL image (the entire screenshot
                         or manga page). We crop sub-regions from this.

            bboxes: List of bounding boxes, each in [x1, y1, x2, y2] format
                    where (x1, y1) is the top-left corner and (x2, y2) is the
                    bottom-right corner, in pixel coordinates.
                    Example: [[10, 20, 200, 80], [300, 50, 500, 120]]

        Returns:
            A list of dicts, one per bounding box:
            [
                {
                    "text": "recognized Japanese text",
                    "bbox": [x1, y1, x2, y2]  # same bbox that was input
                },
                ...
            ]

            The order matches the input bboxes order. If a region fails to
            process, its "text" will be an empty string (we don't skip it,
            so the indices stay aligned).
        """
        # --- Step 1: Open the full image --------------------------------------
        try:
            full_image = Image.open(io.BytesIO(image_bytes))
            full_image = full_image.convert("RGB")
        except Exception as e:
            logger.error(f"Failed to decode image: {e}")
            raise ValueError(f"Could not decode image: {e}")

        image_width, image_height = full_image.size
        results = []

        # --- Step 2: Process each bounding box --------------------------------
        for bbox in bboxes:
            # Validate the bounding box format.
            if len(bbox) != 4:
                logger.warning(f"Skipping invalid bbox (expected 4 values): {bbox}")
                results.append({"text": "", "bbox": bbox})
                continue

            x1, y1, x2, y2 = bbox

            # Clamp coordinates to image boundaries to avoid cropping errors.
            # The browser extension might send coordinates that are slightly
            # outside the image if the user's screenshot was resized.
            x1 = max(0, min(x1, image_width))
            y1 = max(0, min(y1, image_height))
            x2 = max(0, min(x2, image_width))
            y2 = max(0, min(y2, image_height))
            clamped_bbox = [x1, y1, x2, y2]

            # Skip degenerate bounding boxes (zero width or height).
            if x2 <= x1 or y2 <= y1:
                logger.warning(f"Skipping degenerate bbox: {bbox}")
                results.append({"text": "", "bbox": clamped_bbox})
                continue

            # --- Step 3: Crop the region and run MangaOCR ---------------------
            try:
                # PIL's crop() takes a 4-tuple: (left, upper, right, lower).
                cropped = full_image.crop((x1, y1, x2, y2))

                # Add some padding around the cropped region. MangaOCR
                # performs better when the text isn't right at the edge of
                # the image. We add a 5-pixel white border.
                padded = self._add_padding(cropped, padding=5)

                # Run MangaOCR on the padded crop.
                text = self._ocr(padded)

                results.append({
                    "text": text,
                    # Return the clamped bbox so the browser overlay always
                    # stays within the actual image boundaries.
                    "bbox": clamped_bbox,
                })
            except Exception as e:
                logger.error(f"Failed to process region {bbox}: {e}")
                results.append({"text": "", "bbox": clamped_bbox})

        return results

    @staticmethod
    def _add_padding(image: Image.Image, padding: int = 5) -> Image.Image:
        """
        Add a white border around an image.

        MangaOCR works better when there is some whitespace around the text.
        If the crop is too tight (text touching the edges), recognition
        accuracy drops. Adding a small white border fixes this.

        Args:
            image:   PIL Image to pad.
            padding: Number of pixels to add on each side.

        Returns:
            A new PIL Image with white padding added on all sides.
        """
        new_width = image.width + 2 * padding
        new_height = image.height + 2 * padding

        # Create a new white image and paste the original in the center.
        padded = Image.new("RGB", (new_width, new_height), (255, 255, 255))
        padded.paste(image, (padding, padding))
        return padded
