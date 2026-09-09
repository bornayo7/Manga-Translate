# Image occurrence and durable settings ownership

Accepted 2026-09-09 when the user approved `OVERHAUL_PLAN.md`.

## Decision

One image target owns its display lifetime and accepts results only for its current revision. Reusable preparation is separate and shared by content/settings identity. The background owns durable settings and the trusted preparation pipeline.

## Context

The review reproduced two identical images sharing one render transaction, prefetch replacing a click, cancelled results painting later, and popup edits being forgotten before durable acknowledgment. The previous maps/queues split these responsibilities and treated different identities as interchangeable.

## Alternatives

- Patch individual queue keys and nullable guards: smaller immediate diff, but every caller must continue knowing the same lifecycle rules.
- Share the complete image transaction by source: saves work but cannot represent two independent page occurrences.
- Keep serialized persistence dispatch in the popup: straightforward sequencing, but the popup can disappear while holding the only copy of a later edit.

## Consequences

Target disposal immediately retires that target's ownership. A shared producer keeps its capacity until actual work finishes and cannot be stopped by one departing consumer. Visual changes do not invalidate preparation; translation/OCR changes and actual credential rotations do, using an opaque persisted preparation revision. Credentials remain in trusted extension storage. Tests exercise the same public interfaces used by the browser.

Sources: `CODEBASE_REVIEW.md`, detailed September 9 audit reports, approved `OVERHAUL_PLAN.md`, user confirmation in this task on September 9.
