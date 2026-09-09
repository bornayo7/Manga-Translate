# Overhaul implementation

User confirmed the complete plan on 2026-09-09: continue on `thermo`, keep the extension primary, then integrate into `main` after verification. Draft PR: https://github.com/bornayo7/Manga-Translate/pull/2. Starting source `172c2d2`; review checkpoint `ff9f7ba`.

## Verified milestones

### Durable storage and response contracts

- S-01: authoritative storage reads now reject failures/corrupt envelopes. Serialized settings and domain mutations preserve prior data and report only successful writes.
- Opaque persisted settings/preparation revisions distinguish cosmetic updates from OCR/translation changes, including credential rotation, without exposing credential values to pages.
- Shared preference validation derives strict website input policy from canonical types/ranges/keys; local migration remains coercive. Secrets remain local-only.
- S-02: any LLM length stop invalidates the whole answer, even with every numbered marker present. One complete retry is allowed; a second truncation fails explicitly. Missing markers without truncation retain targeted recovery.
- S-03: the response reader owns cancellation and lock release through the entire deadline. No attempted cancellation through an already locked Response body.
- Shared OCR decoding now separates invalid payload/count/geometry, genuine empty detection and explicit partial engine failure. All-region failure cannot become success.
- Validation: 67 relevant Node tests passed (storage, canonical preferences, bounded response/deadline, LLM response/retry and OCR contracts). No live provider request was made by these tests.

## In progress

ImageSession/discovery/render ownership; background preparation/tab/offscreen lifetimes; popup acknowledged persistence and UI; website cancellable demo/design; backend bounded runtime and real-engine qualification. Whole-application checks and runtime acceptance follow the independent milestones.

## Release gate

The original review is a historical source snapshot. Final finding dispositions, clean CI, browser/model/provider evidence and any unverified routes will be recorded here and in the final acceptance report before integration. No production-readiness claim follows from the partial milestones above.
