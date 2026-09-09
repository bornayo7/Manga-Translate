# Build: docker build --build-arg OCR_PROFILE=ocr2 -t lensmu-backend .
# Run: docker run --rm -p 127.0.0.1:8000:8000 lensmu-backend
FROM python:3.12-slim

ENV VISIONTRANSLATE_HOST=0.0.0.0 PYTHONUNBUFFERED=1
ARG OCR_PROFILE=core
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements*.txt ./
COPY constraints/ constraints/
RUN case "$OCR_PROFILE" in \
      core) requirements=requirements.txt ;; \
      ocr2) requirements=requirements-ocr.txt ;; \
      ocr3) requirements=requirements-ocr3.txt ;; \
      *) echo "Unknown OCR_PROFILE: $OCR_PROFILE" >&2; exit 2 ;; \
    esac \
    && pip install --no-cache-dir -r "$requirements" \
    && pip check

COPY server.py security.py image_decoder.py ocr_runtime.py ./
COPY ocr_engines/ ocr_engines/
RUN useradd --create-home --uid 10001 lensmu
USER lensmu
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["python", "server.py"]
