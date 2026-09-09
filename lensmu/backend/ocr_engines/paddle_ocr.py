"""PaddleOCR library adapter: constructor differences, BGR input and stable boxes.

OcrRuntime owns model reuse and worker serialization. This adapter owns only
one model; it neither caches global instances nor decodes unbounded input.
"""

import inspect
import importlib.util
import logging
import math
import os

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

PADDLE_2X_SETTINGS = {
    "use_angle_cls": True,
    "det_db_thresh": 0.3,
    "det_db_unclip_ratio": 1.8,
    "use_gpu": False,
    "show_log": False,
}
PADDLE_3X_SETTINGS = {
    "use_doc_orientation_classify": False,
    "use_doc_unwarping": False,
    "use_textline_orientation": True,
    "text_det_thresh": 0.3,
    "text_det_unclip_ratio": 1.8,
}


def _paddle_library():
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    # The supported Windows CPU profile shares native DLL names between
    # Paddle and PyTorch. Load PyTorch first when installed; the inverse order
    # fails in torch/lib/shm.dll before either model can run. No models load.
    if os.name == "nt" and importlib.util.find_spec("torch") is not None:
        import torch  # noqa: F401
    import paddleocr
    return paddleocr.PaddleOCR, paddleocr


def _parse_major_version(version):
    head = str(version or "").strip().split(".", 1)[0]
    return int(head) if head.isdigit() else None


class PaddleOCREngine:
    def __init__(self, language="japan", *, paddle_class=None, module=None):
        if paddle_class is None:
            paddle_class, module = _paddle_library()
        self.language = language
        self._ocr = paddle_class(**self._build_constructor_kwargs(language, paddle_class, module))

    def process_image(self, image: Image.Image) -> list[dict]:
        # Paddle's ndarray interface uses OpenCV's BGR channel order. Document
        # preprocessing stays disabled so coordinates refer to this image.
        image_array = np.asarray(image)[:, :, ::-1].copy()
        result = (self._ocr.predict(image_array) if hasattr(self._ocr, "predict")
                  else self._ocr.ocr(image_array, cls=True))
        if result is None:
            return []
        detections = self._normalize_detections(result)
        valid = []
        for detection in detections:
            x1, y1, x2, y2 = detection["bbox"]
            bbox = [min(image.width, x1), min(image.height, y1),
                    min(image.width, x2), min(image.height, y2)]
            if bbox[2] > bbox[0] and bbox[3] > bbox[1]:
                valid.append({**detection, "bbox": bbox})
        return sorted(valid, key=lambda detection: (detection["bbox"][1], detection["bbox"][0]))

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
        if paddle_class is None:
            paddle_class, module = _paddle_library()
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
        paddle_class = paddle_class or _paddle_library()[0]
        generation = cls._detect_api_generation(paddle_class, module)
        kwargs: dict = {"lang": language}

        if generation == "v3":
            parameters = inspect.signature(paddle_class.__init__).parameters
            accepts_var_kwargs = any(
                parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
            )
            geometry_options = {"use_doc_orientation_classify", "use_doc_unwarping"}
            if not accepts_var_kwargs and not geometry_options.issubset(parameters):
                raise RuntimeError("This PaddleOCR constructor cannot disable document geometry changes.")
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

        if not isinstance(result, (list, tuple)):
            raise RuntimeError("PaddleOCR returned an invalid result collection.")
        detections: list[dict] = []
        for page_result in result:
            if page_result is None or (isinstance(page_result, list) and not page_result):
                continue
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
            if not math.isfinite(confidence):
                raise RuntimeError("PaddleOCR returned a non-finite confidence score.")
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
        if not isinstance(payload, dict) or payload.get("rec_texts") is None or payload.get("error"):
            raise RuntimeError("PaddleOCR returned an invalid or failed result payload.")

        texts = cls._to_plain_list(payload.get("rec_texts", []))
        scores = cls._to_plain_list(payload.get("rec_scores", []))
        boxes = cls._to_plain_list(payload.get("rec_boxes", []))
        polys = cls._to_plain_list(payload.get("rec_polys", payload.get("dt_polys", [])))

        detections = []
        for index, text in enumerate(texts):
            if not isinstance(text, str):
                raise RuntimeError("PaddleOCR returned invalid recognition text.")
            normalized_text = str(text or "").strip()
            if not normalized_text:
                continue

            if index >= len(scores) or (index >= len(boxes) and index >= len(polys)):
                raise RuntimeError("PaddleOCR returned incomplete recognition scores or geometry.")
            confidence = float(scores[index])
            if not math.isfinite(confidence):
                raise RuntimeError("PaddleOCR returned a non-finite confidence score.")
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
        if not isinstance(value, (list, tuple)):
            raise RuntimeError("PaddleOCR returned an invalid result array.")
        return list(value)

    @classmethod
    def _normalize_box(cls, box) -> list[int]:
        if box is None:
            return [0, 0, 0, 0]

        if hasattr(box, "tolist"):
            box = box.tolist()

        if isinstance(box, (list, tuple)) and len(box) == 4 and not isinstance(box[0], (list, tuple)):
            x1, y1, x2, y2 = map(float, box)
            return [max(0, math.floor(x1)), max(0, math.floor(y1)),
                    max(0, math.ceil(x2)), max(0, math.ceil(y2))]

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
