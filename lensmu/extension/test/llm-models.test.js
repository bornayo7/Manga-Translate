import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LLM_MODELS,
  LLM_MODEL_OPTIONS,
  getRetiredModelReplacement,
  openAiModelSupportsTemperature,
  resolveProviderModel
} from '../shared/llm-models.js';
import { DEFAULT_EXTENSION_SETTINGS } from '../shared/preferences.js';

test('every provider default is one of the models the popup offers', () => {
  for (const [provider, models] of Object.entries(LLM_MODEL_OPTIONS)) {
    assert.ok(
      models.some((model) => model.id === DEFAULT_LLM_MODELS[provider]),
      `${provider} default ${DEFAULT_LLM_MODELS[provider]} is not in its picker`
    );
  }
  assert.equal(DEFAULT_EXTENSION_SETTINGS.llmModel, DEFAULT_LLM_MODELS.gemini);
});

test('no offered model is itself on the retired list', () => {
  for (const models of Object.values(LLM_MODEL_OPTIONS)) {
    for (const model of models) {
      assert.equal(getRetiredModelReplacement(model.id), null, `${model.id} is listed but retired`);
    }
  }
});

test('retired IDs stored by older builds resolve to a current model of the same provider', () => {
  assert.equal(resolveProviderModel('gemini', 'gemini-2.0-flash'), 'gemini-2.5-flash');
  assert.equal(resolveProviderModel('gemini', 'gemini-2.0-flash-lite'), 'gemini-2.5-flash-lite');
  assert.equal(resolveProviderModel('gemini', 'gemini-1.5-flash'), 'gemini-2.5-flash');
  assert.equal(resolveProviderModel('gemini', 'gemini-2.5-pro-preview-06-05'), 'gemini-2.5-pro');
  assert.equal(resolveProviderModel('claude', 'claude-sonnet-4-20250514'), 'claude-sonnet-5');
  assert.equal(resolveProviderModel('claude', 'claude-3-5-sonnet-20241022'), 'claude-sonnet-5');
  assert.equal(resolveProviderModel('claude', 'claude-3-opus-20240229'), 'claude-opus-5');
  assert.equal(resolveProviderModel('claude', 'claude-3-haiku-20240307'), 'claude-haiku-4-5-20251001');
  assert.equal(resolveProviderModel('openai', 'gpt-3.5-turbo'), 'gpt-4o-mini');
  assert.equal(resolveProviderModel('openai', 'gpt-4'), 'gpt-4o');
  assert.equal(resolveProviderModel('openai', 'gpt-4-turbo'), 'gpt-4o');
});

test('current and unknown-but-plausible IDs pass through untouched', () => {
  assert.equal(resolveProviderModel('claude', 'claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5-20250929');
  assert.equal(resolveProviderModel('openai', 'gpt-4.1-mini'), 'gpt-4.1-mini');
  assert.equal(resolveProviderModel('openai', 'gpt-5'), 'gpt-5');
  assert.equal(resolveProviderModel('custom', 'llama3'), 'llama3');
  assert.equal(resolveProviderModel('openai', ''), 'gpt-4o-mini');
});

test('temperature is only sent to OpenAI models that accept it', () => {
  assert.equal(openAiModelSupportsTemperature('gpt-4o-mini'), true);
  assert.equal(openAiModelSupportsTemperature('gpt-4.1'), true);
  assert.equal(openAiModelSupportsTemperature('gpt-5-mini'), false);
  assert.equal(openAiModelSupportsTemperature('o3'), false);
});
