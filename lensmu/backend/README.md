# VisionTranslate Backend

Local OCR server for the VisionTranslate (lensmu) browser extension. Runs PaddleOCR and MangaOCR as HTTP API endpoints so the browser extension can send screenshots and receive recognized text.

All processing happens locally on your machine -- no data is sent to external servers.

## Requirements

- **Python 3.10 or higher** (tested with 3.10, 3.11, 3.12)
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
pip install -r requirements.txt
```

This installs FastAPI, PaddleOCR, MangaOCR, and all supporting libraries. The install may take a few minutes due to PaddlePaddle's size.

### 3. Start the server

```bash
python server.py
```

The server starts at **http://localhost:8000**.

Interactive API documentation is available at **http://localhost:8000/docs** (Swagger UI).

### 4. Verify it is running

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{
  "status": "ok",
  "paddle_ocr_loaded": false,
  "manga_ocr_loaded": false
}
```

The models show `false` until their first use (they are lazy-loaded to keep startup fast).

## API Endpoints

### GET /health

Check if the server is running and which models are loaded.

```bash
curl http://localhost:8000/health
```

### POST /ocr/paddle

Detect text regions in an image using PaddleOCR. Returns bounding boxes, recognized text, confidence scores, and text orientation.

```bash
# Encode an image to base64 and send it
BASE64_IMAGE=$(base64 -i test_image.png)

curl -X POST http://localhost:8000/ocr/paddle \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$BASE64_IMAGE\"}"
```

**Request body:**

```json
{
  "image": "<base64-encoded image string>"
}
```

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

- `bbox` is `[x1, y1, x2, y2]` where (x1,y1) is top-left and (x2,y2) is bottom-right, in pixels.
- `orientation` is `"horizontal"` or `"vertical"`.
- First request takes 5-15 seconds (model loading). Subsequent requests take under 2 seconds.

### POST /ocr/manga

Recognize Japanese manga text using MangaOCR. Send the same image plus bounding boxes from PaddleOCR.

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

- First request takes 10-30 seconds (model download + loading). Subsequent requests take 0.5-3 seconds.

## Typical Workflow

The browser extension uses these endpoints in sequence:

1. User screenshots a region of a manga page.
2. Extension sends the screenshot to `POST /ocr/paddle`.
3. PaddleOCR returns bounding boxes showing where text is.
4. Extension sends the same screenshot + bounding boxes to `POST /ocr/manga`.
5. MangaOCR returns accurate Japanese text for each region.
6. Extension translates the text and overlays it on the page.

## Development

To run with auto-reload (restarts the server when you edit code):

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

## Troubleshooting

### PaddlePaddle installation fails

PaddlePaddle can be finicky to install. Try these steps:

```bash
# Make sure pip is up to date
pip install --upgrade pip

# Install PaddlePaddle CPU version explicitly
pip install paddlepaddle -i https://mirror.baidu.com/pypi/simple

# If that fails, try the official pip source
pip install paddlepaddle
```

On Apple Silicon (M1/M2/M3) Macs, you may need:

```bash
# PaddlePaddle may not have native ARM wheels; use Rosetta or conda
# Option 1: Install via conda
conda install paddlepaddle -c paddle

# Option 2: Use a x86 Python via Rosetta
arch -x86_64 python3 -m pip install paddlepaddle
```

### GPU acceleration

To use NVIDIA GPU for faster inference:

1. Install CUDA 11.8 or 12.x and cuDNN.
2. Replace `paddlepaddle` with `paddlepaddle-gpu` in requirements.txt:
   ```
   paddlepaddle-gpu>=2.5.0
   ```
3. Reinstall: `pip install -r requirements.txt`
4. Edit `ocr_engines/paddle_ocr.py` and set `use_gpu=True` in the PaddleOCR constructor.

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
3. If testing from a web page (not the extension), make sure the page's origin is in the `allow_origins` list in `server.py`.

### Server runs out of memory

Both OCR models together use about 2 GB of RAM. If you are low on memory:

- Close other applications.
- Use only one OCR endpoint at a time (the unused model will not load).
- Reduce image size before sending to the API (the extension should resize large screenshots).

### Port 8000 is already in use

Change the port in `server.py` at the bottom (the `uvicorn.run()` call) or run with:

```bash
uvicorn server:app --host 0.0.0.0 --port 9000
```

Make sure to update the extension's configuration to point to the new port.
