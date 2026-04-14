# =============================================================================
# PaddleOCR Wrapper for VisionTranslate
# =============================================================================
#
# PaddleOCR is a general-purpose OCR toolkit that can:
#   - Detect text regions in an image (text detection)
#   - Recognize the text inside each detected region (text recognition)
#   - Classify text direction (0 or 180 degrees)
#
# WHY WE USE IT:
#   PaddleOCR is the "first pass" in our pipeline. It finds WHERE text is on
#   the page and draws bounding boxes around each text region. It also gives
#   us a rough text recognition, but for Japanese manga text, MangaOCR
#   (see manga_ocr.py) is much more accurate.
#
# WHAT PaddleOCR.ocr() RETURNS:
#   The raw output is a list of lists. Each inner list represents one page
#   (we always send single images, so we use result[0]). Each element in the
#   inner list is a tuple of:
#     (
#       [[x1,y1], [x2,y2], [x3,y3], [x4,y4]],  # 4-corner polygon
#       ("recognized text", confidence_score)      # text + confidence
#     )
#
#   The 4 corners are in order: top-left, top-right, bottom-right, bottom-left.
#   We convert these to a simpler [x_min, y_min, x_max, y_max] bounding box
#   format that the browser extension can use directly for positioning overlays.
#
# SINGLETON PATTERN:
#   The PaddleOCR model is ~100 MB and takes several seconds to initialize.
#   We use a singleton so it is only loaded once, even if multiple requests
#   come in simultaneously. The first request triggers the load; subsequent
#   requests reuse the same instance.
# =============================================================================

import io
import inspect
import logging
import os
import threading
from typing import Optional

import numpy as np
from PIL import Image

# PaddleOCR 3.x performs a model-source connectivity check during import.
# Skip that in the local backend so initialization does not stall on startup.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR

logger = logging.getLogger(__name__)


class PaddleOCREngine:
    """
    Singleton wrapper around PaddleOCR.

    Usage:
        engine = PaddleOCREngine.get_instance()
        results = engine.process_image(raw_image_bytes)
        # results is a list of dicts:
        # [
        #   {
        #     "text": "detected text string",
        #     "bbox": [x1, y1, x2, y2],
        #     "confidence": 0.95,
        #     "orientation": "horizontal"   # or "vertical"
        #   },
        #   ...
        # ]
    """

    # --- Singleton machinery ---------------------------------------------------
    # _instance holds the single PaddleOCREngine object.
    # _lock prevents two threads from creating the instance simultaneously
    # (this can happen if two HTTP requests arrive at the same time before
    # the model is loaded).
    _instance: Optional["PaddleOCREngine"] = None
    _lock: threading.Lock = threading.Lock()

    def __init__(self) -> None:
        """
        Initialize PaddleOCR with settings optimized for manga/comic text.

        Key parameters explained:
          - use_angle_cls=True : Enable the text direction classifier so we can
            detect text rotated 180 degrees (upside-down text in manga panels).
          - lang="japan"       : Use the Japanese recognition model. PaddleOCR
            supports 80+ languages; change this if you need other languages.
            Common values: "en" (English), "ch" (Chinese), "korean", "japan".
          - use_gpu=False      : Run on CPU. Set to True if you have a GPU with
            PaddlePaddle-GPU installed -- inference will be ~10x faster.
          - det_db_thresh=0.3  : Lower detection threshold to catch faint or
            small text (default is 0.3). Decrease for more sensitivity.
          - det_db_unclip_ratio=1.8 : How much to expand detected text regions.
            Higher values give larger bounding boxes that fully contain the text.
            Useful for manga where text can be close to bubble edges.
          - show_log=False     : Suppress PaddleOCR's verbose startup logs.
        """
        logger.info("Initializing PaddleOCR engine (this may take a few seconds)...")
        paddle_kwargs = self._build_constructor_kwargs()
        self._ocr = PaddleOCR(**paddle_kwargs)
        logger.info("PaddleOCR engine initialized successfully.")

    @classmethod
    def get_instance(cls) -> "PaddleOCREngine":
        """
        Return the singleton PaddleOCREngine instance, creating it on first call.

        Thread-safe: uses a lock so that if two requests arrive simultaneously
        before the model is loaded, only one will create the instance.
        """
        if cls._instance is None:
            with cls._lock:
                # Double-check inside the lock (another thread may have created
                # the instance while we were waiting for the lock).
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def process_image(self, image_bytes: bytes) -> list[dict]:
        """
        Run OCR on a raw image and return structured results.

        Args:
            image_bytes: Raw image file bytes (PNG, JPEG, WebP, etc.)
                         This is the decoded content of the image file, NOT
                         a base64 string. The server.py layer handles base64
                         decoding before calling this method.

        Returns:
            A list of dictionaries, one per detected text region:
            [
                {
                    "text": "recognized text",
                    "bbox": [x1, y1, x2, y2],    # top-left and bottom-right corners
                    "confidence": 0.95,            # 0.0 to 1.0
                    "orientation": "horizontal"    # or "vertical"
                },
                ...
            ]

            The list is ordered top-to-bottom, left-to-right (reading order).
            If no text is detected, an empty list is returned.
        """
        # --- Step 1: Decode the image bytes into a numpy array ----------------
        # PaddleOCR expects a numpy array in BGR format (like OpenCV) or a
        # file path. We convert from PIL (which loads as RGB) to a numpy array.
        # PaddleOCR internally handles the RGB -> BGR conversion.
        try:
            pil_image = Image.open(io.BytesIO(image_bytes))
            # Convert to RGB in case the image is RGBA (PNG with transparency),
            # grayscale, or palette mode. PaddleOCR works best with RGB.
            pil_image = pil_image.convert("RGB")
            image_array = np.array(pil_image)
        except Exception as e:
            logger.error(f"Failed to decode image: {e}")
            raise ValueError(f"Could not decode image: {e}")

        # --- Step 2: Run PaddleOCR --------------------------------------------
        # The ocr() method returns a list of pages. Since we send a single
        # image (not a PDF), we get a list with one element: result[0].
        # Each element in result[0] is:
        #   ( [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], ("text", confidence) )
        # where the 4 points are the corners of a quadrilateral (polygon)
        # bounding the detected text. The points are in order:
        #   top-left, top-right, bottom-right, bottom-left.
        if hasattr(self._ocr, "predict"):
            result = self._ocr.predict(image_array)
        else:
            # PaddleOCR 2.x compatibility path.
            result = self._ocr.ocr(image_array, cls=True)

        # --- Step 3: Handle empty results -------------------------------------
        if result is None or len(result) == 0:
            return []

        # --- Step 4: Transform raw results into our API format ----------------
        detections = self._normalize_detections(result)

        # --- Step 5: Sort by reading order ------------------------------------
        # Sort by vertical position first (top to bottom), then by horizontal
        # position (left to right). This gives a natural reading order for
        # most layouts. For pure vertical Japanese text (right to left), the
        # extension can re-sort on the frontend.
        detections.sort(key=lambda d: (d["bbox"][1], d["bbox"][0]))

        return detections

    @staticmethod
    def _build_constructor_kwargs() -> dict:
        """
        Build a PaddleOCR constructor kwargs dict that works across both
        PaddleOCR 2.x and 3.x.

        PaddleOCR 3.x renamed several arguments:
          - use_angle_cls        -> use_textline_orientation
          - det_db_thresh        -> text_det_thresh
          - det_db_unclip_ratio  -> text_det_unclip_ratio

        It also dropped `use_gpu` from the high-level pipeline constructor.
        """
        signature = inspect.signature(PaddleOCR.__init__)
        supported = signature.parameters
        kwargs: dict = {}

        if "lang" in supported:
            kwargs["lang"] = "japan"

        if "use_textline_orientation" in supported:
            kwargs["use_textline_orientation"] = True
        elif "use_angle_cls" in supported:
            kwargs["use_angle_cls"] = True

        if "text_det_thresh" in supported:
            kwargs["text_det_thresh"] = 0.3
        elif "det_db_thresh" in supported:
            kwargs["det_db_thresh"] = 0.3

        if "text_det_unclip_ratio" in supported:
            kwargs["text_det_unclip_ratio"] = 1.8
        elif "det_db_unclip_ratio" in supported:
            kwargs["det_db_unclip_ratio"] = 1.8

        if "use_gpu" in supported:
            kwargs["use_gpu"] = False

        return kwargs

    @classmethod
    def _normalize_detections(cls, result: list) -> list[dict]:
        """
        Normalize PaddleOCR results from either the old 2.x tuple format or
        the newer 3.x pipeline result objects into the backend API format.
        """
        if cls._looks_like_legacy_ocr_result(result):
            page_result = result[0]
            return cls._normalize_legacy_page(page_result)

        detections: list[dict] = []
        for page_result in result:
            detections.extend(cls._normalize_modern_page(page_result))
        return detections

    @staticmethod
    def _looks_like_legacy_ocr_result(result: list) -> bool:
        if not isinstance(result, list) or not result:
            return False
        first_page = result[0]
        if not isinstance(first_page, list) or not first_page:
            return False
        first_detection = first_page[0]
        return (
            isinstance(first_detection, (list, tuple))
            and len(first_detection) >= 2
            and isinstance(first_detection[0], (list, tuple))
        )

    @classmethod
    def _normalize_legacy_page(cls, page_result: list) -> list[dict]:
        detections = []
        for detection in page_result or []:
            polygon = detection[0]
            text_info = detection[1]
            text = text_info[0]
            confidence = float(text_info[1])
            bbox = cls._polygon_to_bbox(polygon)
            orientation = cls._detect_orientation(polygon)

            detections.append({
                "text": text,
                "bbox": bbox,
                "confidence": round(confidence, 4),
                "orientation": orientation,
            })

        return detections

    @classmethod
    def _normalize_modern_page(cls, page_result) -> list[dict]:
        payload = cls._coerce_result_payload(page_result)
        if not isinstance(payload, dict):
            return []

        texts = cls._to_plain_list(payload.get("rec_texts", []))
        scores = cls._to_plain_list(payload.get("rec_scores", []))
        boxes = cls._to_plain_list(payload.get("rec_boxes", []))
        polys = cls._to_plain_list(payload.get("rec_polys", payload.get("dt_polys", [])))

        detections = []
        for index, text in enumerate(texts):
            normalized_text = str(text or "").strip()
            if not normalized_text:
                continue

            confidence = float(scores[index]) if index < len(scores) else 0.0
            polygon = polys[index] if index < len(polys) else None
            bbox_source = boxes[index] if index < len(boxes) else polygon
            bbox = cls._normalize_box(bbox_source)

            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                continue

            orientation = (
                cls._detect_orientation(polygon)
                if polygon is not None
                else cls._detect_orientation(cls._bbox_to_polygon(bbox))
            )

            detections.append({
                "text": normalized_text,
                "bbox": bbox,
                "confidence": round(confidence, 4),
                "orientation": orientation,
            })

        return detections

    @staticmethod
    def _coerce_result_payload(page_result) -> dict | None:
        if isinstance(page_result, dict):
            if isinstance(page_result.get("res"), dict):
                return page_result["res"]
            return page_result

        result_payload = getattr(page_result, "res", None)
        if isinstance(result_payload, dict):
            return result_payload

        to_dict = getattr(page_result, "to_dict", None)
        if callable(to_dict):
            serialized = to_dict()
            if isinstance(serialized, dict):
                if isinstance(serialized.get("res"), dict):
                    return serialized["res"]
                return serialized

        return None

    @staticmethod
    def _to_plain_list(value):
        if value is None:
            return []
        if hasattr(value, "tolist"):
            value = value.tolist()
        return list(value)

    @classmethod
    def _normalize_box(cls, box) -> list[int]:
        if box is None:
            return [0, 0, 0, 0]

        if hasattr(box, "tolist"):
            box = box.tolist()

        if isinstance(box, (list, tuple)) and len(box) == 4 and not isinstance(box[0], (list, tuple)):
            return [int(round(float(point))) for point in box]

        return cls._polygon_to_bbox(box)

    @staticmethod
    def _bbox_to_polygon(bbox: list[int]) -> list[list[int]]:
        return [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[1]],
            [bbox[2], bbox[3]],
            [bbox[0], bbox[3]],
        ]

    @staticmethod
    def _polygon_to_bbox(polygon: list[list[float]]) -> list[int]:
        """
        Convert a 4-corner polygon to an axis-aligned bounding box.

        PaddleOCR gives us 4 corner points of a quadrilateral:
            [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
        in order: top-left, top-right, bottom-right, bottom-left.

        We compute the tightest axis-aligned rectangle that contains all
        4 points. This handles rotated text regions correctly.

        Returns:
            [x_min, y_min, x_max, y_max] as integers (pixel coordinates).
        """
        # Extract all x and y coordinates from the 4 corners.
        x_coords = [point[0] for point in polygon]
        y_coords = [point[1] for point in polygon]

        return [
            int(min(x_coords)),   # x_min (left edge)
            int(min(y_coords)),   # y_min (top edge)
            int(max(x_coords)),   # x_max (right edge)
            int(max(y_coords)),   # y_max (bottom edge)
        ]

    @staticmethod
    def _detect_orientation(polygon: list[list[float]]) -> str:
        """
        Determine whether a detected text region is horizontal or vertical.

        We compare the width and height of the bounding polygon:
          - If width >= height, the text runs horizontally (left to right).
          - If height > width, the text runs vertically (top to bottom).

        This is a simple heuristic that works well for manga/comic text,
        where vertical text is written in tall, narrow columns inside
        speech bubbles.

        Args:
            polygon: 4-corner polygon from PaddleOCR.
                     [[top-left], [top-right], [bottom-right], [bottom-left]]

        Returns:
            "horizontal" or "vertical"
        """
        # Calculate width: distance between top-left and top-right corners.
        # We use Euclidean distance to handle slightly rotated text.
        top_left = polygon[0]
        top_right = polygon[1]
        bottom_left = polygon[3]

        width = ((top_right[0] - top_left[0]) ** 2 +
                 (top_right[1] - top_left[1]) ** 2) ** 0.5

        # Calculate height: distance between top-left and bottom-left corners.
        height = ((bottom_left[0] - top_left[0]) ** 2 +
                  (bottom_left[1] - top_left[1]) ** 2) ** 0.5

        return "vertical" if height > width else "horizontal"
