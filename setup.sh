#!/bin/bash
# =============================================================================
# VisionTranslate — One-Command Setup (macOS / Linux)
# =============================================================================
# Run this after cloning or pulling the repo:
#   chmod +x setup.sh
#   ./setup.sh
#
# What it does:
#   1. Checks for Python 3.12 — gives install instructions if missing
#   2. Creates a virtual environment with Python 3.12
#   3. Installs backend dependencies (FastAPI, PaddleOCR, MangaOCR)
#   4. Installs extension dependencies (npm)
#   5. Builds the extension
# =============================================================================

set -e

echo ""
echo "========================================"
echo "  VisionTranslate Setup"
echo "========================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/lensmu/backend"
EXTENSION_DIR="$SCRIPT_DIR/lensmu/extension"

# ---------------------------------------------------------------------------
# Step 1: Find a Python version supported by PaddleOCR and MangaOCR
# ---------------------------------------------------------------------------
echo "[1/5] Checking for Python 3.8-3.12..."

BACKEND_PYTHON=""
for cmd in python3.12 python3.11 python3.10 python3.9 python3.8 python3; do
    if command -v "$cmd" &>/dev/null; then
        version=$($cmd --version 2>&1)
        # PaddleOCR and manga-ocr currently support Python 3.8 through 3.12.
        minor=$(echo "$version" | sed -E 's/Python 3\.([0-9]+).*/\1/')
        if [[ "$minor" =~ ^[0-9]+$ ]] && [ "$minor" -ge 8 ] && [ "$minor" -le 12 ]; then
            BACKEND_PYTHON="$cmd"
            echo "  Found: $version"
            break
        fi
    fi
done

if [ -z "$BACKEND_PYTHON" ]; then
    echo "  No supported Python version found."
    echo ""
    echo "  Install it:"
    echo "    macOS:  brew install python@3.12"
    echo "    Ubuntu: sudo apt install python3.12 python3.12-venv"
    echo "    Other:  https://www.python.org/downloads/release/python-3129/"
    echo ""
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Create backend virtual environment
# ---------------------------------------------------------------------------
echo ""
echo "[2/5] Setting up backend virtual environment..."

if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "  Creating venv with $BACKEND_PYTHON..."
    $BACKEND_PYTHON -m venv "$BACKEND_DIR/venv"
    echo "  Virtual environment created."
else
    echo "  Virtual environment already exists. Skipping."
fi

source "$BACKEND_DIR/venv/bin/activate"

# ---------------------------------------------------------------------------
# Step 3: Install backend dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[3/5] Installing backend dependencies..."

pip install -r "$BACKEND_DIR/requirements.txt" --quiet

echo "  Installing PaddlePaddle (this may take a few minutes)..."
# Detect platform for PaddlePaddle install
if [[ "$(uname -m)" == "arm64" ]] && [[ "$(uname)" == "Darwin" ]]; then
    pip install paddlepaddle --quiet 2>/dev/null || true
else
    pip install paddlepaddle --quiet 2>/dev/null || true
fi

if python -c "import paddle" &>/dev/null 2>&1; then
    echo "  Installing PaddleOCR..."
    pip install "paddleocr>=2.7.0" --quiet 2>/dev/null || echo "  WARNING: PaddleOCR could not be installed — PaddleOCR engine will be unavailable."
else
    echo "  WARNING: PaddlePaddle could not be installed (likely unsupported Python version)."
    echo "           PaddleOCR engine will be unavailable. MangaOCR will still work."
    echo "           To enable PaddleOCR, install Python 3.12: brew install python@3.12"
fi

echo "  Installing MangaOCR..."
pip install "manga-ocr>=0.1.8" --quiet

echo "  Backend dependencies installed."

# ---------------------------------------------------------------------------
# Step 4: Check for Node.js and build extension
# ---------------------------------------------------------------------------
echo ""
echo "[4/5] Checking for Node.js..."

if ! command -v node &>/dev/null; then
    echo "  ERROR: Node.js not found."
    echo "  Install it from: https://nodejs.org/"
    exit 1
fi

echo "  Found: Node.js $(node --version)"

# ---------------------------------------------------------------------------
# Step 5: Build extension
# ---------------------------------------------------------------------------
echo ""
echo "[5/5] Building the extension..."

cd "$EXTENSION_DIR"
npm install --silent 2>/dev/null
BUILD_TARGET=popup npx vite build 2>/dev/null
BUILD_TARGET=overlay npx vite build 2>/dev/null
cd "$SCRIPT_DIR"

echo "  Extension built."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo "To start the backend server:"
echo "  cd lensmu/backend"
echo "  source venv/bin/activate"
echo "  python server.py"
echo ""
echo "To load the extension in Chrome:"
echo "  1. Go to chrome://extensions"
echo "  2. Enable Developer Mode (top right)"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $EXTENSION_DIR"
echo ""
echo "Set the OCR engine to PaddleOCR in the extension popup for best results."
echo ""
