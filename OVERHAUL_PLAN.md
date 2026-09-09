# Approved overhaul and branch integration

Prepared 2026-09-09 after the [complete codebase review](CODEBASE_REVIEW.md). Status: **approved by the user on 2026-09-09; implementation and local acceptance complete; exact-candidate CI and integration recorded in PR #2**. Source baseline is `thermo` at `172c2d2`; the documentation checkpoint extends that branch without changing application behavior.

## Outcome and proposed scope

Make lensmu reliable at its main job: translate each requested webpage image, display a truthful result, and clean up correctly when the page or user changes intent. Build simpler modules around that behavior, then give the popup and website a coherent reading-focused interface.

Accepted defaults from the user's full-plan authorization:

1. Keep the extension as the product and the website as a clearly limited local demo and installation guide. Preserve the extension/backend/website split.
2. Continue on the existing `thermo` branch. Integrate into the actual default branch, **`main`**, after the acceptance gates pass. There is no `master` branch; renaming the default branch is a separate decision.
3. Keep supported OCR/translation choices, local-only credentials and opt-in fallback. Validate advertised options against actual dependencies/providers before release.
4. Teach the architectural changes and safe branch integration as the work proceeds. Architectural ownership and safe branch integration are the initial teaching focus; no learning achievements are inferred from implementation.

The user approved the complete plan after reviewing the branch, product-scope and teaching recommendations. The accepted ownership choice is recorded in `docs/adr/0001-image-and-settings-ownership.md`. Routine source changes, verification, checkpoints and main integration are authorized.

## Design rules

- A **module** owns a complete responsibility behind a small interface. A **seam** exists where there are real alternatives, such as Chrome messaging versus a deterministic test adapter, or actual OCR libraries versus controlled engines.
- One page image occurrence owns its display lifetime. Equal image contents may share preparation, but never share DOM ownership.
- Every asynchronous completion must be accepted against the current owner/revision before changing durable state or the page. Cancellation must relinquish obsolete ownership immediately, even when an external worker cannot stop immediately.
- Success comes from validated provider and rendered-region outcomes. An array, Blob, parsed marker or completed promise alone is insufficient.
- Keep `content.js` as page scanning/composition, `background.js` as orchestration/composition, `overlay.js` as render/layout entry point, popup UI under `src/popup`, OCR under `ocr/`, translation under `translate/`.
- Add public behavior coverage at the seam being changed. Remove private-state harness coupling only when equivalent observable coverage exists. Avoid retaining two implementations or adding wrappers that forward the same large interface.

## Milestones

Each milestone ends with an inspected diff, relevant passing checks, a focused commit and push to `thermo`, and an updated finding status. Mark a finding fixed only with its actual evidence. Independent provider/backend work can proceed in parallel after shared contracts are settled; lifecycle and settings ownership edits must have one owner each.

### 0. Establish the release contract and CI feedback

**Change:** Agree the proposed scope, inventory supported engines/browser claims, and open a draft `thermo` → `main` PR when implementation begins so the existing pull-request CI runs. Reconcile historical audit/status summaries with this review. Record the untouched starting SHAs.

**Files:** `TASK_STATE.md`, `REMEDIATION_LEDGER.md`, `AUDIT.md`, project documentation; `.github/workflows/ci.yml` only where required for new test jobs or dependency profiles.

**Gate:** A clean install of each application passes in the actual CI environment. No existing `thermo` changes are discarded or replayed by hand. The current branch has eight commits beyond `main`; documentation adds its own checkpoint.

### 1. Make settings durable and acknowledgments truthful

**Change:** Put authoritative serialized writes and acknowledged revisions in the background-owned settings service. Dispatch popup edits promptly, retain failed/unacknowledged fields, and make `ensureSaved` wait for the requested revision. Group related updates atomically. Fail writes when the current snapshot cannot be read. Share preference validation/migration and secret-field policy from the existing canonical module.

**Files:** `extension/utils/storage.js`, `extension/shared/preferences.js` and declarations, `extension/background.js`, `extension/src/popup/settings-persistence.js`, popup `App.jsx`/`ApiKeyInput.jsx`, website `lib/preferences-schema.ts`/`preferences-store.ts`, relevant settings tests. New implementation files stay within these responsibility areas.

**Interface:** Load snapshot, apply patch, await acknowledged revision, subscribe. The disposable UI should consume this interface without owning the only copy of an edit.

**Gate:** Failed storage reads cause no write; failed patches are retried or remain visibly unsaved; a second edit reaches the background while the first acknowledgment is pending; closing/reopening the popup preserves accepted intent; unrelated saves cannot falsely clear an earlier failure. No credential appears in content-script messages or website metadata. Covers W-01/W-02/W-07/S-01.

### 2. Give each image one lifecycle owner

**Change:** Introduce an `ImageSession` per DOM target. It owns immutable source/settings revision, accumulated render intent, preparation subscription, current display and disposal. Use a separate bounded content/settings cache for reusable OCR/translation preparation. Content fingerprints must represent pixels/content, including canvases; dimensions alone are not identity.

Promote prefetch to render when clicked; never demote a user click. Cancellation clears obsolete target ownership synchronously, while a shared preparation producer retains its capacity permit until the actual work finishes or stops. Cancelling one consumer cannot stop a producer still needed by another target. Every redraw, activation and DOM commit checks its revision. Aggregate complete observer deliveries and reconcile actual host targets inside wrappers, source changes and removals.

**Files:** `extension/content.js`, `extension/shared/image-work-queue.js`, `extension/shared/translation-outcomes.js`, lifecycle/queue tests and browser adapters. Put page-lifetime implementations under the extension's page-scanning area; keep queue mechanics free of DOM policy.

**Interface:** Request translation, update settings/source revision, dispose, observe outcome. No public setters for individual lifecycle flags. Shared producers and per-target consumers have distinct cancellation rules.

**Gate:** Both identical-source images render independently; equal-size canvases with different pixels remain distinct; prefetch cannot erase clicks; settings retry creates a fresh revision immediately and executes when capacity permits; `src`/`srcset` changes invalidate stale displays; all mutation records are accounted for; deactivation and disposal prevent all later DOM writes. Covers EC-01 through EC-07.

Retain existing wrappers for the first repair. A wrapper-free overlay root changes positioning/style compatibility and needs separate browser evidence before adoption.

### 3. Unify validated outcomes and display plans

**Change:** Share runtime OCR-response validation and explicit per-region outcomes. Layout returns graphemes and draw coordinates as a concrete display plan; both renderers consume it without reconstructing line order. Reject zero-painted output; surface partial completion with reason/counts. Preserve source pixels for regions that cannot be rendered.

Treat truncated LLM completions as incomplete despite valid markers. Retry within explicit limits or fail visibly. Make body readers own timeout/abort cleanup; use the bounded fetch path for popup health checks.

**Files:** `extension/shared/text-layout.js`, `translation-outcomes.js`, `ocr-responses.js` and declarations; `extension/overlay.js`, `extension/ocr/*`, `extension/translate/llm-translate.js`, `shared/fetch-with-timeout.js`, `shared/response-limits.js`; website `lib/translator.ts`; popup health-check code.

**Gate:** Tiny/out-of-bounds/all-unfit cases cannot report rendered; vertical emoji/combining/CJK sequences paint as fitted; malformed HTTP 200 payloads are invalid-response outcomes; missing/truncated/refused translations are explicit failures with no source-text masquerading as success; abort/timeout cancels and releases a held body reader. Covers EC-08/EC-09/W-03/W-04/W-08/S-02/S-03.

### 4. Make OCR execution bounded and reproducible

**Change:** A deep `OcrRuntime` owns model loading/cache, request admission, worker completion, cancellation and status. Library adapters own version-specific constructor/result behavior. Validate image dimensions/format/pixel budget before loading engines. Correct engine color space and keep OCR coordinates in the original-image coordinate system. Distinguish empty recognition, partial region failure and fatal engine failure.

**Files:** `backend/server.py`, `backend/security.py`, `backend/ocr_engines/paddle_ocr.py`, `manga_ocr.py`, a bounded runtime/decoder module, backend tests and requirements profiles; `setup.ps1`, backend Dockerfile/README and root README.

**Interface:** Paddle recognition, Manga region recognition, status; runtime owns worker capacity until the worker actually finishes. Avoid splitting the backend into numerous forwarding layers.

**Gate:** Known-color and coordinate fixtures pass; model crashes cannot become successful empty recognition; decoded-pixel rejection precedes model loading; cancellation never allows the configured model concurrency to be exceeded; concurrent first loads and health polling behave predictably. Setup propagates pip/npm failure exits and restores working directories. Default Docker documentation binds the host port to loopback. Covers B-01 through B-07.

Lock tested core and OCR profiles consumed consistently by setup/CI/Docker. Keep the currently advertised Paddle versions only if each passes its own real-model matrix; otherwise explicitly narrow the supported profile. Do not guess compatible pins or silently drop an engine.

### 5. Reduce background, popup and demo responsibilities

**Change:** Background composition delegates whole translation transactions, cancellation and provider outcomes to a pipeline module. Offscreen OCR and read-aloud own their resource/session lifetimes. Popup composition consumes settings, current-page and speech-preview sessions. Demo translation accepts an AbortSignal, reports progress/partial outcomes and cleans object URLs/resources on cancellation or unmount.

**Files:** `extension/background.js`, `extension/ocr/tesseract.js`, `extension/offscreen/ocr.js`, `extension/translate/translate-manager.js`, `extension/tts/elevenlabs.js`; popup `App.jsx` and related controls/styles; website `lib/translator.ts` and `TranslatorSection.tsx`. Final module names follow existing directory ownership; do not create a parallel application framework.

**Gate:** Real Chrome MV3 service-worker restart, offscreen creation/idle shutdown/reuse, tab removal, popup closure and speech replacement have explicit outcomes. No mandatory TTS preparation work when read-aloud is disabled. Demo cancellation stops accepting late results and releases URLs. The major entry files become composition surfaces; target under 1,000 lines each, and aim substantially lower where responsibility allows. Review interface size, mutable state and imports rather than accepting file counts alone.

Chrome can terminate extension service workers and loses their globals; architecture must tolerate that. An offscreen WORKERS document does not automatically acquire an idle timeout. See the official [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) and [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) references. Choose teardown based on actual active work, avoiding accidental termination during recognition.

### 6. Rebuild the interface around reading and honest status

**Change:** Use one real, owned/licensed source/translated panel as the website's centerpiece. Make installation a working product-specific destination or clearly named local-install guide. Keep page state, language direction and primary translation action in the popup's first view. Support original/translated comparison, progress/cancel, partial-region details and accessible transcripts in the demo.

**Files:** Website `app/layout.tsx`, route pages, `components/layout/*`, `components/sections/*`, `data/site.ts`, `app/globals.css`, `tailwind.config.ts`; popup screens, accessible controls and `src/styles/globals.css`.

**Visual proposal:** Paper/cool-page surfaces (`#FFFFFF`, `#F1F4FA`), ink (`#20304A`), reading blue (`#3157C8`), confirmed teal (`#176F67`), correction red (`#B33A43`). Compact Barlow Condensed display type and Source Sans 3 UI type, with language-aware Noto/system fonts for translated content; verify font licensing and contrast before finalizing. Use a compact masthead and a stable asymmetric panel/controls layout. Motion responds to user action and respects reduced-motion settings.

```text
Website:  lensmu                         Demo  Install  About
          Headline + supported promise | Actual translation panel
          Install / Try a sample       | Original / Translation
          Real setup sequence, supported engines, local-demo limits

Popup:    lensmu                         Current page status
          Source language  ->  Target language
          Translate this page
          Acknowledged settings status / actionable error
          Translation | Appearance | Account
```

**Gate:** Keyboard-only operation; no hidden focus targets; no clipped controls or horizontal page overflow at 320/390/820/1280px; both themes/account configurations; readable high zoom; measured contrast; truthful loading/empty/error/partial/complete states. Replace custom select machinery with native controls where rich rendering does not improve a real choice. Covers W-05/W-06 and the detailed UI findings.

### 7. Release acceptance and integration

**Change:** Run the complete matrix below from the final candidate, inspect the exact diff against `origin/main`, then integrate the verified commits. Update readme/setup/support claims and brain/project state with observed results and any explicitly accepted limitations.

**Gate:** Clean CI on the PR and the exact final default-branch commit; no unresolved P1 findings; each P2 either verified fixed or explicitly accepted with its user-visible limitation. No “perfect” or “all engines working” claim without those actual runtime checks.

## Acceptance matrix

| Area | Required evidence before release |
| --- | --- |
| Deterministic contracts | Regression stimuli in the review fail before fixes and pass through real public interfaces afterward; existing suites remain green. |
| Dependency/build | Clean CI installs for both JavaScript apps; pinned/tested backend profiles; extension build; website lint/typecheck/tests/build; backend tests. |
| Chrome extension | Load the built unpacked extension; click/Translate All; duplicate URLs; changing canvases; lazy loading/srcset; mixed additions/removals; resize/DPR/object-fit; scrolling/reparenting; toggle/deactivate; popup close; worker restart; page-style restoration. |
| Actual OCR | English and colored text, Japanese horizontal/vertical, geometry-sensitive samples, empty/corrupt/oversized input; real Paddle and Manga versions that remain advertised. Tesseract supported languages checked in the extension. |
| Providers | Actual selected provider/model smoke requests, refusal/rate-limit/malformed/truncated handling via deterministic fixtures, bounded retry/cancellation and opt-in fallback. Use existing local credentials only through approved storage; never add them to docs or test fixtures. |
| Display | Actual extension and demo draw paths, Unicode/graphemes, no-fit/too-small/partial results, source preservation and exported image inspection against approved fixtures. |
| UI | Mobile/tablet/desktop, keyboard, focus restoration, reduced motion, high zoom, both themes, account-disabled and account-enabled states if shipped, real install target. |
| Setup | Windows checked failure propagation, documented supported install profiles, optional Docker build/run if Docker remains an advertised installation route. |

Live OCR downloads, provider availability and authenticated browser sessions are current verification gaps. Resolve the required local setup during implementation; if access is unavailable, report the exact unverified route instead of presenting it as passing. Auth0 sync stays disabled until its configuration and authenticated flows are validated. Firefox remains unadvertised until packaged and tested. Tune source-language heuristics only after collecting representative labeled fixtures.

## How `thermo` reaches the default branch

Verified on 2026-09-09 before this documentation checkpoint:

- Remote: `https://github.com/bornayo7/Manga-Translate.git`.
- Local/remote `thermo`: `172c2d2`; local/remote `main`: `bbe553c`.
- `git rev-list --left-right --count origin/main...thermo` returned `0 8`.
- Remote/default branch is `main`; no local or remote `master` exists.
- No PR or CI run existed for `thermo`. CI runs on pushes to `main` and on pull requests, so an ordinary push to `thermo` alone does not exercise it.
- No merge/rebase or conflicts were in progress. Main was unprotected when inspected; do not treat that as a reason to omit review/CI.

Implementation workflow, once this plan is confirmed:

1. Stay on `thermo`, preserving all eight existing commits. Add verified milestones and push each one. Open/update one draft PR targeting `main` with the final problem/behavior and validation evidence.
2. Fetch `origin`; confirm a clean worktree and inspect `origin/main...thermo`, commit history, PR checks and the final candidate SHA. Verify no unrelated files or secrets enter the commit range. Require local `main` to match `origin/main`; investigate any local-only commits before proceeding, and separately fast-forward a merely behind local branch only after confirming ancestry.
3. If `origin/main` remains an ancestor of `thermo`, fast-forward local `main` to the reviewed `thermo` tip and push normally. This retains every existing/new commit. Git's [`--ff-only`](https://git-scm.com/docs/git-merge) makes divergence a refusal instead of an accidental merge.
4. If `main` has advanced independently, merge `origin/main` into `thermo` first. Resolve each conflict from base/ours/theirs and commit intent; rebuild the combined behavior, rerun relevant checks and CI, then repeat the ancestry/diff check. Avoid blanket `ours`/`theirs`, resets or force pushes.
5. If the push is rejected because main advanced, fetch and repeat the integration checks. If branch protection changes, use the permitted PR merge path and validate its resulting commit.
6. Verify the remote main SHA contains the reviewed thermo candidate, inspect the merge result and await CI for that exact main commit. Update source-of-truth status only after success. Keep branch names unless cleanup is explicitly requested.

The concrete fast-forward sequence below is a **Git Bash script**, conditional on those gates and the target-name decision. It stops at the first failure and refuses a dirty worktree or local/default-branch mismatch:

```bash
set -eu
test -z "$(git status --porcelain)"
git fetch origin
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
git merge-base --is-ancestor origin/main thermo
git switch main
git merge --ff-only thermo
git push origin main
```

Do not execute the sequence against an unreviewed or dirty tree. A `master` rename is not needed to combine the histories. If the user specifically chooses that name, first agree how default-branch settings, CI push filters, documentation and links should migrate; do not silently create a second default-like branch.

## Main risks and checkpoints

The largest regression risk is image lifecycle behavior on arbitrary host pages. Repair target ownership before changing wrappers or presentation. Shared preparation cancellation must not stop work still needed by another target. Public contracts should be fixed before parallel refactoring to prevent extension/website divergence.

OCR version differences, MV3 worker lifetimes and real translated-text fit need runtime evidence beyond mocks. Preserve existing adapters while bringing them under clearer ownership. Keep each milestone independently reviewable and rerun broader tests when changes cross module boundaries. This permits an ambitious overhaul with a traceable path from each reported defect to its acceptance evidence.
