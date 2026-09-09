# Backend and repository tooling audit

Read-only audit on thermo. No tracked repository files changed. No dependencies or OCR models downloaded. No live OCR or Docker validation. Exact fully reviewed repository-relative paths are in [coverage.json](coverage.json), reader group `backend` (24 files). The 10 backend Python files contain 2,388 lines. Also inspected backend main..thermo changes.

## Validation

Command from lensmu/backend: `python -m pytest -q -ra -p no:cacheprovider`, with VT_LIVE_OCR=0.

Result: 53 passed, 1 skipped, 1 warning in 0.86s. The skip is the opt-in real Paddle smoke. The warning is the Starlette TestClient httpx deprecation.

Environment: Python 3.12.10, FastAPI 0.141.1, Starlette 1.6.0, uvicorn 0.52.4, Pillow 12.3.0, numpy 2.5.2, pytest 8.4.2, httpx 0.28.1. PaddleOCR, PaddlePaddle, MangaOCR not installed. No repo virtual environment found at the explicitly checked standard paths.

## Findings

### B-01 [P2] Windows setup reports success after native command failures

Locations: setup.ps1:83-96, 123-136.

ErrorActionPreference Stop does not stop native commands for nonzero exits under the script's default configuration. Pip and npm exits are unchecked; npm ci output is discarded. Dependency/build failure can still print Setup Complete.

Safe process-only PowerShell repro set ErrorActionPreference=Stop, ran Python sys.exit(7), and then printed:

```
Native process exit=7
Control flow continues with ErrorActionPreference Stop
PSNativeCommandUseErrorActionPreference False
```

Remedy: checked native-command helper, try/finally directory restoration, authoritative shared requirements inputs for setup and Docker. Test exit propagation with fake commands without installing packages.

### B-02 [P2] PaddleOCR 3.x transforms geometry without mapping boxes back

Locations: lensmu/backend/ocr_engines/paddle_ocr.py:73-77, 340-345, 413-449.

Constructor settings omit use_doc_orientation_classify and use_doc_unwarping. Official 3.x docs say both default to True. PaddleX 3.2 detects and crops from doc_preprocessor_results output_img and creates rec_boxes from those polygons. This wrapper discards transformation metadata and returns coordinates unchanged, while overlays and MangaOCR use the original page.

Local fake with documented defaults printed:

```
Paddle3 document rotate/unwarp options = (True, True)
```

Geometry consequence is inferred from official implementation and the local adapter. No live-model transformed-page reproduction.

Remedy: disable geometry-changing preprocessing for the in-place overlay contract. Preserve useful textline orientation. Add constructor and geometry fixtures.

Official sources:
- https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md
- https://github.com/PaddlePaddle/PaddleX/blob/release/3.2/paddlex/inference/pipelines/ocr/pipeline.py
- Raw implementation inspected: https://raw.githubusercontent.com/PaddlePaddle/PaddleX/release/3.2/paddlex/inference/pipelines/ocr/pipeline.py (lines 310-327 detect preprocessed image, 363-365 crop it, 431-435 return derived boxes).

### B-03 [P2] Paddle receives RGB through its BGR ndarray interface

Location: lensmu/backend/ocr_engines/paddle_ocr.py:239-248.

PIL converts to RGB and np.array is passed unchanged. The comment claims Paddle handles conversion. Official PaddleOCR 2.10 check_img leaves a three-channel ndarray unchanged, while image file inputs are decoded with OpenCV. Local red image capture printed:

```
RGB red image first pixel sent to Paddle ndarray = [255, 0, 0]
```

BGR red is [0, 0, 255]. Interface mismatch is verified; real OCR accuracy impact was not measured.

Remedy: correct engine-specific color conversion and a colored image test through process_image.

Official source:
- https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.10/paddleocr.py
- Raw implementation inspected: https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.10/paddleocr.py (check_img lines 556-608; three-channel ndarray is unchanged).

### B-04 [P2] OCR model crashes become successful empty recognition

Locations: lensmu/backend/ocr_engines/manga_ocr.py:241-243; lensmu/backend/server.py:378-384. Related behavior in paddle_ocr.py:413-421.

Actual Manga wrapper with fake underlying model raising RuntimeError('engine crashed') returned:

```
all-region engine crash HTTP 200 {'detections': [{'text': '', 'bbox': [0, 0, 4, 4]}], 'count': 1, 'processing_time_ms': 1.0}
```

Client fallback retains Paddle text and conceals total failure of the selected Manga recognizer. Paddle normalization also maps an error payload to no detections:

```
unknown result shape -> []
```

The probe supplied [{'error':'OCR failed upstream'}] directly to _normalize_detections. No real provider error response was exercised.

Remedy: distinguish genuine empty recognition, invalid input, per-region failure, and fatal model failure. Preserve region alignment but surface all-region failure and partial warnings. No current tests exercise the Manga wrapper itself.

### B-05 [P2] Compressed-byte limits do not bound decoded pixel memory

Locations: lensmu/backend/security.py:18-29; server.py:320-326 and 359-368; conversions in both wrappers.

Safe valid PNG creation/header-only inspection showed:

```
bytes accepted= 23087 dimensions= (8000, 8000) pixels= 64000000 minimum RGB bytes= 192000000
```

validate_image_size accepts that PNG. Its dimensions are below Pillow's default decompression warning threshold; RGB conversion and numpy copies substantially expand memory. The probe did not convert the large image to RGB or run inference.

Invalid images also reach model construction before image decoding and can trigger a first-time model load/download before failing.

Remedy: validate format/dimensions and a decoded pixel budget before model initialization; centralize bounded image decoding.

### B-06 [P2, lifecycle limitation] Coroutine cancellation releases inference capacity too early

Locations: lensmu/backend/server.py:324-326 and 363-368.

Cancelling the coroutine awaiting asyncio.to_thread releases the semaphore without stopping its worker thread. A next request can concurrently enter the same model. Deterministic direct route-coroutine probe used threading Events and fake inference, cancelled the first task, then started a second task:

```
after request cancellation: worker active= 1 semaphore unlocked= True
peak concurrent inference calls= 2
```

This is precisely a direct coroutine-cancellation reproduction. Ordinary Uvicorn browser disconnect behavior was not reproduced and must not be claimed as the demonstrated trigger.

Remedy: one runtime owns admission, worker completion and cancellation. Release capacity only when actual worker activity ends. Bound queued requests too.

### B-07 [P2] Documented Docker launch publishes unauthenticated local OCR broadly

Locations: README.md:182; lensmu/backend/README.md:241; lensmu/backend/Dockerfile:11 and 21.

The documented launch uses -p 8000:8000 and the container listens on 0.0.0.0. Docker's default publishes unspecified host addresses on all interfaces. Routes have no authentication; CORS does not authenticate non-browser clients.

Remedy: use -p 127.0.0.1:8000:8000 for normal local installation while retaining the container's internal 0.0.0.0 listener. External hosting is a separate explicit deployment profile. No live Docker launch or host firewall probe was performed.

Official source: https://docs.docker.com/engine/network/port-publishing/

## Pipeline and structural assessment

HTTP middleware order is CORS, security headers, per-IP rate limiting, body limit, FastAPI request parsing. The body limit checks Content-Length and streamed bytes before JSON parsing. FastAPI models validate request shape; Manga additionally validates integer boxes/count/coordinate range/aggregate area. Endpoint checks provider availability, normalizes Paddle language, base64-decodes and checks compressed byte size. Each endpoint then takes a provider-specific asyncio semaphore and dispatches model loading and processing with separate to_thread calls. Wrappers manage process-global model caches and image decoding. Paddle normalizes provider results and sorts by reading order; Manga crops/clamps/pads regions and currently flattens per-region errors. Endpoints construct response models. Health reads model status off the event loop without initiating load.

Backend does not need a many-layer rewrite. Primary weakness is split ownership: routes own semaphore/thread dispatch; wrappers own singletons/cache; wrappers separately own image decode/error policy. Tests often patch globals or inspect internal cache/constructor helpers. Existing health-loading behavior on thermo is useful and verified; preserve it.

## Bounded phases

1. Repair pixel color and geometry contracts; add colored-image and transformed-page fixtures.
2. Introduce one deep OCR execution module with a small interface such as paddle(...), manga(...), status(). It owns model loading/cache, bounded admission, worker lifetime, truthful outcomes. Concrete library adapters and deterministic fake adapters justify the internal seam. Keep HTTP routes thin.
3. Centralize bounded image decoding before model loading. Preserve bbox count/area limits and region alignment.
4. Add Manga wrapper behavior, partial/fatal failure, cancellation and concurrent-load tests through the runtime interface. Replace obsolete private-state tests once interface coverage exists.
5. Lock compatible core and OCR installation profiles; make setup/CI/Docker consume them. Current core requirements are open-ended and current TestClient warns. Current tests pass; no dependency installation failure was reproduced.
6. Exercise a real-model matrix for every OCR generation explicitly advertised: English, colored text, Japanese vertical text, geometry-sensitive samples. Current opt-in real smoke is a single English Paddle case; no Manga smoke exists.

Keep endpoint contracts compatible unless versioned. No model/live Docker validation was performed. Repros were fed inline to short-lived Python/PowerShell processes through tools; there are no separate saved repro script paths. This report preserves their exact observed output, stimuli and limitations. Only this temporary report and the temporary reviewed-path JSON were created after the read-only investigation.
