# VisionTranslate Backend

Local OCR server for the VisionTranslate (lensmu) browser extension. Runs PaddleOCR and MangaOCR as HTTP API endpoints so the browser extension can send images and receive recognized text.

All processing happens locally on your machine -- no data is sent to external servers.

## Requirements

- **Python 3.10 to 3.12.** The server uses 3.10+ syntax, and PaddlePaddle / manga-ocr do not yet support 3.13+.
- ~2 GB of free disk space (for OCR models downloaded on first use)
- ~2 GB of RAM during inference

## Quick Start

### 1. Create a virtual environment

```bash
cd lensmu/backend

# Create a virtual environment named "venv"
python3 -m venv venv

# Activate it (macOS / Linux)
source venv/bin/activate

# Activate it (Windows PowerShell)
# .\venv\Scripts\Activate.ps1

# Activate it (Windows CMD)
# venv\Scripts\activate.bat
```

### 2. Install dependencies

```bash
# Core server: FastAPI, uvicorn, Pillow, numpy
pip install -r requirements.txt
```

The server starts without any OCR engine installed; the OCR routes then answer `501` and `/health` reports what is missing. To enable the engines, install PaddlePaddle for your platform and then the OCR packages (see `requirements-ocr.txt` for the per-platform notes):

```bash
# macOS (Apple Silicon / Intel)
pip install paddlepaddle==2.6.2 -f https://www.paddlepaddle.org.cn/whl/mac/cpu/paddlepaddle.html

# Linux / Windows (CPU)
pip install paddlepaddle==2.6.2

# Then the engines themselves (PaddleOCR 2.x, the line that runs on PaddlePaddle 2.6.2)
pip install -r requirements-ocr.txt
```

`ocr_engines/paddle_ocr.py` adapts to both PaddleOCR API generations: the 2.x
`**kwargs` constructor (2.7–2.10: `use_angle_cls`, `det_db_thresh`,
`det_db_unclip_ratio`, `use_gpu`, `show_log`) and the 3.x explicit-keyword
constructor (`use_textline_orientation`, `text_det_thresh`,
`text_det_unclip_ratio`). `requirements-ocr.txt` pins the 2.x line because it is
what `paddlepaddle==2.6.2` runs; to use 3.x install `paddlepaddle>=3.0` and
`paddleocr>=3.0` together. The adapter's behaviour for both signatures is
covered by `test_paddle_versions.py`; a real-model smoke test is opt-in
(`VT_LIVE_OCR=1 pytest test_paddle_ocr_live.py`) because it downloads models.

The first PaddleOCR request downloads ~100 MB of models; the first MangaOCR request downloads a ~400 MB model. Both are cached afterwards.

### 3. Start the server

```bash
python server.py
```

The server listens on **http://127.0.0.1:8000** (loopback only). Set `VISIONTRANSLATE_HOST=0.0.0.0` to accept connections from other machines, which the Docker image does.

Interactive API documentation is available at **http://localhost:8000/docs** (Swagger UI).

### 4. Verify it is running

```bash
curl http://localhost:8000/health
```

Expected response on a fresh install with no engines:

```json
{
  "status": "ok",
  "paddle_ocr_available": false,
  "paddle_ocr_loaded": false,
  "paddle_ocr_loading": false,
  "manga_ocr_available": false,
  "manga_ocr_loaded": false,
  "manga_ocr_loading": false,
  "manga_full_available": false,
  "paddle_loaded_languages": [],
  "paddle_loading_languages": []
}
```

`*_available` says whether a package is importable; `*_loading` is true while a model is being constructed (the first request for a language takes 5–15 s); `*_loaded` flips to `true` once that finishes. Models are lazy-loaded to keep startup fast, and `/health` never triggers a load or waits for one: it answers within milliseconds even while a model is loading. `manga_full_available` is true only when both engines are installed, because the MangaOCR flow needs PaddleOCR for detection.

## API Endpoints

### GET /health

Check that the server is running and which engines are installed and loaded. This route is exempt from rate limiting.

```bash
curl http://localhost:8000/health
```

### POST /ocr/paddle

Detect and recognize text with PaddleOCR. Returns bounding boxes, recognized text, confidence scores, and text orientation.

```bash
# Encode an image to base64 and send it
BASE64_IMAGE=$(base64 -i test_image.png)

curl -X POST http://localhost:8000/ocr/paddle \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$BASE64_IMAGE\", \"lang\": \"japan\"}"
```

**Request body:**

```json
{
  "image": "<base64-encoded image string>",
  "lang": "japan"
}
```

- `image` may be raw base64 or a `data:image/...;base64,` data URL.
- `lang` selects the recognition model. Supported values: `ch`, `chinese_cht`, `de`, `en`, `es`, `fr`, `japan`, `korean`. The aliases `auto`, `ja`, `jp` map to `japan`, `zh`/`zh-cn` to `ch`, `zh-tw` to `chinese_cht`, and `ko` to `korean`. Anything else is rejected with `422`. Defaults to `japan`.
- The server keeps at most two language models loaded at once and evicts the least recently used.

**Response:**

```json
{
  "detections": [
    {
      "text": "detected text here",
      "bbox": [100, 50, 300, 90],
      "confidence": 0.95,
      "orientation": "horizontal"
    }
  ],
  "count": 1,
  "processing_time_ms": 245.3
}
```

- `bbox` is `[x1, y1, x2, y2]` where (x1,y1) is top-left and (x2,y2) is bottom-right, in pixels of the image you sent.
- `orientation` is `"horizontal"` or `"vertical"`.
- Detections are sorted top-to-bottom, then left-to-right.
- First request takes 5-15 seconds (model loading). Subsequent requests take under 2 seconds.

### POST /ocr/manga

Recognize Japanese manga text using MangaOCR. Send the same image plus bounding boxes from `/ocr/paddle`; MangaOCR only recognizes text, it cannot find it.

```bash
curl -X POST http://localhost:8000/ocr/manga \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$BASE64_IMAGE\", \"bboxes\": [[100, 50, 300, 90], [150, 100, 200, 250]]}"
```

**Request body:**

```json
{
  "image": "<base64-encoded image string>",
  "bboxes": [
    [100, 50, 300, 90],
    [150, 100, 200, 250]
  ]
}
```

Validation: 1 to 200 boxes, integer coordinates between 0 and 100000 with `x2 > x1` and `y2 > y1`, and at most 50 million pixels of total box area. Any violation rejects the whole request with `422`. Clients with more regions than that send several requests: the extension and the website demo split PaddleOCR's detections into compliant batches (`extension/shared/ocr-responses.js`) and merge the answers back by detection index, keeping PaddleOCR's own text for any region MangaOCR returns empty.

**Response:**

```json
{
  "detections": [
    {
      "text": "recognized Japanese text",
      "bbox": [100, 50, 300, 90]
    },
    {
      "text": "more text",
      "bbox": [150, 100, 200, 250]
    }
  ],
  "count": 2,
  "processing_time_ms": 523.1
}
```

- The order matches the input `bboxes`. A region that fails to process comes back with an empty `text` so the indices stay aligned.
- Boxes are clamped to the image bounds, so the returned `bbox` may be smaller than the one you sent.
- First request takes 10-30 seconds (model download + loading). Subsequent requests take 0.5-3 seconds.

### Limits and errors

- Images larger than 10 MB (decoded) are rejected with `413`; request bodies over 15 MB are rejected before parsing.
- Each client IP gets 60 requests per minute (excluding `/health`); over that the server answers `429` with a `Retry-After` header.
- `400` means the image could not be decoded, `422` means the request failed validation, `501` means the engine for that route is not installed, and `500` means the engine itself failed.

## Typical Workflow

The browser extension uses these endpoints in sequence:

1. The extension extracts an image from the page as base64.
2. It sends the image to `POST /ocr/paddle` (for MangaOCR it forces `lang: "japan"` for this detection pass).
3. PaddleOCR returns bounding boxes showing where text is.
4. With MangaOCR selected, the extension sends the same image plus those boxes to `POST /ocr/manga`.
5. MangaOCR returns accurate Japanese text for each region.
6. The extension translates the text and overlays it on the page.

## Development

To run with auto-reload (restarts the server when you edit code):

```bash
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```

Run the test suite (it does not need the OCR packages installed):

```bash
pip install -r requirements-dev.txt
pytest -v
```

## Docker

```bash
docker build -t visiontranslate-backend .
docker run -p 8000:8000 visiontranslate-backend

# With the OCR engines baked in (much larger image):
docker build --build-arg INSTALL_OCR=true -t visiontranslate-backend .
```

The image sets `VISIONTRANSLATE_HOST=0.0.0.0` so the published port is reachable from the host.

## Troubleshooting

### PaddlePaddle installation fails

PaddlePaddle can be finicky to install. Try these steps:

```bash
# Make sure pip is up to date
pip install --upgrade pip

# Install PaddlePaddle CPU version explicitly
pip install paddlepaddle==2.6.2 -i https://mirror.baidu.com/pypi/simple

# If that fails, try the official pip source
pip install paddlepaddle==2.6.2
```

On Apple Silicon (M1/M2/M3) Macs, you may need:

```bash
# PaddlePaddle may not have native ARM wheels; use Rosetta or conda
# Option 1: Install via conda
conda install paddlepaddle -c paddle

# Option 2: Use a x86 Python via Rosetta
arch -x86_64 python3 -m pip install paddlepaddle
```

If PaddlePaddle refuses to install at all, use Tesseract.js (in-browser) or Google Cloud Vision from the extension settings instead; neither needs this server.

### GPU acceleration

To use an NVIDIA GPU for faster inference:

1. Install CUDA 11.8 or 12.x and cuDNN.
2. Install `paddlepaddle-gpu` instead of `paddlepaddle` (same version), then `pip install -r requirements-ocr.txt`.
3. The wrapper in `ocr_engines/paddle_ocr.py` passes `use_gpu=False` only when the installed PaddleOCR is a 2.x release that accepts that argument; change it there to enable the GPU on 2.x. PaddleOCR 3.x selects the device itself.

### MangaOCR model download hangs

MangaOCR downloads a ~400 MB model from HuggingFace on first use. If the download stalls:

- Check your internet connection.
- Try setting a HuggingFace mirror:
  ```bash
  export HF_ENDPOINT=https://hf-mirror.com
  python server.py
  ```
- Or download the model manually:
  ```bash
  pip install huggingface_hub
  python -c "from huggingface_hub import snapshot_download; snapshot_download('kha-white/manga-ocr-base')"
  ```

### CORS errors in the browser console

If the extension gets CORS errors, make sure:

1. The server is running (`curl http://localhost:8000/health`).
2. The extension's origin is allowed. Check `server.py` -- the CORS middleware allows `chrome-extension://*` and `moz-extension://*` origins by default.
3. If testing from a web page (not the extension), make sure the page's origin is in the `allow_origins` list in `server.py`. The website dev server on `localhost:3000` is already listed.

### Server runs out of memory

Both OCR models together use about 2 GB of RAM. If you are low on memory:

- Close other applications.
- Use only one OCR endpoint at a time (the unused model will not load).
- Stick to one PaddleOCR language; every extra language keeps another model in memory (two are cached at most).

### Port 8000 is already in use

Run on another port:

```bash
uvicorn server:app --host 127.0.0.1 --port 9000
```

Then update the backend URL in the extension popup (Engines tab) to point at the new port.
