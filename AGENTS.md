# AGENTS.md

## Project summary

VisionTranslate is a three-part project:

- `lensmu/extension`: the real product, a browser extension that detects text in webpage images, runs OCR, translates it, and overlays translated text
- `lensmu/backend`: a FastAPI OCR backend for PaddleOCR and MangaOCR
- `lensmu/website`: a marketing/demo site plus a lighter translation demo

The extension is the primary user experience. The website should not drift away from extension behavior without an explicit product decision.

## Repo-specific rules for coding assistants

1. Read the minimum number of files needed first.
2. Do not scan generated or vendor folders unless the task is specifically about build tooling.
3. Prefer minimal patches over broad refactors.
4. When debugging, trace the exact pipeline end to end before changing code.
5. Do not silently fall back from a failed translation to rendering source text as if translation succeeded.
6. Shared preference definitions must live in one canonical module and be reused by both the extension and the website.
7. Never sync secrets or API keys to the website or Auth0 metadata.
8. Preserve the current architecture split:
   - popup/settings UI in `src/popup`
   - page scanning in `content.js`
   - orchestration in `background.js`
   - render/layout in `overlay.js`
   - OCR providers in `ocr/`
   - translation providers in `translate/`

## Files and folders to ignore unless directly relevant

- `**/node_modules/**`
- `**/.next/**`
- `**/dist/**`
- `**/build/**`
- `**/venv/**`
- `**/venv312/**`
- `**/__pycache__/**`

## High-leverage files

- `lensmu/extension/background.js`
- `lensmu/extension/content.js`
- `lensmu/extension/overlay.js`
- `lensmu/extension/utils/storage.js`
- `lensmu/backend/server.py`
- `lensmu/website/lib/preferences-schema.ts`
- `lensmu/website/lib/preferences-store.ts`

## Commands

### Backend
```bash
cd lensmu/backend
python server.py
```

### Extension
```bash
cd lensmu/extension
npm install
npm run build
```

### Website
```bash
cd lensmu/website
npm install
npm run build
```

## Preferred working style

For any bug or feature work, respond in this order:

1. Root cause or implementation plan
2. Files to change
3. Minimal patch
4. Validation steps
5. Risks or follow-up items

## Current priorities

1. Reduce repeated assistant context and token usage
2. Create a canonical shared preferences module
3. Fix website build issues caused by missing shared settings imports
4. Normalize storage so read, write, and change listeners use the same shape
