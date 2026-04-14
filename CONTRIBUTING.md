# Contributing to VisionTranslate

Thanks for your interest in contributing to VisionTranslate! This guide covers everything you need to get started.


## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/Hack-SMU-VII.git
   cd Hack-SMU-VII
   ```
3. **Set up the backend and extension** by following the instructions in the [README](README.md).
4. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```


## Development Setup

You will need two terminals running during development.

**Terminal 1 — Backend (Python):**
```bash
cd lensmu/backend
python -m venv venv
source venv/bin/activate          # Windows: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — Extension (Node.js):**
```bash
cd lensmu/extension
npm install
npm run watch
```

After changes rebuild, refresh the extension in `chrome://extensions` by clicking the reload icon.


## Project Structure

The codebase is organized into two main parts.

**`lensmu/backend/`** contains the Python FastAPI server that runs OCR models locally. Key files include `server.py` (API routes), `security.py` (middleware), and the `ocr_engines/` directory (PaddleOCR and MangaOCR wrappers).

**`lensmu/extension/`** contains the browser extension. The popup UI is built with React (`src/popup/`), OCR engine clients live in `ocr/`, and translation provider clients live in `translate/`. The `content.js` script handles page scanning and overlay rendering.


## Making Changes

**Backend changes:** Edit files in `lensmu/backend/`. The `--reload` flag on uvicorn will restart the server automatically. Run tests with `pytest test_server.py -v` before committing.

**Extension changes:** Edit source files in `lensmu/extension/src/` for popup components, or the root-level `.js` files for content scripts and background workers. The watcher will rebuild automatically, but you need to manually reload the extension in Chrome.

**Adding a new OCR engine:** Create a new file in `lensmu/extension/ocr/`, export a `recognize` function that returns results in the normalized format (`[{ text, bbox, confidence, orientation }]`), and register it in the `OCR_REQUEST` handler in `background.js`.

**Adding a new translation provider:** Create a new file in `lensmu/extension/translate/`, export a translation function, and register it in `translate-manager.js`.


## Code Style

**Python:** Follow PEP 8 conventions. Use type hints where practical. Keep docstrings descriptive — this is a learning-friendly codebase.

**JavaScript:** Use ES module syntax (`import`/`export`). Prefer `const` over `let`, and `let` over `var`. Use `async`/`await` instead of raw Promises. Add comments explaining *why*, not just *what*.

**Commits:** Write clear, descriptive commit messages. Use the imperative mood ("Add feature" not "Added feature"). Keep commits focused on a single change.


## Running Tests

```bash
cd lensmu/backend
pip install pytest httpx
pytest test_server.py -v
```

If you add a new backend endpoint, please add corresponding tests in `test_server.py`.


## Submitting Changes

1. Push your branch to your fork: `git push origin feature/your-feature-name`
2. Open a Pull Request against the `main` branch.
3. Describe what your changes do and why.
4. Link any related issues.

We review PRs as quickly as we can. If something needs adjustment, we will leave comments on the PR.


## Reporting Issues

Open an issue on GitHub with a clear description of the problem, steps to reproduce it, and your environment details (OS, Python version, Node.js version, browser).


## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
