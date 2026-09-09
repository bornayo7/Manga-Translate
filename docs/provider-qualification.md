# Translation provider qualification

Reviewed on **2026-09-09**, using the local date and official provider documentation. Scope: the 13 picker IDs, three defaults, and stored-model migration rules in `lensmu/extension/shared/llm-models.js`. Documentation supports availability of every offered ID; no offered ID was found to be shut down. This is documentation qualification, not authenticated inference testing.

| Provider | Offered IDs (default in bold) | Evidence |
| --- | --- | --- |
| OpenAI | **`gpt-4o-mini`**, `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`, `gpt-5.6-terra`, `gpt-5.6-sol` | The [model catalog](https://developers.openai.com/api/docs/models/all) lists all six. The [comparison reference](https://developers.openai.com/api/docs/models/compare) documents Chat Completions support for Terra and Sol, matching the adapter route. |
| Anthropic | **`claude-sonnet-5`**, `claude-haiku-4-5-20251001`, `claude-opus-5` | All three appear in the [model overview](https://platform.claude.com/docs/en/models/overview) and are active in the [lifecycle table](https://platform.claude.com/docs/en/about-claude/model-deprecations). Haiku's “not sooner than October 15, 2026” guarantee is not an announced retirement date. |
| Google | **`gemini-2.5-flash`**, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-3.8-flash` | All four appear in the [model catalog](https://ai.google.dev/gemini-api/docs/models); the [deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations) announces no shutdown date for them. |

## Resolved migration gaps

Before this correction, the public resolver passed these three shut-down IDs through without migration. Exact-match rules now choose already-offered stable models in the same application tier. These are application choices, distinct from Google's recommended upgrades in its [deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations).

| Stored ID | Documented shutdown | Application replacement | Google's recommended replacement |
| --- | --- | --- | --- |
| `gemini-3-pro-preview` | 2026-03-09 | `gemini-2.5-pro` | `gemini-3.1-pro-preview` |
| `gemini-3.1-flash-lite-preview` | 2026-05-25 | `gemini-2.5-flash-lite` | `gemini-3.1-flash-lite` |
| `gemini-2.5-flash-lite-preview-09-2025` | 2026-03-31 | `gemini-2.5-flash-lite` | `gemini-3.1-flash-lite` |

The 13 offered IDs and three defaults are unchanged. Existing migration rules also include proactive replacements: OpenAI documents October 23, 2026 shutdowns for GPT-4.1 nano and legacy families, and December 11, 2026 for specified original GPT-5 snapshots. Those dates are future sunsets, not evidence that every matching alias is unavailable today. The existing diagnostics value `reason: 'retired'` covers both retired and announced-sunset application rules. [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations).

Existing Claude migrations likewise select application replacements; they do not reproduce Anthropic's recommended mapping verbatim. Unknown same-provider IDs still pass through, and a null migration means no rule matched, not validated availability. [Anthropic lifecycle table](https://platform.claude.com/docs/en/about-claude/model-deprecations).

## Validation and limits

`node --test test/llm-models.test.js test/llm-translate.test.js test/translation-manager.test.js` in `lensmu/extension`: **46 passed, 0 failed, 0 skipped**. Regression coverage checks all three replacements, migration diagnostics, and preservation of a similarly named custom ID.

No credentials were read and no paid provider requests were made. Tests exercise application behavior with controlled responses; they do not establish account permissions, quotas, latency, translation quality, or live parameter compatibility. Source inspection confirms the Claude adapter omits custom sampling parameters, consistent with [Sonnet 5 restrictions](https://platform.claude.com/docs/en/models/sonnet-5/overview); that is not a live inference result. Recheck official lifecycle pages when changing model defaults or qualifying a release.
