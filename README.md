```
 __      __ _       _            _____                        _         _
 \ \    / /(_)     (_)          |_   _|                      | |       | |
  \ \  / /  _  ___  _   ___   _ | |  _ __  __ _  _ __   ___ | |  __ _ | |_  ___
   \ \/ /  | |/ __|| | / _ \ | \| | | '__|/ _` || '_ \ / __|| | / _` || __|/ _ \
    \  /   | |\__ \| || (_) || .  | | |  | (_| || | | |\__ \| || (_| || |_|  __/
     \/    |_||___/|_| \___/ |_|\_| |_|   \__,_||_| |_||___/|_| \__,_| \__|\___|

                    VisionTranslate -- see it, read it, understand it
```

# VisionTranslate

> **See it. Read it. Understand it.**

A browser extension built at **HackSMU VII** that translates text inside images on any web page — manga, street signs, menus, screenshots — in real time, without leaving your browser.

VisionTranslate uses OCR (Optical Character Recognition) to extract text from images, sends that text to a translation service, and overlays the translated text right on top of the original image — matching position, size, and background color.

**Example use cases:**

- Reading Japanese manga that hasn't been officially translated
- Understanding foreign-language street signs in Google Street View
- Browsing a restaurant menu photographed in another language
- Reading screenshots or infographics posted in a language you don't speak


## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Extension** | JavaScript, React, Vite, Tesseract.js, Shadow DOM |
| **Backend** | Python, FastAPI, PaddleOCR, MangaOCR |
| **OCR Engines** | PaddleOCR (80+ languages), MangaOCR (Japanese), Tesseract.js (in-browser), Google Cloud Vision |
| **Translation** | Google Translate, Gemini, OpenAI, Claude, LibreTranslate |


## How It Works (Architecture)

```
+--------------------------------------------------+
|                    YOUR BROWSER                   |
|                                                   |
|   +--------------------+   +------------------+   |
|   |   Extension Popup  |   |   Content Script |   |
|   |   (React UI)       |   |   (overlay.js)   |   |
|   |                    |   |                  |   |
|   |  - Settings panel  |   |  - Scans <img>  |   |
|   |  - Engine picker   |   |  - Draws overlay |   |
|   |  - Translate btn   |   |  - Shows results |   |
|   +--------+-----------+   +--------+---------+   |
|            |                        |              |
+------------|------------------------|--------------|
             |  chrome.runtime API    |  HTTP POST   |
             +----------+-------------+              |
                        |                            |
                        v                            |
            +-----------+-----------+                |
            |   Background Script   |                |
            |   (Service Worker)    | <--------------+
            |                       |
            |   - Routes messages   |
            |   - Manages state     |
            +-----------+-----------+
                        |
                        | HTTP requests
                        v
            +-----------+-----------+
            |    Python Backend     |
            |    (FastAPI server)   |
            |                       |
            |  /ocr/paddle:         |
            |    - PaddleOCR        |
            |  /ocr/manga:          |
            |    - MangaOCR         |
            +-----------------------+
               runs on localhost:8000
```

**Data flow when you click "Translate This Page":**

1. The popup sends a message to the background script: "translate this tab."
2. The background script tells the content script (injected in the page) to start scanning.
3. The content script finds all `<img>` elements, extracts each image as a base64-encoded string, and sends it to the OCR engine.
4. The OCR engine (PaddleOCR, MangaOCR, Tesseract.js, or Cloud Vision) returns bounding boxes + recognized text.
5. The content script sends the recognized text to the translation module (Google Translate, Gemini, OpenAI, Claude, or LibreTranslate).
6. The translation module returns the translated text.
7. The content script renders translated text overlays on top of each image using absolutely-positioned `<div>` elements inside a Shadow DOM (so the host page's CSS doesn't interfere).
8. Hovering over a translated block shows the original text in a tooltip.

**Note on Tesseract.js:** The extension also bundles Tesseract.js, which runs OCR entirely in the browser (no backend needed). This is useful for quick translations but is generally less accurate than PaddleOCR for non-Latin scripts.


## Prerequisites

| Requirement       | Minimum Version | How to Check          | Install Guide                          |
|-------------------|-----------------|-----------------------|----------------------------------------|
| Python            | 3.8+            | `python3 --version`   | https://www.python.org/downloads/      |
| pip               | 21.0+           | `pip3 --version`      | Comes with Python                      |
| Node.js           | 18.0+           | `node --version`      | https://nodejs.org/                    |
| npm               | 9.0+            | `npm --version`       | Comes with Node.js                     |
| Chrome or Firefox | Latest          | Check browser version | https://www.google.com/chrome/         |
| Git               | Any             | `git --version`       | https://git-scm.com/                   |

**Operating system notes:**

- **macOS:** Install Python via Homebrew (`brew install python3`) or from python.org. Node.js via Homebrew (`brew install node`) or nvm.
- **Linux (Ubuntu/Debian):** `sudo apt update && sudo apt install python3 python3-pip python3-venv nodejs npm`
- **Windows:** Download installers from python.org and nodejs.org. Use PowerShell or WSL for the terminal commands below.


## Setup: Python Backend

The backend is a FastAPI server that provides OCR endpoints.

### Step 1: Navigate to the backend directory

```bash
cd lensmu/backend
```

### Step 2: Create a Python virtual environment

```bash
# Create the virtual environment (only need to do this once)
python3 -m venv venv

# Activate it
# On macOS/Linux:
source venv/bin/activate

# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
```

You should see `(venv)` appear at the beginning of your terminal prompt.

### Step 3: Install Python dependencies

```bash
# Core server dependencies (FastAPI, uvicorn, Pillow, numpy)
pip install -r requirements.txt
```

**Optional: Install OCR engines**

PaddlePaddle and manga-ocr require **Python 3.8–3.12**. If you're on Python 3.13+, skip this step and use Tesseract.js (runs in the browser, no server needed) or Google Cloud Vision from the extension settings.

```bash
# macOS (Apple Silicon):
pip install paddlepaddle==2.6.2 -f https://www.paddlepaddle.org.cn/whl/mac/cpu/paddlepaddle.html

# Linux (CPU only):
pip install paddlepaddle==2.6.2

# Windows (CPU only):
pip install paddlepaddle==2.6.2

# Then install PaddleOCR and MangaOCR:
pip install paddleocr>=2.7.0 manga-ocr>=0.1.8
```

### Step 4: Start the backend server

```bash
python server.py
```

You should see: `INFO: Uvicorn running on http://0.0.0.0:8000`

### Step 5: Verify the server is running

```bash
curl http://localhost:8000/health
```

**Docker alternative:**

```bash
cd lensmu/backend
docker build -t visiontranslate-backend .
docker run -p 8000:8000 visiontranslate-backend

# With OCR engines:
docker build --build-arg INSTALL_OCR=true -t visiontranslate-backend .
```


## Setup: Browser Extension

### Step 1: Install Node.js dependencies

```bash
cd lensmu/extension
npm install
```

### Step 2: Build the extension

```bash
npm run build
```

**Windows PowerShell note:** If `npm run build` fails with `BUILD_TARGET is not recognized`, run the builds separately:

```powershell
$env:BUILD_TARGET="popup"
npx vite build
$env:BUILD_TARGET="overlay"
npx vite build
```

### Step 3: Load the extension in your browser

**Chrome / Chromium / Brave / Edge:**

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right corner)
3. Click **Load unpacked**
4. Navigate to and select the `lensmu/extension/` folder (the one containing `manifest.json`)
5. Pin VisionTranslate from the puzzle piece menu for easy access

**Firefox:**

1. Open Firefox and go to `about:debugging`
2. Click **This Firefox** in the left sidebar
3. Click **Load Temporary Add-on...**
4. Navigate to `lensmu/extension/` and select `manifest.json`


## How to Use

1. **Start the backend** (if using PaddleOCR or MangaOCR — skip if using Tesseract.js)
2. **Click the VisionTranslate icon** in your browser toolbar
3. **Configure your settings:**
   - **OCR Engine:** PaddleOCR (best for most languages), MangaOCR (best for Japanese manga), Tesseract.js (no backend needed), or Google Cloud Vision
   - **Translation Provider:** Choose your preferred service
   - **Target Language:** The language you want to translate INTO
4. **Navigate to a page with images** containing foreign-language text
5. **Click "Translate This Page"** in the popup
6. **Translated text appears** overlaid on the images
7. **Hover over any translated text** to see the original in a tooltip
8. **Click "Clear Overlays"** to remove all translations

### Tips for Best Results

- Larger images produce better OCR results than tiny thumbnails
- Clean, high-contrast text (black text on white background) works best
- MangaOCR is specifically trained on Japanese manga and outperforms PaddleOCR for that use case
- Tesseract.js is convenient (no backend required) but less accurate for CJK text


## Configuration Options

| Option                | Values                                     | Default       | Description                                                                 |
|-----------------------|--------------------------------------------|---------------|-----------------------------------------------------------------------------|
| OCR Engine            | PaddleOCR, MangaOCR, Tesseract.js, Cloud Vision | PaddleOCR | Which OCR engine to use for text extraction                                 |
| Translation Provider  | Google Translate, Gemini, LibreTranslate   | Google        | Which translation service to use                                            |
| Target Language       | en, ja, zh, ko, es, fr, de, ... (ISO 639)  | en            | Language to translate INTO                                                  |
| Source Language        | auto, en, ja, zh, ko, es, fr, de, ...      | auto          | Language to translate FROM (auto = auto-detect)                             |
| Backend URL           | Any URL                                    | localhost:8000| Where the Python backend is running                                         |
| Overlay Opacity       | 0.0 - 1.0                                 | 0.85          | How opaque the translation overlay is                                       |
| Font Size             | auto, 10-48                                | auto          | Font size for overlay text ("auto" scales to detected text region)          |


## Test URLs

Try these pages to test the extension:

| Description                         | URL                                                              |
|-------------------------------------|------------------------------------------------------------------|
| Japanese Wikipedia (text in images) | https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC                 |
| Chinese Wikipedia                   | https://zh.wikipedia.org/wiki/%E5%8C%97%E4%BA%AC%E5%B8%82       |
| Korean Wikipedia                    | https://ko.wikipedia.org/wiki/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C |
| Wikimedia Commons (foreign signs)   | https://commons.wikimedia.org/wiki/Category:Japanese_road_signs  |


## Project Structure

```
Hack-SMU-VII/
  README.md                     # This file
  LICENSE                       # MIT License
  .env.example                  # API key documentation

  lensmu/
    backend/                    # Python FastAPI server
      server.py                 # Server entry point, API routes
      security.py               # Rate limiting, input validation, security headers
      test_server.py            # Pytest test suite
      Dockerfile                # Container build file
      .dockerignore             # Docker build exclusions
      ocr_engines/              # OCR engine wrappers
        paddleocr_engine.py     # PaddleOCR wrapper
        mangaocr_engine.py      # MangaOCR wrapper
      requirements.txt          # Core Python dependencies
      requirements-ocr.txt      # OCR engine dependencies

    extension/                  # Browser extension (Chrome + Firefox)
      manifest.json             # Extension manifest
      background.js             # Service worker (message routing, state)
      content.js                # Content script (finds images, injects overlay)
      overlay.js                # Canvas rendering engine
      package.json              # Node.js dependencies
      vite.config.js            # Vite build configuration

      src/
        popup/                  # Popup UI (React)
          App.jsx               # Main popup component
          components/           # Settings sub-components
        content-overlay/        # Overlay UI (React, injected into pages)

      ocr/                      # OCR engine clients
        ocr-manager.js          # Engine router
        backend-ocr.js          # PaddleOCR/MangaOCR client
        tesseract.js            # In-browser OCR
        cloud-vision.js         # Google Cloud Vision client

      translate/                # Translation providers
        translate-manager.js    # Provider router
        google-translate.js     # Google Translate client
        llm-translate.js        # OpenAI/Claude/Gemini client
        libre-translate.js      # LibreTranslate client

      icons/                    # Extension icons
      dist/                     # Built files (generated by npm run build)
```


## Development Workflow

When actively developing, use watch mode to auto-rebuild on changes:

```bash
# Terminal 1: backend
cd lensmu/backend
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: extension build watcher
cd lensmu/extension
npm run watch
```

After the watcher rebuilds, go to `chrome://extensions` and click the refresh icon on VisionTranslate to reload it.


## Troubleshooting

### Backend won't start

- **Virtual environment not activated:** You should see `(venv)` in your terminal. If not, run `source venv/bin/activate` (macOS/Linux) or `.\venv\Scripts\Activate.ps1` (Windows).
- **Dependencies not installed:** Run `pip install -r requirements.txt` again.
- **Port 8000 in use:** Use a different port: `uvicorn server:app --host 0.0.0.0 --port 8001 --reload` and update the backend URL in the extension settings.
- **PaddlePaddle import error:** PaddlePaddle requires Python 3.8–3.12. Use Tesseract.js as an alternative.

### Extension can't reach the backend

- **Backend isn't running:** Check for `Uvicorn running on http://0.0.0.0:8000` in your terminal.
- **Wrong backend URL:** The extension defaults to `http://localhost:8000`. Verify in the popup settings.
- **CORS issue:** The backend includes CORS middleware for `chrome-extension://` and `moz-extension://` origins.

### OCR results are poor or empty

- **Wrong engine for the language:** PaddleOCR supports 80+ languages. MangaOCR is ONLY for Japanese.
- **Image too small:** Images under ~200px wide often produce poor results. Try larger images.
- **Try a different engine:** Different engines work better for different text types and layouts.

### Translation is wrong or garbled

- **Wrong source language:** Try setting the source language explicitly instead of auto-detect.
- **OCR errors:** If the OCR misread characters, the translation will be wrong. Try a different OCR engine.
- **Specialized text:** Manga slang and onomatopoeia are challenging for translation services.


## Team

Built at HackSMU VII by:
- [bornayo7](https://github.com/bornayo7)
- [Logan722](https://github.com/Logan722)
- [KBuildingPrograms](https://github.com/KBuildingPrograms)


## License

[MIT](LICENSE)
