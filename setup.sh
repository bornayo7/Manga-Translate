#!/usr/bin/env bash
# Usage: ./setup.sh [core|ocr2|ocr3]. Requirements are shared with Docker/CI.
set -euo pipefail

PROFILE="${1:-ocr2}"
case "$PROFILE" in
  core) REQUIREMENTS="requirements.txt" ;;
  ocr2) REQUIREMENTS="requirements-ocr.txt" ;;
  ocr3) REQUIREMENTS="requirements-ocr3.txt" ;;
  *) echo "Usage: ./setup.sh [core|ocr2|ocr3]" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/lensmu/backend"
BACKEND_PYTHON=""
for candidate in python3.12 python3; do
  if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; assert sys.version_info[:2] == (3,12)' 2>/dev/null; then
    BACKEND_PYTHON="$candidate"
    break
  fi
done
if [[ -z "$BACKEND_PYTHON" ]]; then
  echo "Install Python 3.12 before running setup." >&2
  exit 1
fi
command -v node >/dev/null
command -v npm >/dev/null
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 20 || (major === 20 && minor < 19)) process.exit(1)'

if [[ ! -x "$BACKEND_DIR/venv/bin/python" ]]; then
  "$BACKEND_PYTHON" -m venv "$BACKEND_DIR/venv"
fi
VENV_PYTHON="$BACKEND_DIR/venv/bin/python"
"$VENV_PYTHON" -c 'import sys; assert sys.version_info[:2] == (3,12), "Recreate venv with Python 3.12."'
"$VENV_PYTHON" -m pip install -r "$BACKEND_DIR/$REQUIREMENTS"
"$VENV_PYTHON" -m pip check

# A subshell restores the caller's directory even when installation/build fails.
(
  cd "$SCRIPT_DIR/lensmu/extension"
  npm ci
  npm run build
)
printf '%s\n' 'Setup complete.' "Start backend: $VENV_PYTHON $BACKEND_DIR/server.py" "Load unpacked extension: $SCRIPT_DIR/lensmu/extension"
