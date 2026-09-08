import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LLM_MODELS,
  LLM_MODEL_OPTIONS,
  describeModelMigration,
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

test('every offered model resolves to itself, so none is on the retired list', () => {
  for (const [provider, models] of Object.entries(LLM_MODEL_OPTIONS)) {
    for (const model of models) {
      assert.equal(resolveProviderModel(provider, model.id), model.id, `${model.id} is listed but retired`);
      assert.equal(describeModelMigration(provider, model.id), null);
    }
  }
});

test('the picker no longer offers models with an announced shutdown', () => {
  // OpenAI deprecations page, read 2026-09-07: gpt-5 / gpt-5-mini shut down
  // 2026-12-11, gpt-4.1-nano 2026-10-23.
  const openai = LLM_MODEL_OPTIONS.openai.map((model) => model.id);
  for (const retired of ['gpt-5', 'gpt-5-mini', 'gpt-4.1-nano', 'gpt-4', 'gpt-3.5-turbo']) {
    assert.equal(openai.includes(retired), false, `${retired} is still offered`);
  }
  const gemini = LLM_MODEL_OPTIONS.gemini.map((model) => model.id);
  assert.equal(gemini.includes('gemini-2.0-flash'), false);
  const claude = LLM_MODEL_OPTIONS.claude.map((model) => model.id);
  assert.equal(claude.includes('claude-sonnet-4-20250514'), false);
});

test('retired IDs stored by older builds resolve to the replacement the provider documents', () => {
  assert.equal(resolveProviderModel('gemini', 'gemini-2.0-flash'), 'gemini-2.5-flash');
  assert.equal(resolveProviderModel('gemini', 'gemini-2.0-flash-lite'), 'gemini-2.5-flash-lite');
  assert.equal(resolveProviderModel('gemini', 'gemini-1.5-flash'), 'gemini-2.5-flash');
  assert.equal(resolveProviderModel('gemini', 'gemini-2.5-pro-preview-06-05'), 'gemini-2.5-pro');
  assert.equal(resolveProviderModel('claude', 'claude-sonnet-4-20250514'), 'claude-sonnet-5');
  assert.equal(resolveProviderModel('claude', 'claude-3-5-sonnet-20241022'), 'claude-sonnet-5');
  assert.equal(resolveProviderModel('claude', 'claude-3-opus-20240229'), 'claude-opus-5');
  assert.equal(resolveProviderModel('claude', 'claude-3-haiku-20240307'), 'claude-haiku-4-5-20251001');
  assert.equal(resolveProviderModel('openai', 'gpt-3.5-turbo'), 'gpt-5.6-terra');
  assert.equal(resolveProviderModel('openai', 'gpt-4'), 'gpt-5.6-sol');
  assert.equal(resolveProviderModel('openai', 'gpt-4-turbo'), 'gpt-5.6-sol');
  assert.equal(resolveProviderModel('openai', 'gpt-4.1-nano'), 'gpt-5.6-luna');
  assert.equal(resolveProviderModel('openai', 'gpt-5'), 'gpt-5.6-sol');
  assert.equal(resolveProviderModel('openai', 'gpt-5-2025-08-07'), 'gpt-5.6-sol');
  assert.equal(resolveProviderModel('openai', 'gpt-5-mini'), 'gpt-5.6-terra');
});

test('describeModelMigration reports why a stored value is not what gets sent', () => {
  assert.deepEqual(describeModelMigration('gemini', 'gemini-2.0-flash'), {
    from: 'gemini-2.0-flash',
    to: 'gemini-2.5-flash',
    reason: 'retired'
  });
  assert.deepEqual(describeModelMigration('openai', 'gemini-2.5-flash'), {
    from: 'gemini-2.5-flash',
    to: 'gpt-4o-mini',
    reason: 'wrong-provider'
  });
  assert.deepEqual(describeModelMigration('claude', ''), {
    from: '',
    to: 'claude-sonnet-5',
    reason: 'unset'
  });
  assert.equal(describeModelMigration('custom', 'gemini-2.0-flash'), null, 'custom models are never migrated');
  assert.equal(describeModelMigration('libre', ''), null);
});

test('current and unknown-but-plausible IDs pass through untouched', () => {
  assert.equal(resolveProviderModel('claude', 'claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5-20250929');
  assert.equal(resolveProviderModel('openai', 'gpt-4.1-mini'), 'gpt-4.1-mini');
  assert.equal(resolveProviderModel('openai', 'gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(resolveProviderModel('custom', 'llama3'), 'llama3');
  assert.equal(resolveProviderModel('openai', ''), 'gpt-4o-mini');
});

test('temperature is only sent to OpenAI models that accept it', () => {
  assert.equal(openAiModelSupportsTemperature('gpt-4o-mini'), true);
  assert.equal(openAiModelSupportsTemperature('gpt-4.1'), true);
  assert.equal(openAiModelSupportsTemperature('gpt-5.6-terra'), false);
  assert.equal(openAiModelSupportsTemperature('gpt-5-mini'), false);
  assert.equal(openAiModelSupportsTemperature('o3'), false);
});
