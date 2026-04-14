# VisionTranslate Backend Server
#
# HOW TO RUN:
#   cd lensmu/backend
#   pip install -r requirements.txt
#   python server.py
#   # Server starts at http://localhost:8000
#   # API docs at http://localhost:8000/docs

import base64
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

if __package__:
    from .security import add_security_middleware, validate_image_size
else:
    from security import add_security_middleware, validate_image_size

# OCR engines are optional heavy deps -- server starts without them and
# reports availability via /health.

try:
    if __package__:
        from .ocr_engines.paddle_ocr import PaddleOCREngine
    else:
        from ocr_engines.paddle_ocr import PaddleOCREngine
    PADDLE_AVAILABLE = True
except ImportError as e:
    PADDLE_AVAILABLE = False
    PaddleOCREngine = None  # type: ignore
    logging.getLogger("vt").warning(
        f"PaddleOCR not available: {e}. "
        "Install with: pip install paddlepaddle paddleocr"
    )

try:
    if __package__:
        from .ocr_engines.manga_ocr import MangaOCREngine
    else:
        from ocr_engines.manga_ocr import MangaOCREngine
    MANGA_AVAILABLE = True
except ImportError as e:
    MANGA_AVAILABLE = False
    MangaOCREngine = None  # type: ignore
    logging.getLogger("vt").warning(
        f"MangaOCR not available: {e}. "
        "Install with: pip install manga-ocr"
    )

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("vt")


# -- Request / Response schemas ------------------------------------------------

class PaddleOCRRequest(BaseModel):
    image: str = Field(
        ...,
        description="Base64-encoded image (PNG/JPEG/WebP). No data-URL prefix.",
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
    bboxes: list[list[int]] = Field(
        ...,
        description="Bounding boxes from PaddleOCR, each [x1, y1, x2, y2].",
    )


class MangaOCRDetection(BaseModel):
    text: str
    bbox: list[int]


class MangaOCRResponse(BaseModel):
    detections: list[MangaOCRDetection]
    count: int
    processing_time_ms: float


class HealthResponse(BaseModel):
    status: str
    paddle_ocr_available: bool
    paddle_ocr_loaded: bool
    manga_ocr_available: bool
    manga_ocr_loaded: bool


# -- App lifespan --------------------------------------------------------------
# Models are lazy-loaded on first request, not at startup.

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("VisionTranslate backend starting up")
    logger.info("API docs available at http://localhost:8000/docs")
    logger.info("PaddleOCR: %s", "AVAILABLE" if PADDLE_AVAILABLE else "NOT INSTALLED")
    logger.info("MangaOCR:  %s", "AVAILABLE" if MANGA_AVAILABLE else "NOT INSTALLED")
    if not (PADDLE_AVAILABLE or MANGA_AVAILABLE):
        logger.warning(
            "No OCR engines installed! OCR endpoints will return 501 errors. "
            "Install deps with: pip install -r requirements-ocr.txt"
        )
    logger.info("=" * 60)
    yield
    logger.info("VisionTranslate backend shutting down")


# -- FastAPI app ---------------------------------------------------------------

app = FastAPI(
    title="VisionTranslate OCR Backend",
    description=(
        "Local OCR server for the VisionTranslate browser extension. "
        "Provides PaddleOCR text detection and MangaOCR Japanese recognition."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Security middleware must be added BEFORE CORS (middleware runs in reverse order).
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1",
    ],
    allow_origin_regex=r"^(chrome-extension|moz-extension)://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- Helpers -------------------------------------------------------------------

def decode_base64_image(base64_string: str) -> bytes:
    """Decode a base64 string to raw image bytes, stripping data-URL prefix if present."""
    if "," in base64_string:
        base64_string = base64_string.split(",", 1)[1]

    try:
        return base64.b64decode(base64_string)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid base64 image data: {e}",
        )


# -- Endpoints -----------------------------------------------------------------

@app.get("/health", response_model=HealthResponse, summary="Health check")
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        paddle_ocr_available=PADDLE_AVAILABLE,
        paddle_ocr_loaded=PADDLE_AVAILABLE and PaddleOCREngine._instance is not None,
        manga_ocr_available=MANGA_AVAILABLE,
        manga_ocr_loaded=MANGA_AVAILABLE and MangaOCREngine._instance is not None,
    )


@app.post("/ocr/paddle", response_model=PaddleOCRResponse, summary="Detect text with PaddleOCR")
async def paddle_ocr(request: PaddleOCRRequest) -> PaddleOCRResponse:
    if not PADDLE_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="PaddleOCR is not installed. See requirements-ocr.txt.",
        )

    start_time = time.time()
    image_bytes = decode_base64_image(request.image)
    validate_image_size(image_bytes)

    try:
        engine = PaddleOCREngine.get_instance()
    except Exception as e:
        logger.error(f"Failed to initialize PaddleOCR: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to initialize PaddleOCR: {e}")

    try:
        detections = engine.process_image(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"PaddleOCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"OCR processing failed: {e}")

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(f"PaddleOCR: {len(detections)} regions in {elapsed_ms:.1f}ms")

    return PaddleOCRResponse(
        detections=[PaddleOCRDetection(**d) for d in detections],
        count=len(detections),
        processing_time_ms=round(elapsed_ms, 1),
    )


@app.post("/ocr/manga", response_model=MangaOCRResponse, summary="Recognize Japanese text with MangaOCR")
async def manga_ocr(request: MangaOCRRequest) -> MangaOCRResponse:
    if not MANGA_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="MangaOCR is not installed. See requirements-ocr.txt.",
        )

    start_time = time.time()

    if not request.bboxes:
        raise HTTPException(
            status_code=400,
            detail="No bounding boxes provided. Send bboxes from /ocr/paddle.",
        )

    image_bytes = decode_base64_image(request.image)
    validate_image_size(image_bytes)

    try:
        engine = MangaOCREngine.get_instance()
    except Exception as e:
        logger.error(f"Failed to initialize MangaOCR: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to initialize MangaOCR: {e}")

    try:
        detections = engine.process_regions(image_bytes, request.bboxes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"MangaOCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"MangaOCR processing failed: {e}")

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(f"MangaOCR: {len(detections)} regions in {elapsed_ms:.1f}ms")

    return MangaOCRResponse(
        detections=[MangaOCRDetection(**d) for d in detections],
        count=len(detections),
        processing_time_ms=round(elapsed_ms, 1),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )
