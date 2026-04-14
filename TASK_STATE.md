# TASK_STATE.md

## Current goal

Reduce assistant token/context usage while also cleaning up one concrete source of repo drift.

## Immediate implementation targets

### A. Add reusable context files
Add these files so Codex and Claude do not have to rediscover the repo every session:

- `AGENTS.md`
- `REPO_MAP.md`
- `PIPELINES.md`
- `TASK_STATE.md`
- `DECISIONS.md`

### B. Add canonical shared preferences module
Add:
- `lensmu/extension/shared/preferences.js`

Reason:
The website already imports `../../extension/shared/preferences.js` from:
- `lensmu/website/lib/preferences-schema.ts`
- `lensmu/website/lib/preferences-store.ts`

That path should become real and authoritative.

### C. Normalize extension storage
`lensmu/extension/utils/storage.js` currently:
- defines `SETTINGS_KEY`
- reads all of `chrome.storage.local`
- writes merged settings directly at top level
- listens for `changes[SETTINGS_KEY]`

This should be normalized so reads, writes, and change listeners all use the same storage shape.

## Success criteria

1. Website build no longer fails because the shared preferences module is missing
2. Settings defaults are defined in one place
3. Synced preferences exclude secrets
4. Coding assistants can start from the context files instead of scanning the full repo
