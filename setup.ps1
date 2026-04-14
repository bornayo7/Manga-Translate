# =============================================================================
# VisionTranslate — One-Command Setup (Windows PowerShell)
# =============================================================================
# Run this after cloning or pulling the repo:
#   .\setup.ps1
#
# What it does:
#   1. Checks for Python 3.12 — installs it via winget if missing
#   2. Creates a virtual environment with Python 3.12
#   3. Installs backend dependencies (FastAPI, PaddleOCR, MangaOCR)
#   4. Installs extension dependencies (npm)
#   5. Builds the extension
#   6. Starts the backend server
# =============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VisionTranslate (LenSMU) Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Step 1: Check for Python 3.12
# ---------------------------------------------------------------------------
Write-Host "[1/6] Checking for Python 3.12..." -ForegroundColor Yellow

$python312 = $null
try {
    $version = py -3.12 --version 2>&1
    if ($version -match "Python 3\.12") {
        $python312 = "py -3.12"
        Write-Host "  Found: $version" -ForegroundColor Green
    }
} catch {}

if (-not $python312) {
    Write-Host "  Python 3.12 not found. Installing via winget..." -ForegroundColor Yellow
    try {
        winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
        Write-Host "  Python 3.12 installed. You may need to restart PowerShell." -ForegroundColor Green
        Write-Host "  After restarting, run this script again." -ForegroundColor Yellow
        exit 0
    } catch {
        Write-Host "  ERROR: Could not install Python 3.12 automatically." -ForegroundColor Red
        Write-Host "  Please download it manually from:" -ForegroundColor Red
        Write-Host "  https://www.python.org/downloads/release/python-3129/" -ForegroundColor Cyan
        Write-Host "  IMPORTANT: Uncheck 'Add to PATH' during install." -ForegroundColor Yellow
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Step 2: Create backend virtual environment
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[2/6] Setting up backend virtual environment..." -ForegroundColor Yellow

$backendDir = Join-Path $PSScriptRoot "lensmu\backend"
$venvDir = Join-Path $backendDir "venv"

if (-not (Test-Path $venvDir)) {
    Write-Host "  Creating venv with Python 3.12..."
    Push-Location $backendDir
    py -3.12 -m venv venv
    Pop-Location
    Write-Host "  Virtual environment created." -ForegroundColor Green
} else {
    Write-Host "  Virtual environment already exists. Skipping." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Step 3: Install backend dependencies
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[3/6] Installing backend dependencies..." -ForegroundColor Yellow

$pipPath = Join-Path $venvDir "Scripts\pip.exe"
$pythonPath = Join-Path $venvDir "Scripts\python.exe"

Write-Host "  Installing core dependencies..."
& $pipPath install -r (Join-Path $backendDir "requirements.txt") --quiet

Write-Host "  Installing PaddlePaddle (this may take a few minutes)..."
& $pipPath install paddlepaddle --quiet

Write-Host "  Installing PaddleOCR..."
& $pipPath install "paddleocr>=2.7.0" --quiet

Write-Host "  Installing MangaOCR..."
& $pipPath install "manga-ocr>=0.1.8" --quiet

Write-Host "  Backend dependencies installed." -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 4: Check for Node.js
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[4/6] Checking for Node.js..." -ForegroundColor Yellow

try {
    $nodeVersion = node --version 2>&1
    Write-Host "  Found: Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js not found." -ForegroundColor Red
    Write-Host "  Please install it from: https://nodejs.org/" -ForegroundColor Cyan
    exit 1
}

# ---------------------------------------------------------------------------
# Step 5: Install extension dependencies and build
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[5/6] Building the extension..." -ForegroundColor Yellow

$extensionDir = Join-Path $PSScriptRoot "lensmu\extension"
Push-Location $extensionDir

Write-Host "  Running npm install..."
npm install 2>&1 | Out-Null

Write-Host "  Building popup..."
$env:BUILD_TARGET = "popup"
npx vite build

Write-Host "  Building overlay..."
$env:BUILD_TARGET = "overlay"
npx vite build

Pop-Location
Write-Host "  Extension built." -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 6: Done — instructions
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the backend server:" -ForegroundColor Cyan
Write-Host "  cd lensmu\backend" -ForegroundColor White
Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor White
Write-Host "  python server.py" -ForegroundColor White
Write-Host ""
Write-Host "To load the extension in Chrome:" -ForegroundColor Cyan
Write-Host "  1. Go to chrome://extensions" -ForegroundColor White
Write-Host "  2. Enable Developer Mode (top right)" -ForegroundColor White
Write-Host "  3. Click 'Load unpacked'" -ForegroundColor White
Write-Host "  4. Select: $extensionDir" -ForegroundColor White
Write-Host ""
Write-Host "Set the OCR engine to PaddleOCR in the extension popup for best results." -ForegroundColor Yellow
Write-Host ""
