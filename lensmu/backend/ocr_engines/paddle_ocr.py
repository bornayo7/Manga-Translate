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
import math
import os
import threading
from collections import OrderedDict

import numpy as np
from PIL import Image

# PaddleOCR 3.x performs a model-source connectivity check during import.
# Skip that in the local backend so initialization does not stall on startup.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

import paddleocr as _paddleocr_module
from paddleocr import PaddleOCR

logger = logging.getLogger(__name__)

# Constructor settings per PaddleOCR API generation. The two generations
# spell the same options differently and 2.x takes them as **kwargs, so the
# names cannot be discovered from the signature there; the generation is
# detected first (see _detect_api_generation) and the matching table used.
#
#   2.x (2.7 - 2.10): PaddleOCR(**kwargs) -> lang, use_angle_cls, det_db_thresh,
#                      det_db_unclip_ratio, use_gpu, show_log
#   3.x (3.0+):       explicit keyword parameters -> lang, use_textline_orientation,
#                      text_det_thresh, text_det_unclip_ratio (device is left to
#                      PaddleOCR's own selection)
PADDLE_2X_SETTINGS = {
    "use_angle_cls": True,       # detect 180-degree rotated text
    "det_db_thresh": 0.3,        # catch faint or small text
    "det_db_unclip_ratio": 1.8,  # expand boxes so they fully contain the text
    "use_gpu": False,            # CPU by default
    "show_log": False,           # quiet start-up
}
PADDLE_3X_SETTINGS = {
    "use_textline_orientation": True,
    "text_det_thresh": 0.3,
    "text_det_unclip_ratio": 1.8,
}


def _parse_major_version(version) -> "int | None":
    text = str(version or "").strip()
    if not text:
        return None
    head = text.split(".", 1)[0]
    digits = "".join(ch for ch in head if ch.isdigit())
    return int(digits) if digits else None


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
    # _instances is an LRU of one engine per language, capped at
    # _max_cached_languages because each loaded model costs real memory.
    #
    # Two locks on purpose:
    #   - _lock guards the cache map and is only ever held for a moment.
    #   - _load_lock serialises model construction, which takes several
    #     seconds. Keeping it separate means readers such as
    #     get_loaded_languages() (and therefore /health, which runs on the
    #     event loop) never wait behind a model load.
    _instances: "OrderedDict[str, PaddleOCREngine]" = OrderedDict()
    _loading: "set[str]" = set()
    _lock: threading.Lock = threading.Lock()
    _load_lock: threading.Lock = threading.Lock()
    _max_cached_languages = 2

    def __init__(self, language: str = "japan") -> None:
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
        self.language = language
        logger.info(
            "Initializing PaddleOCR engine for '%s' (this may take a few seconds)...",
            language,
        )
        paddle_kwargs = self._build_constructor_kwargs(language)
        self._ocr = PaddleOCR(**paddle_kwargs)
        logger.info("PaddleOCR engine for '%s' initialized successfully.", language)

    @classmethod
    def get_instance(cls, language: str = "japan") -> "PaddleOCREngine":
        """
        Return the cached PaddleOCREngine for a language, creating it on first call.

        Thread-safe: construction is serialised so that if two requests arrive
        simultaneously before the model is loaded, only one will create the
        instance. The cache lock is *not* held while the model loads, so
        get_loaded_languages() stays responsive during initialisation.
        """
        normalized_language = str(language or "japan").strip().lower()

        instance = cls._get_cached(normalized_language)
        if instance is not None:
            return instance

        with cls._load_lock:
            # Another request may have finished loading this language while
            # we waited for the load lock.
            instance = cls._get_cached(normalized_language)
            if instance is not None:
                return instance

            with cls._lock:
                cls._loading.add(normalized_language)
            try:
                instance = cls(normalized_language)
            finally:
                with cls._lock:
                    cls._loading.discard(normalized_language)

            with cls._lock:
                cls._instances[normalized_language] = instance
                while len(cls._instances) > cls._max_cached_languages:
                    evicted_language, _ = cls._instances.popitem(last=False)
                    logger.info(
                        "Evicted cached PaddleOCR language '%s' to limit model memory.",
                        evicted_language,
                    )

            return instance

    @classmethod
    def _get_cached(cls, language: str) -> "PaddleOCREngine | None":
        """Return the cached engine for a language (marking it recently used)."""
        with cls._lock:
            instance = cls._instances.get(language)
            if instance is not None:
                cls._instances.move_to_end(language)
            return instance

    @classmethod
    def get_loaded_languages(cls) -> list[str]:
        with cls._lock:
            return list(cls._instances.keys())

    @classmethod
    def get_loading_languages(cls) -> list[str]:
        """Languages whose model is being constructed right now (never blocks on the load)."""
        with cls._lock:
            return sorted(cls._loading)

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
    def _detect_api_generation(paddle_class=None, module=None) -> str:
        """
        Return "v2" or "v3" for the installed PaddleOCR.

        PaddleOCR 3.x declares its options as explicit keyword parameters,
        so their presence in the signature is decisive. PaddleOCR 2.x
        declares ``__init__(self, **kwargs)`` and exposes *no* option names,
        so checking names against that signature finds nothing; the package
        version decides there, and a bare ``**kwargs`` constructor with no
        version information is treated as 2.x (the only API shaped that way).
        """
        paddle_class = paddle_class or PaddleOCR
        module = module or _paddleocr_module
        parameters = inspect.signature(paddle_class.__init__).parameters

        if any(name in parameters for name in PADDLE_3X_SETTINGS):
            return "v3"

        major = _parse_major_version(
            getattr(module, "__version__", None) or getattr(module, "VERSION", None)
        )
        if major is not None:
            return "v3" if major >= 3 else "v2"

        accepts_var_kwargs = any(
            parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
        )
        if accepts_var_kwargs:
            return "v2"

        raise RuntimeError(
            "Unsupported PaddleOCR: neither the 3.x keyword parameters nor a 2.x "
            "**kwargs constructor were found. Supported: paddleocr 2.7-2.10 and 3.x."
        )

    @classmethod
    def _build_constructor_kwargs(cls, language: str = "japan", paddle_class=None, module=None) -> dict:
        """
        Build the constructor kwargs for the detected PaddleOCR generation.

        The two generations spell the same settings differently
        (use_angle_cls -> use_textline_orientation, det_db_thresh ->
        text_det_thresh, det_db_unclip_ratio -> text_det_unclip_ratio) and
        3.x dropped ``use_gpu``/``show_log``. Only the matching table is
        sent: 3.x rejects unknown keywords and 2.x silently ignores them, so
        guessing would either crash or drop the language.
        """
        paddle_class = paddle_class or PaddleOCR
        generation = cls._detect_api_generation(paddle_class, module)
        kwargs: dict = {"lang": language}

        if generation == "v3":
            parameters = inspect.signature(paddle_class.__init__).parameters
            accepts_var_kwargs = any(
                parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
            )
            for name, value in PADDLE_3X_SETTINGS.items():
                # A 3.x minor release may drop or rename an option; only pass
                # what this constructor actually declares.
                if name in parameters or accepts_var_kwargs:
                    kwargs[name] = value
            if "lang" not in parameters and not accepts_var_kwargs:
                raise RuntimeError("This PaddleOCR 3.x constructor does not accept 'lang'.")
        else:
            kwargs.update(PADDLE_2X_SETTINGS)

        logger.info("PaddleOCR %s API detected; constructor settings: %s", generation, sorted(kwargs))
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
            text = str(text_info[0] or "").strip()
            if not text:
                continue

            confidence = float(text_info[1])
            bbox = cls._polygon_to_bbox(polygon)

            # Match the 3.x path: a box with no area is useless to the
            # extension, and /ocr/manga rejects the *whole* request (422) if
            # even one such box is posted back as a crop rectangle.
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                continue

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
            return [max(0, int(round(float(point)))) for point in box]

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

        # Floor the minimums and ceil the maximums so the rectangle actually
        # contains every corner. Truncating with int() pulls both edges toward
        # zero, which shrinks the box on the right/bottom and can clip the last
        # glyph out of the crop that MangaOCR later receives.
        #
        # Clamp at zero: a detector polygon can poke slightly past the image
        # edge, and /ocr/manga rejects negative crop coordinates outright.
        return [
            max(0, math.floor(min(x_coords))),   # x_min (left edge)
            max(0, math.floor(min(y_coords))),   # y_min (top edge)
            max(0, math.ceil(max(x_coords))),    # x_max (right edge)
            max(0, math.ceil(max(y_coords))),    # y_max (bottom edge)
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
