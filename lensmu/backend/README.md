# VisionTranslate OCR backend

Local FastAPI service for the lensmu extension and website demo. PaddleOCR detects text and coordinates; MangaOCR recognizes Japanese crops. Images are processed locally. Installing packages and loading a model for the first time downloads dependencies and model weights from their upstream hosts.

## Install and start

The pinned release profiles use **Python 3.12**. Use a separate virtual environment for each profile; do not install OCR2 and OCR3 into the same environment.

| Profile | Install file | Engines |
| --- | --- | --- |
| Core | `requirements.txt` | HTTP service only; OCR routes return 501 |
| OCR2 | `requirements-ocr.txt` | PaddleOCR 2.10.0 / PaddlePaddle 2.6.2; MangaOCR 0.1.16 |
| OCR3 | `requirements-ocr3.txt` | PaddleOCR 3.2.0 / PaddlePaddle 3.2.2; MangaOCR 0.1.16 |

Both OCR profiles pin PyTorch 2.7.1, torchvision 0.22.1, transformers 4.51.3 and NumPy 1.26.4. Requirements include checked-in dependency constraints and the official PyTorch CPU wheel index. The real-model matrix passed on Windows x64 CPU with Python 3.12.10 for both profiles. Linux/macOS native OCR installation and GPU operation have not been validated for this release.

From the repository root, the setup scripts install the selected backend profile and build the extension. They require Python 3.12, Node.js 20.19 or newer, and npm already installed. A failed native command stops setup and reports failure.

```powershell
# Windows; default profile is ocr2
.\setup.ps1 -Profile ocr2
```

```bash
# macOS/Linux; choose a profile whose native wheels support your platform
./setup.sh core
```

For the backend alone:

```powershell
cd lensmu/backend
py -3.12 -m venv venv
.\venv\Scripts\python -m pip install -r requirements-ocr.txt
.\venv\Scripts\python -m pip check
.\venv\Scripts\python server.py
```

On macOS/Linux, use `python3.12 -m venv venv` and `venv/bin/python` in the corresponding commands. Use `requirements-ocr3.txt` for OCR3 or `requirements.txt` for core.

The server binds to `http://127.0.0.1:8000`. Open `/docs` for the request schema or `/health` for engine status. Model download and inference time depend on your hardware and connection. Keep the first request open while the models load; later requests reuse the loaded models.

## API contracts

### GET /health

Returns `status: "ok"` and these fields:

- `paddle_ocr_available`, `manga_ocr_available`: required package names were found. Discovery does not prove native imports, downloads or inference will succeed.
- `paddle_ocr_loaded`, `manga_ocr_loaded`: the runtime holds at least one model for that engine.
- `paddle_ocr_loading`, `manga_ocr_loading`: model construction is in progress.
- `paddle_loaded_languages`, `paddle_loading_languages`: Paddle language keys in the cache or being constructed.
- `manga_full_available`: both engine package sets were found, since the complete manga flow needs Paddle detection.

Health inspection does not import OCR libraries, download models, or wait for inference. The route is exempt from rate limiting.

### POST /ocr/paddle

```json
{"image": "<base64 PNG/JPEG/WebP or data URL>", "lang": "japan"}
```

Supported language keys are `ch`, `chinese_cht`, `de`, `en`, `es`, `fr`, `japan`, and `korean`. Aliases: `auto`/`ja`/`jp` become `japan`, `zh`/`zh-cn` become `ch`, `zh-tw` becomes `chinese_cht`, and `ko` becomes `korean`. Unknown languages return 422. English and Japanese are covered by the real-model matrix; other accepted model languages have not been individually exercised in this release.

```json
{
  "detections": [{"text": "HELLO", "bbox": [100, 50, 300, 90], "confidence": 0.95, "orientation": "horizontal"}],
  "count": 1,
  "processing_time_ms": 245.3
}
```

Boxes are integer `[x1, y1, x2, y2]` coordinates in the supplied image. They are clamped to its dimensions and sorted top-to-bottom, then left-to-right. Degenerate boxes are omitted. `orientation` is a horizontal/vertical shape heuristic. The adapter converts RGB to Paddle's BGR ndarray input and disables Paddle3 document rotation/unwarping so returned coordinates stay in the original image space. Valid no-text results return an empty detection list; a malformed provider response fails explicitly.

### POST /ocr/manga

Send the same image and the boxes obtained from Paddle:

```json
{"image": "<base64 image>", "bboxes": [[100, 50, 300, 90], [150, 100, 200, 250]]}
```

Requests accept 1–200 boxes, integer coordinates from 0 to 100000, positive width/height, and at most 50 million pixels of aggregate box area. Invalid requests return 422. Shared client code batches larger inputs and restores the original detection indices.

```json
{
  "detections": [
    {"text": "こんにちは", "bbox": [100, 50, 300, 90], "status": "recognized"},
    {"text": "", "bbox": [150, 100, 200, 250], "status": "failed", "error": "MangaOCR could not recognize this region."}
  ],
  "count": 2,
  "failed_regions": [1],
  "warnings": ["MangaOCR failed to recognize 1 region(s)."],
  "processing_time_ms": 523.1
}
```

Every returned detection retains its input index. Boxes are clamped before cropping. A successful nonempty recognition has status `recognized`; a successful empty recognition has `empty`; an out-of-image crop has `outside_image`; a model exception has `failed` and a nonempty `error`. The response includes failed indices and warnings. If every attempted inference fails, the entire request returns 500. A failed region is never presented as successful empty recognition.

### Bounds, execution and errors

- Request bodies: 15 MiB maximum. Base64-decoded image files: 10 MiB maximum.
- Decoded images: at most 16,000,000 pixels and 16,384 pixels on either side. PNG, JPEG and WebP only. Invalid or oversized images are rejected before model construction and pixel dimensions are checked before decompression. Transparency is composited on white.
- Each engine runs one actual worker with at most four queued requests. Paddle keeps at most two language models using least-recently-used eviction; Manga keeps one model.
- Cancelling a caller does not free a running worker's capacity. A queued cancelled request can be removed without loading or executing its image. Shutdown cancels queued work and waits for active inference.
- Each client IP may make 60 requests per minute, excluding `/health`. Rate limiting and a full engine queue return 429 with `Retry-After`.
- 400: invalid base64/image. 413: size or pixel limit. 422: invalid request/language/boxes. 500: engine load/inference or provider-contract failure. 501: engine dependencies absent. 503: runtime shutting down.

Run one server process for these per-process cache and concurrency bounds. Pixel and admission limits bound application input; OCR libraries still allocate their own model/native memory, and releasing a cached model does not guarantee immediate return of all memory to the OS.

## Development and verification

```bash
python -m pip install -r requirements-dev.txt
python -m pip check
python -m pytest -q
```

The default tests require no OCR packages or model downloads. They exercise HTTP contracts, image admission, cancellation while loading and inferring, cache/status behavior, error outcomes, color and geometry, plus PowerShell setup failures when `pwsh` is installed.

The opt-in matrix performs actual model downloads and inference. Run it in either OCR profile after installing `pytest==8.4.2`:

```powershell
$env:VT_LIVE_OCR = '1'
python -m pytest -q -s test_paddle_ocr_live.py
```

```bash
VT_LIVE_OCR=1 python -m pytest -q -s test_paddle_ocr_live.py
```

The eight cases cover English, colored text, Japanese horizontal/vertical text, shifted geometry, blank input and both Manga crop orientations. Fixtures are generated locally; no external manga page is copied into the tests. A missing fixture font produces an explicit skip. Set `VT_OCR_JAPANESE_FONT` to a local CJK font when the system has neither Meiryo nor Noto Sans CJK. The [implementation record](../../docs/backend-implementation.md) contains the observed versions, test results and remaining platform gaps.

## Docker recipe

Docker is an optional, currently unverified installation recipe: Docker was not available in the implementation environment. The image defaults to the core profile, runs as a non-root user and installs the same pinned files as local setup.

```bash
docker build -t lensmu-backend .
docker run --rm -p 127.0.0.1:8000:8000 lensmu-backend

# Include one OCR profile instead of core:
docker build --build-arg OCR_PROFILE=ocr2 -t lensmu-backend .
# OCR_PROFILE=ocr3 selects the other profile.
```

The image listens on `0.0.0.0` inside the container; the explicit host loopback publication above keeps the HTTP service local. The backend has no authentication. Do not expose it to other machines without an independently configured access-control layer. Docker documents [host port publication and loopback binding](https://docs.docker.com/engine/network/port-publishing/).

## Troubleshooting

- **Missing engine (501):** install the complete selected OCR profile in the Python environment running the server, then run `python -m pip check`.
- **Native-library import failure (500):** use a fresh Python 3.12 environment with one pinned profile. On Windows, the Paddle adapter loads PyTorch first when installed; the inverse order failed with `torch/lib/shm.dll` in the tested profiles. Avoid mixing separately upgraded native packages.
- **Model download failure:** inspect the server log and check connectivity to the upstream model hosts. `/health` package availability alone does not verify a downloaded model.
- **Browser CORS failure:** supported local web origins use `localhost` or `127.0.0.1` on ports 3000, 5173 and 8080 (and the default HTTP port); Chrome/Firefox extension schemes are also allowed. CORS does not authenticate callers.
- **Out of memory:** resize large images, reduce simultaneous jobs and use fewer Paddle languages. Restarting the process releases its model resources. No fixed RAM requirement or inference-time guarantee is asserted.
- **Port conflict:** run `python -m uvicorn server:app --host 127.0.0.1 --port 9000`, then update the backend URL in the client.
