# DECISIONS.md

## Decision 1: One canonical settings source

The source of truth for preference defaults and schema versioning should be:

- `lensmu/extension/shared/preferences.js`

Why:
- both extension and website need the same safe preference definitions
- this prevents drift
- this reduces assistant rediscovery costs

## Decision 2: Separate synced preferences from local-only settings

Synced preferences:
- UX and behavior settings that are safe to store in Auth0 metadata

Local-only settings:
- API keys
- secrets
- provider auth
- backend endpoints unless intentionally shared

## Decision 3: Keep patches small

Prefer:
- adding the shared module
- updating imports
- normalizing storage
- then testing

Avoid broad rewrites unless the task explicitly asks for them.

## Decision 4: Extension is the product truth

If the website and extension differ, the extension behavior wins unless the team intentionally chooses otherwise.

## Decision 5: Assistants should work from delta context

New tasks should provide:
- exact goal
- exact files
- symptoms
- constraints

Avoid full-repo scans unless absolutely necessary.
