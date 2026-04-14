# REPO_MAP.md

## Top-level structure

```text
Hack-SMU-VII/
  README.md
  lensmu/
    backend/
    extension/
    website/
```

## Product surfaces

### 1. Extension
Primary product surface. This is where the real OCR -> translation -> overlay experience lives.

Important files:
- `lensmu/extension/manifest.json`
- `lensmu/extension/background.js`
- `lensmu/extension/content.js`
- `lensmu/extension/overlay.js`
- `lensmu/extension/utils/storage.js`

Subsystems:
- `lensmu/extension/ocr/` for OCR providers
- `lensmu/extension/translate/` for translation providers
- `lensmu/extension/src/popup/` for popup UI

### 2. Backend
Provides OCR endpoints for local engines.

Important files:
- `lensmu/backend/server.py`
- `lensmu/backend/security.py`
- `lensmu/backend/ocr_engines/`

### 3. Website
Marketing/demo surface and website preference sync.

Important files:
- `lensmu/website/app/page.tsx`
- `lensmu/website/lib/preferences-schema.ts`
- `lensmu/website/lib/preferences-store.ts`

## Main extension data flow

Popup settings
-> `background.js`
-> `content.js`
-> OCR provider
-> translation provider
-> `overlay.js`

## Known architectural pressure points

- `background.js`, `content.js`, and `overlay.js` are large and high-responsibility
- settings/defaults are duplicated or drifting
- website and extension behavior can diverge
- storage handling looks inconsistent between direct key storage and `SETTINGS_KEY`

## Recommended canonical settings ownership

Create:
- `lensmu/extension/shared/preferences.js`

This file should export:
- `PREFERENCE_SCHEMA_VERSION`
- `DEFAULT_EXTENSION_SETTINGS`
- `DEFAULT_SYNCED_PREFERENCES`
- `LOCAL_ONLY_SETTING_KEYS`
- `splitSettingsForSync()`
- `mergeWithDefaults()`

Then:
- `lensmu/website/lib/preferences-schema.ts` imports from it
- `lensmu/website/lib/preferences-store.ts` imports from it
- `lensmu/extension/utils/storage.js` imports from it
