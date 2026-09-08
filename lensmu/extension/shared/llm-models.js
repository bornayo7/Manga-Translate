// One source of truth for LLM provider models: what the popup offers, what
// each provider defaults to, and which stored IDs the providers have since
// retired. Keep this file free of browser APIs; the popup, the service
// worker and the tests all import it.
//
// Checked against the provider model pages on 2026-09-07:
//   - Google (ai.google.dev/gemini-api/docs/models): gemini-2.0-flash and
//     gemini-2.0-flash-lite are shut down, the 1.5 generation and the
//     2.5-pro preview IDs are gone; 2.5 Flash, 2.5 Flash-Lite, 2.5 Pro and
//     the 3.x Flash line (3.8 Flash current) are served.
//   - Anthropic (platform.claude.com/docs/en/models/overview): the Claude
//     3.x family and claude-sonnet-4-20250514 are retired; claude-sonnet-5,
//     claude-opus-5 and claude-haiku-4-5-20251001 are current. Sonnet
//     4.5/4.6 and Opus 4.5-4.8 are still served as legacy models, so a
//     stored ID from that range passes through unchanged even though the
//     picker does not offer it.
//   - OpenAI (developers.openai.com/api/docs/deprecations + /models):
//     gpt-4, gpt-4-turbo, gpt-4.1-nano and gpt-3.5-turbo shut down on
//     2026-10-23; gpt-5 and gpt-5-mini shut down on 2026-12-11. The
//     documented replacements are the gpt-5.6 family (sol/terra/luna),
//     which support Chat Completions and are reasoning models (no
//     temperature is sent to them). gpt-4o, gpt-4o-mini, gpt-4.1 and
//     gpt-4.1-mini have no deprecation listed.

export const LLM_MODEL_OPTIONS = Object.freeze({
  openai: Object.freeze([
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }
  ]),
  claude: Object.freeze([
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-opus-5', name: 'Claude Opus 5' }
  ]),
  gemini: Object.freeze([
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }
  ])
});

export const DEFAULT_LLM_MODELS = Object.freeze({
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-5',
  gemini: 'gemini-2.5-flash'
});

const PROVIDER_MODEL_PREFIXES = Object.freeze({
  openai: 'gpt-',
  claude: 'claude-',
  gemini: 'gemini-'
});

// Stored model IDs that no longer exist upstream (or are scheduled to shut
// down), mapped to the replacement the provider documents. Order matters:
// the first matching pattern wins.
const RETIRED_MODEL_REPLACEMENTS = Object.freeze([
  [/^gemini-2\.0-flash-lite/, 'gemini-2.5-flash-lite'],
  [/^gemini-2\.0-/, 'gemini-2.5-flash'],
  [/^gemini-1\.5-pro/, 'gemini-2.5-pro'],
  [/^gemini-1\.5-/, 'gemini-2.5-flash'],
  [/^gemini-2\.5-pro-preview/, 'gemini-2.5-pro'],
  [/^gemini-2\.5-flash-preview/, 'gemini-2.5-flash'],
  [/^claude-3-opus/, 'claude-opus-5'],
  [/^claude-3(-5)?-haiku/, 'claude-haiku-4-5-20251001'],
  [/^claude-3/, 'claude-sonnet-5'],
  [/^claude-sonnet-4-\d{8}$/, 'claude-sonnet-5'],
  [/^claude-opus-4(-1)?-\d{8}$/, 'claude-opus-5'],
  [/^gpt-3\.5/, 'gpt-5.6-terra'],
  [/^gpt-4(-turbo|-\d{4})?(-preview)?$/, 'gpt-5.6-sol'],
  [/^gpt-4-turbo-/, 'gpt-5.6-sol'],
  [/^gpt-4\.1-nano/, 'gpt-5.6-luna'],
  [/^gpt-5-mini(-\d{4}-\d{2}-\d{2})?$/, 'gpt-5.6-terra'],
  [/^gpt-5(-\d{4}-\d{2}-\d{2})?$/, 'gpt-5.6-sol']
]);

// Returns the replacement for a retired model ID, or null if it is current.
function getRetiredModelReplacement(model) {
  const trimmed = String(model || '').trim();
  for (const [pattern, replacement] of RETIRED_MODEL_REPLACEMENTS) {
    if (pattern.test(trimmed)) {
      return replacement;
    }
  }
  return null;
}

/*
 * Explains what resolveProviderModel() will do with a stored value, so the
 * popup can tell the user and the request diagnostics can record it:
 *   null                                          — stored value used as-is
 *   { from, to, reason: 'wrong-provider' }        — llmModel held another
 *                                                   provider's model
 *   { from, to, reason: 'retired' }               — the provider retired it
 * Providers without a model rule (custom, libre) never migrate.
 */
export function describeModelMigration(provider, configuredModel) {
  const model = String(configuredModel || '').trim();
  const prefix = PROVIDER_MODEL_PREFIXES[provider];

  if (!prefix) {
    return null;
  }

  if (!model.startsWith(prefix)) {
    return { from: model, to: DEFAULT_LLM_MODELS[provider], reason: model ? 'wrong-provider' : 'unset' };
  }

  const replacement = getRetiredModelReplacement(model);
  return replacement ? { from: model, to: replacement, reason: 'retired' } : null;
}

// The model the request should actually name. llmModel is one setting
// shared by every provider, so it may hold another provider's model, or an
// ID the provider retired after it was stored; both resolve to something
// the provider accepts today. Unknown providers keep the configured value.
export function resolveProviderModel(provider, configuredModel) {
  const migration = describeModelMigration(provider, configuredModel);
  return migration ? migration.to : String(configuredModel || '').trim();
}

// OpenAI's reasoning models (gpt-5 family, o-series) reject any temperature
// other than the default.
export function openAiModelSupportsTemperature(model) {
  return !/^(gpt-5|gpt-6|o\d)/.test(String(model || '').trim());
}
