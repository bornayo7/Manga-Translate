// One source of truth for LLM provider models: what the popup offers, what
// each provider defaults to, and which stored IDs have application migration
// rules. Keep this file free of browser APIs; the popup, the service
// worker and the tests all import it.
//
// Documentation checked 2026-09-09; details and primary-source links are in
// docs/provider-qualification.md. All 13 picker IDs are documented, but this
// is not an authenticated inference or account-access guarantee.
// Known retired IDs and selected IDs with announced shutdowns migrate to
// application-chosen replacements. These are not always the provider's own
// recommended replacement. Unknown same-provider IDs remain user choices.

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

// Known retired or scheduled-for-shutdown IDs mapped to application choices
// that are documented as available. This is not a complete provider catalog.
// Order matters: the first matching pattern wins.
const RETIRED_MODEL_REPLACEMENTS = Object.freeze([
  [/^gemini-3-pro-preview$/, 'gemini-2.5-pro'],
  [/^gemini-3\.1-flash-lite-preview$/, 'gemini-2.5-flash-lite'],
  [/^gemini-2\.5-flash-lite-preview-09-2025$/, 'gemini-2.5-flash-lite'],
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

// Returns a known migration, or null when no application rule matches.
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
 *   null                                        — stored value used as-is;
 *                                                 availability not validated
 *   { from, to, reason: 'wrong-provider' }        — llmModel held another
 *                                                   provider's model
 *   { from, to, reason: 'retired' }               — retired or announced sunset
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
// ID covered by a migration rule. Unrecognized same-provider IDs pass through;
// the provider remains authoritative about their actual availability.
export function resolveProviderModel(provider, configuredModel) {
  const migration = describeModelMigration(provider, configuredModel);
  return migration ? migration.to : String(configuredModel || '').trim();
}

// Keep default sampling for reasoning families. The picker only requests a
// custom temperature for the non-reasoning GPT-4o and GPT-4.1 families.
export function openAiModelSupportsTemperature(model) {
  return !/^(gpt-5|gpt-6|o\d)/.test(String(model || '').trim());
}
