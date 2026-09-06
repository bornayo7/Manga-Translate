// One source of truth for LLM provider models: what the popup offers, what
// each provider defaults to, and which stored IDs the providers have since
// retired. Keep this file free of browser APIs; the popup, the service
// worker and the tests all import it.
//
// Checked against the provider model pages on 2026-09-06:
//   - Google: gemini-2.0-flash and gemini-2.0-flash-lite are shut down, the
//     1.5 generation and the 2.5-pro preview IDs are gone; 2.5 Flash, 2.5
//     Flash-Lite, 2.5 Pro and the 3.x Flash line are current.
//   - Anthropic: the Claude 3.x family and claude-sonnet-4-20250514 are
//     retired; claude-sonnet-5, claude-opus-5 and claude-haiku-4-5-20251001
//     are current.
//   - OpenAI: gpt-4, gpt-4-turbo, gpt-4.1-nano and gpt-3.5-turbo shut down
//     on 2026-10-23; gpt-4o, gpt-4o-mini, gpt-4.1(-mini) and gpt-5(-mini)
//     are current.

export const LLM_MODEL_OPTIONS = Object.freeze({
  openai: Object.freeze([
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
    { id: 'gpt-5', name: 'GPT-5' }
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

// Stored model IDs that no longer exist upstream, mapped to the closest
// current model. Order matters: the first matching pattern wins.
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
  [/^gpt-3\.5/, 'gpt-4o-mini'],
  [/^gpt-4(-turbo|-\d{4})?(-preview)?$/, 'gpt-4o'],
  [/^gpt-4\.1-nano/, 'gpt-4.1-mini']
]);

// Returns the replacement for a retired model ID, or null if it is current.
export function getRetiredModelReplacement(model) {
  const trimmed = String(model || '').trim();
  for (const [pattern, replacement] of RETIRED_MODEL_REPLACEMENTS) {
    if (pattern.test(trimmed)) {
      return replacement;
    }
  }
  return null;
}

// The model the request should actually name. llmModel is one setting
// shared by every provider, so it may hold another provider's model, or an
// ID the provider retired after it was stored; both resolve to something
// the provider accepts today. Unknown providers keep the configured value.
export function resolveProviderModel(provider, configuredModel) {
  const model = String(configuredModel || '').trim();
  const prefix = PROVIDER_MODEL_PREFIXES[provider];

  if (!prefix) {
    return model;
  }

  if (!model.startsWith(prefix)) {
    return DEFAULT_LLM_MODELS[provider];
  }

  return getRetiredModelReplacement(model) || model;
}

// OpenAI's reasoning models (gpt-5 family, o-series) reject any temperature
// other than the default.
export function openAiModelSupportsTemperature(model) {
  return !/^(gpt-5|gpt-6|o\d)/.test(String(model || '').trim());
}
