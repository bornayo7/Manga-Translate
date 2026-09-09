# VisionTranslate Backend Server
#
# HOW TO RUN:
#   cd lensmu/backend
#   pip install -r requirements.txt
#   python server.py
#   # Server starts at http://localhost:8000
#   # API docs at http://localhost:8000/docs

import base64
import binascii
import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Literal
from pydantic import BaseModel, Field, StrictInt, field_validator

if __package__:
    from .security import add_security_middleware, validate_image_size
    from .ocr_runtime import OcrError, OcrRuntime, create_default_runtime
else:
    from security import add_security_middleware, validate_image_size
    from ocr_runtime import OcrError, OcrRuntime, create_default_runtime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("vt")

MAX_MANGA_REGIONS = 200
MAX_MANGA_COORDINATE = 100_000
MAX_MANGA_TOTAL_REGION_PIXELS = 50_000_000


# -- Request / Response schemas ------------------------------------------------

class PaddleOCRRequest(BaseModel):
    image: str = Field(
        ...,
        description="Base64-encoded image (PNG/JPEG/WebP). No data-URL prefix.",
    )
    lang: str = Field(
        default="japan",
        min_length=2,
        max_length=32,
        description="PaddleOCR language code, for example en, es, japan, korean, or ch.",
    )


class PaddleOCRDetection(BaseModel):
    text: str
    bbox: list[int] = Field(..., description="[x1, y1, x2, y2] in pixels.")
    confidence: float
    orientation: str = Field(..., description='"horizontal" or "vertical".')


class PaddleOCRResponse(BaseModel):
    detections: list[PaddleOCRDetection]
    count: int
    processing_time_ms: float


class MangaOCRRequest(BaseModel):
    image: str = Field(
        ...,
        description="Base64-encoded image (same one sent to /ocr/paddle).",
    )
    bboxes: list[list[StrictInt]] = Field(
        ...,
        min_length=1,
        max_length=MAX_MANGA_REGIONS,
        description="Bounding boxes from PaddleOCR, each [x1, y1, x2, y2].",
    )

    @field_validator("bboxes")
    @classmethod
    def validate_bboxes(cls, bboxes: list[list[int]]) -> list[list[int]]:
        total_area = 0
        for index, bbox in enumerate(bboxes):
            if len(bbox) != 4:
                raise ValueError(f"bbox {index} must contain exactly four coordinates")

            x1, y1, x2, y2 = bbox
            if any(isinstance(value, bool) or not isinstance(value, int) for value in bbox):
                raise ValueError(f"bbox {index} coordinates must be integers")
            if any(value < 0 or value > MAX_MANGA_COORDINATE for value in bbox):
                raise ValueError(
                    f"bbox {index} coordinates must be between 0 and {MAX_MANGA_COORDINATE}"
                )
            if x2 <= x1 or y2 <= y1:
                raise ValueError(f"bbox {index} must satisfy x2 > x1 and y2 > y1")

            total_area += (x2 - x1) * (y2 - y1)
            if total_area > MAX_MANGA_TOTAL_REGION_PIXELS:
                raise ValueError("aggregate bounding-box area exceeds the request limit")

        return bboxes


class MangaOCRDetection(BaseModel):
    text: str
    bbox: list[int]
    status: Literal["recognized", "empty", "failed", "outside_image"] = "recognized"
    error: str | None = None


class MangaOCRResponse(BaseModel):
    detections: list[MangaOCRDetection]
    count: int
    processing_time_ms: float
    failed_regions: list[int] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    paddle_ocr_available: bool
    paddle_ocr_loaded: bool
    paddle_ocr_loading: bool = False
    manga_ocr_available: bool
    manga_ocr_loaded: bool
    manga_ocr_loading: bool = False
    manga_full_available: bool
    paddle_loaded_languages: list[str]
    paddle_loading_languages: list[str] = Field(default_factory=list)


# -- HTTP composition ----------------------------------------------------------

router = APIRouter()


def get_runtime(request: Request) -> OcrRuntime:
    return request.app.state.ocr_runtime


def create_app(runtime: OcrRuntime | None = None) -> FastAPI:
    runtime = runtime if runtime is not None else create_default_runtime()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("VisionTranslate backend starting: %s", runtime.status())
        yield
        await asyncio.to_thread(runtime.close)

    application = FastAPI(
        title="VisionTranslate OCR Backend", version="1.0.0", lifespan=lifespan,
        description="Local, bounded OCR for the lensmu browser extension.",
    )
    application.state.ocr_runtime = runtime
    add_security_middleware(application)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            f"http://{host}{port}"
            for host in ("localhost", "127.0.0.1")
            for port in ("", ":3000", ":5173", ":8080")
        ],
        allow_origin_regex=r"^(chrome-extension|moz-extension)://.*$",
        allow_credentials=True, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"],
    )

    @application.exception_handler(OcrError)
    async def ocr_error_handler(_request: Request, error: OcrError):
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": str(error), "code": error.code},
            headers={"Retry-After": "1"} if error.status_code == 429 else None,
        )

    application.include_router(router)
    return application


# -- Input contract ------------------------------------------------------------

PADDLE_LANGUAGE_ALIASES = {
    "auto": "japan",
    "ja": "japan",
    "jp": "japan",
    "zh": "ch",
    "zh-cn": "ch",
    "zh-tw": "chinese_cht",
    "ko": "korean",
}
PADDLE_SUPPORTED_LANGUAGES = {
    "ch",
    "chinese_cht",
    "de",
    "en",
    "es",
    "fr",
    "japan",
    "korean",
}


def normalize_paddle_language(language: str) -> str:
    normalized = str(language or "japan").strip().lower()
    resolved = PADDLE_LANGUAGE_ALIASES.get(normalized, normalized)
    if resolved not in PADDLE_SUPPORTED_LANGUAGES:
        supported = ", ".join(sorted(PADDLE_SUPPORTED_LANGUAGES))
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported PaddleOCR language '{language}'. Supported values: {supported}.",
        )
    return resolved

def decode_base64_image(base64_string: str) -> bytes:
    """Decode a base64 string to raw image bytes, stripping data-URL prefix if present."""
    if "," in base64_string:
        base64_string = base64_string.split(",", 1)[1]

    try:
        normalized = "".join(base64_string.split())
        return base64.b64decode(normalized, validate=True)
    except (ValueError, binascii.Error) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid base64 image data: {e}",
        )


# -- Endpoints -----------------------------------------------------------------

@router.get("/health", response_model=HealthResponse, summary="Health check")
async def health_check(runtime: OcrRuntime = Depends(get_runtime)) -> HealthResponse:
    return HealthResponse(status="ok", **runtime.status())


@router.post("/ocr/paddle", response_model=PaddleOCRResponse, summary="Detect text with PaddleOCR")
async def paddle_ocr(
    request: PaddleOCRRequest, runtime: OcrRuntime = Depends(get_runtime),
) -> PaddleOCRResponse:
    if not runtime.status()["paddle_ocr_available"]:
        raise OcrError("PaddleOCR is not installed. See requirements-ocr.txt.",
                       status_code=501, code="ocr_unavailable")
    start_time = time.perf_counter()
    language = normalize_paddle_language(request.lang)
    image_bytes = decode_base64_image(request.image)
    validate_image_size(image_bytes)
    detections = await runtime.paddle(image_bytes, language)

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    logger.info(f"PaddleOCR: {len(detections)} regions in {elapsed_ms:.1f}ms")

    return PaddleOCRResponse(
        detections=[PaddleOCRDetection(**d) for d in detections],
        count=len(detections),
        processing_time_ms=round(elapsed_ms, 1),
    )


@router.post("/ocr/manga", response_model=MangaOCRResponse, summary="Recognize Japanese text with MangaOCR", response_model_exclude_none=True)
async def manga_ocr(
    request: MangaOCRRequest, runtime: OcrRuntime = Depends(get_runtime),
) -> MangaOCRResponse:
    if not runtime.status()["manga_ocr_available"]:
        raise OcrError("MangaOCR is not installed. See requirements-ocr.txt.",
                       status_code=501, code="ocr_unavailable")
    start_time = time.perf_counter()
    image_bytes = decode_base64_image(request.image)
    validate_image_size(image_bytes)
    detections = await runtime.manga(image_bytes, request.bboxes)
    failed_regions = [i for i, detection in enumerate(detections) if detection.get("status") == "failed"]
    skipped_regions = [i for i, detection in enumerate(detections) if detection.get("status") == "outside_image"]
    warnings = []
    if failed_regions:
        warnings.append(f"MangaOCR failed to recognize {len(failed_regions)} region(s).")
    if skipped_regions:
        warnings.append(f"{len(skipped_regions)} region(s) were outside the image.")

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    logger.info(f"MangaOCR: {len(detections)} regions in {elapsed_ms:.1f}ms")

    return MangaOCRResponse(
        detections=[MangaOCRDetection(**d) for d in detections],
        failed_regions=failed_regions,
        warnings=warnings,
        count=len(detections),
        processing_time_ms=round(elapsed_ms, 1),
    )


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("VISIONTRANSLATE_HOST", "127.0.0.1"),
        port=8000,
        reload=False,
        log_level="info",
    )
