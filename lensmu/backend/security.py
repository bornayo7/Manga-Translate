# Security middleware: request size limits, rate limiting, security headers.

import time
import logging
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("vt.security")

MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024      # 10 MB
MAX_REQUEST_BODY_BYTES = 15 * 1024 * 1024    # 15 MB (base64 overhead)
RATE_LIMIT_MAX_REQUESTS = 60
RATE_LIMIT_WINDOW_SECONDS = 60


def validate_image_size(image_bytes: bytes) -> None:
    """Reject images exceeding MAX_IMAGE_SIZE_BYTES."""
    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        size_mb = len(image_bytes) / (1024 * 1024)
        limit_mb = MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image too large: {size_mb:.1f} MB exceeds the "
                f"{limit_mb:.0f} MB limit."
            ),
        )


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple sliding-window rate limiter per client IP."""

    def __init__(self, app: FastAPI, max_requests: int = RATE_LIMIT_MAX_REQUESTS,
                 window_seconds: int = RATE_LIMIT_WINDOW_SECONDS):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path == "/health":
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        cutoff = now - self.window_seconds

        self.requests[client_ip] = [
            t for t in self.requests[client_ip] if t > cutoff
        ]

        if len(self.requests[client_ip]) >= self.max_requests:
            logger.warning(
                f"Rate limit exceeded for {client_ip}: "
                f"{len(self.requests[client_ip])} requests in "
                f"{self.window_seconds}s window"
            )
            return Response(
                content='{"detail": "Too many requests. Please wait."}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(self.window_seconds)},
            )

        self.requests[client_ip].append(now)
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security headers to all responses."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


def add_security_middleware(app: FastAPI) -> None:
    """Add rate limiting and security headers to the app.

    Must be called BEFORE CORS middleware (middleware runs in reverse order).
    """
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RateLimitMiddleware)
    logger.info(
        f"Security middleware enabled: rate limit={RATE_LIMIT_MAX_REQUESTS} "
        f"req/{RATE_LIMIT_WINDOW_SECONDS}s, max image={MAX_IMAGE_SIZE_BYTES // (1024*1024)} MB"
    )
