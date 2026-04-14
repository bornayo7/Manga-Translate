# =============================================================================
# VisionTranslate — Backend Dockerfile
# =============================================================================
#
# Containerizes the FastAPI OCR backend for easy setup and deployment.
#
# BUILD:
#   docker build -t visiontranslate-backend .
#
# RUN:
#   docker run -p 8000:8000 visiontranslate-backend
#
# RUN WITH OCR ENGINES (requires more disk space and build time):
#   docker build --build-arg INSTALL_OCR=true -t visiontranslate-backend .
#
# The server will be available at http://localhost:8000
# =============================================================================

FROM python:3.11-slim

# Build argument: set to "true" to install PaddleOCR and MangaOCR
ARG INSTALL_OCR=false

WORKDIR /app

# Install system dependencies needed by image processing libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Conditionally install OCR engine dependencies
COPY requirements-ocr.txt .
RUN if [ "$INSTALL_OCR" = "true" ]; then \
        pip install --no-cache-dir paddlepaddle==2.6.2 && \
        pip install --no-cache-dir -r requirements-ocr.txt; \
    fi

# Copy application code
COPY . .

# Expose the default port
EXPOSE 8000

# Health check — verify the server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run the server
CMD ["python", "server.py"]
