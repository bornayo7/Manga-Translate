# lensmu Maintenance Resources

## Knowledge

- [Chrome: extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
  Explains termination and lost globals. Use when deciding whether state belongs in a worker, durable storage or the live page. Checked September 9, 2026.
- [Chrome: offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
  Defines the hidden document, runtime-only extension messaging, and creation/closure. Use for bundled OCR resource ownership. Checked September 9, 2026.
- [Git: merge reference](https://git-scm.com/docs/git-merge)
  Defines fast-forward behavior and refusal on divergence with `--ff-only`. Use before integrating a verified thermo candidate. Checked September 9, 2026.
- [Accepted image/settings ownership decision](docs/adr/0001-image-and-settings-ownership.md)
  Repository-specific rationale and rejected alternatives. Pair with the public lifecycle tests and the short lesson.
- [Image session implementation](lensmu/extension/page/image-session.js)
  Concrete acceptance guards and lifecycle operations. Read alongside [the preparation cache](lensmu/extension/shared/preparation-cache.js) to separate target ownership from shared work.

## Wisdom (Communities)

No community participation has been requested or evaluated. First use the project's reviewed behavior and local exercises; no joining preference is inferred.

## Gaps

The user's prior knowledge and demonstrated retention are unassessed. Do not create learning records merely because the lesson exists.
