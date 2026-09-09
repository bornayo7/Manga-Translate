# Backend implementation and validation

Verified on 2026-09-09. This implements the backend/tooling milestone in `OVERHAUL_PLAN.md` on the existing `thermo` branch. The backend remains a small HTTP composition surface, one runtime that owns execution, a bounded image decoder and two library adapters. No second service framework or global model singleton remains.

## Ownership and public behavior

- `server.py` validates HTTP input, composes middleware and maps stable outcomes to responses. `create_app(runtime)` supplies a narrow integration seam for tests.
- `OcrRuntime.paddle`, `manga` and `status` hide model construction, two-language Paddle LRU caching, worker serialization and bounded admission. Each engine owns one worker and at most four waiting requests. Cancellation retains the active worker's capacity until its actual concurrent future finishes. Runtime shutdown cancels queued work and drains active inference.
- `image_decoder.py` owns the compressed-byte, format, side-length and decoded-pixel limits. It validates headers before decompression and fully decodes before a model is constructed. It returns an owned RGB image and composites transparency on white.
- Paddle owns API-version constructor/result normalization and RGB-to-BGR conversion. Paddle3 document rotation/unwarping are explicitly disabled; a constructor that cannot preserve this invariant fails. Recognized regions require coherent text, confidence and geometry. Boxes are clamped to the submitted image.
- Manga owns clamping, white crop padding and aligned `recognized`, `empty`, `outside_image` or `failed` outcomes. Failures carry `error`; the HTTP response includes `failed_regions` and `warnings`. Failure of every attempted crop is HTTP 500. Shared clients may preserve Paddle text on a partial Manga result while surfacing its warning.

## Finding closure

| Finding | Implemented behavior | Regression evidence |
| --- | --- | --- |
| B-01 | PowerShell native failures throw; setup cannot print success after pip/npm failure; directory restoration is in `finally`. Bash uses strict failure handling and a build subshell. | `test_setup.py`: a real child exits 7; a controlled build failure restores the directory and omits success. |
| B-02 | Paddle3 document transforms disabled; original-image boxes bounded and fractional polygon edges enclosed. | Version/adapter tests; real shifted English and horizontal/vertical Japanese fixtures in both profiles. |
| B-03 | RGB decoder output becomes a contiguous BGR array at the Paddle boundary. Transparent pixels composite on white. | Exact red-pixel channel assertion; real colored English text in both profiles; transparent decoder test. |
| B-04 | Invalid/incomplete Paddle payloads fail; Manga empty/partial/fatal outcomes differ. | Malformed/missing scores/geometry/text tests; HTTP all-crop failure is 500; partial response retains aligned failure and warning. |
| B-05 | 10 MiB file, 16 million pixels, 16384-pixel side limit; intact PNG/JPEG/WebP required before model load. | Corrupt and over-budget inputs invoke no model factory. Existing HTTP body/base64/box limits remain covered. |
| B-06 | Worker admission is released by actual future completion, not an abandoned coroutine. Queued cancellation removes obsolete work. | Controlled cancellation during loading and inference keeps actual peak concurrency at one and rejects excess admission; a cancelled queued image never runs. |
| B-07 | All backend Docker examples publish `127.0.0.1:8000:8000`; image runs without root privileges. | Source/recipe inspection. Docker execution remains unverified because no Docker CLI is installed here. |

The B-06 regression directly cancels the requesting coroutine at the runtime boundary. It does **not** claim that browser disconnects were reproduced as a Uvicorn cancellation trigger. Native inference is not forcibly interrupted; it completes with its capacity still reserved.

## Reproducible dependency profiles

All profiles target Python 3.12. Core and optional dependency closures are pinned in `constraints/`; setup and Docker consume the same root requirements files. Core installation does not install OCR packages. OCR2 and OCR3 use separate virtual environments.

| Package | OCR2 profile | OCR3 profile |
| --- | --- | --- |
| PaddleOCR | 2.10.0 | 3.2.0 |
| PaddlePaddle | 2.6.2 | 3.2.2 |
| MangaOCR | 0.1.16 | 0.1.16 |
| PyTorch / torchvision | 2.7.1 / 0.22.1 | 2.7.1 / 0.22.1 |
| transformers | 4.51.3 | 4.51.3 |
| NumPy | 1.26.4 | 1.26.4 |
| FastAPI / uvicorn / Pillow | 0.141.1 / 0.52.4 / 12.3.0 | same |

The isolated validation uses Windows x64 CPU, Python 3.12.10. Installing a newer unconstrained PyTorch/transformers combination initially failed with `torch/lib/shm.dll` WinError 127. The coherent pins above passed real inference. Loading Paddle before PyTorch also reproduced that native import failure, including with the pinned PyTorch; the Windows adapter now imports installed PyTorch before Paddle. This changes library import order, not model loading policy.

`requirements-dev.txt` was installed from scratch in an isolated temporary environment. `pip check` found no broken requirements there or in either OCR profile. `pip install --dry-run -r requirements-ocr.txt` and the corresponding OCR3 command found the final pinned requirements satisfied in their respective environments. OCR environments were assembled and corrected during validation; they were not a second fresh install after every pin was finalized.

## Observed checks

- Deterministic suite in the fresh core environment: **76 passed, 8 explicitly skipped live-model tests**. Two upstream deprecation warnings: Starlette's httpx TestClient integration and AnyIO's old BlockingPortal alias. Core dependencies are pinned; the warnings are not counted as failures.
- Real OCR2 matrix: **8 passed**. Six Paddle cases cover English, colored English, Japanese horizontal/vertical, shifted coordinates and a blank image. Two Manga cases recognize Japanese horizontal/vertical crops.
- Real OCR3 matrix: **8 passed** for the same generated images and assertions.
- The fixtures are generated from owned text using local fonts. Japanese live fixtures require Meiryo/Noto CJK or an explicit `VT_OCR_JAPANESE_FONT`; missing fonts are visible skips. Both real runs here used available fonts and had no skips.
- Windows setup failure tests pass with local PowerShell. The complete setup installer was not rerun against the shared working repository while other implementation agents were building its JavaScript applications.
- Real-model and isolated install files are outside the repository. Local evidence logs are `%TEMP%/vision-core-install.log`, `%TEMP%/vision-ocr2-live-matrix.log`, and `%TEMP%/vision-ocr3-live-matrix.log`; these transient logs are not a portable artifact or committed dependency.

Run the deterministic suite with `python -m pip install -r requirements-dev.txt` followed by `python -m pytest -q` from `lensmu/backend`. Run each live profile with `VT_LIVE_OCR=1 python -m pytest -q -s test_paddle_ocr_live.py` after installing its requirements and pytest. The test file prints ASCII-safe JSON so Windows redirected console encoding cannot turn successful Japanese recognition into a logging failure.

## Remaining external validation and operating limits

Linux/macOS native OCR packages, GPU execution and Docker build/run have not been exercised locally. The optional Docker recipe is labeled accordingly. The backend intentionally has no authentication and documented host publication is loopback-only; remote access control is a separate deployment responsibility. Model packages and first-use weights require upstream availability. The real matrix proves these controlled English/Japanese examples, not general manga accuracy or every accepted language.

Per-process admission bounds do not cap all native-model allocations, and cache eviction does not guarantee immediate return of native memory to the OS. A single server process is the documented operating configuration. Health package discovery is not an inference readiness guarantee.

The parent task owns the repository-wide CI run, browser acceptance, root documentation, checkpoint commit/push, final branch integration and vault updates. This subtask makes no claim that those gates have already passed.

## Source basis

- [PaddleOCR3 OCR pipeline options](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md): document preprocessing and recognition options.
- [PaddleX3.2 OCR pipeline implementation](https://github.com/PaddlePaddle/PaddleX/blob/release/3.2/paddlex/inference/pipelines/ocr/pipeline.py): image processing and coordinate behavior.
- [PaddleOCR2.10 adapter implementation](https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.10/paddleocr.py): OpenCV/BGR ndarray input and legacy results.
- [Docker port publication](https://docs.docker.com/engine/network/port-publishing/): host interface selection and explicit loopback binding.
