/**
 * =============================================================================
 * TRANSLATION MANAGER - The Central Hub for All Translation Providers
 * =============================================================================
 *
 * This module routes translation requests to the configured provider.
 * It also skips OCR blocks that already appear to be in the target language
 * before any provider call is made, and reports a per-block outcome so the
 * content script can show "already in the target language" as a neutral
 * state instead of a provider failure.
 */

import { translateWithLLM } from './llm-translate.js';
import { translateWithMyMemory } from './libre-translate.js';
import { isEffectivelyIdenticalTranslation, trimTrailingSlashes } from '../shared/text.js';
import { describeModelMigration, resolveProviderModel } from '../shared/llm-models.js';
import {
  TARGET_LANGUAGE_SKIP_THRESHOLD,
  getTargetLanguageConfidence,
  hasOnlyNonTranslatableCharacters,
  normalizeLanguageCode
} from '../shared/language-detection.js';

export { normalizeLanguageCode };

/**
 * Decide whether one OCR block should be translated.
 *
 * Order matters:
 *   1. Nothing translatable (punctuation, digits) is skipped.
 *   2. An explicit source language is respected before any heuristic: equal
 *      to the target → skip; different from the target → translate, even
 *      when the script could also belong to the target (Chinese → Japanese
 *      shares Han characters, and the old order misread it as "already
 *      Japanese").
 *   3. With source "auto", the block is skipped only when the script or
 *      stop-word evidence for the target is decisive. Han-only text is
 *      ambiguous between Chinese and Japanese and is sent to the provider.
 */
export function shouldTranslateTextBlock(text, targetLanguage = 'en', sourceLanguage = 'auto') {
  const normalizedText = String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage || 'en');
  const normalizedSourceLanguage = normalizeLanguageCode(sourceLanguage || 'auto');

  if (hasOnlyNonTranslatableCharacters(normalizedText)) {
    return {
      translate: false,
      reason: 'empty-or-non-text',
      targetConfidence: 1
    };
  }

  const evidence = getTargetLanguageConfidence(normalizedText, normalizedTargetLanguage);
  const targetConfidence = evidence.confidence;

  if (normalizedSourceLanguage && normalizedSourceLanguage !== 'auto') {
    if (normalizedSourceLanguage === normalizedTargetLanguage) {
      return {
        translate: false,
        reason: 'source-matches-target-language',
        targetConfidence: Math.max(targetConfidence, 0.9)
      };
    }

    return {
      translate: true,
      reason: 'source-language-differs-from-target',
      targetConfidence
    };
  }

  if (!evidence.ambiguous && targetConfidence >= TARGET_LANGUAGE_SKIP_THRESHOLD) {
    return {
      translate: false,
      reason: 'already-target-language',
      targetConfidence
    };
  }

  return {
    translate: true,
    reason: evidence.ambiguous ? 'ambiguous-script' : 'needs-translation',
    targetConfidence
  };
}

function buildOutcomes(count) {
  return Array.from({ length: count }, () => ({ status: 'translated', reason: '' }));
}

/**
 * Main entry point for translation. Routes to the configured provider.
 *
 * @param {string[]} texts - Array of text strings to translate.
 * @param {string} sourceLang - Source language code.
 * @param {string} targetLang - Target language code.
 * @param {Object} settings - User settings from chrome.storage.
 * @param {Object} [options] - { signal?: AbortSignal } to cancel provider requests.
 * @returns {Promise<Object>} { translations, outcomes, sourceLang, targetLang, provider, ... }
 *   outcomes[i].status is one of "translated" | "skipped" | "failed"; a
 *   skipped block was intentionally not sent (already in the target
 *   language, or no translatable text); a failed block was requested but
 *   the provider returned nothing for it.
 */
export async function translateTexts(texts, sourceLang, targetLang, settings = {}, options = {}) {
  const signal = options.signal || undefined;

  if (!texts || texts.length === 0) {
    return {
      translations: [],
      outcomes: [],
      sourceLang,
      targetLang,
      provider: 'none'
    };
  }

  const indexMap = [];
  const filteredTexts = [];
  const skippedEntries = [];
  const outcomes = buildOutcomes(texts.length);

  for (let i = 0; i < texts.length; i++) {
    const trimmed = (texts[i] || '').trim();
    const decision = shouldTranslateTextBlock(trimmed, targetLang, sourceLang);

    if (trimmed.length > 0 && decision.translate) {
      indexMap.push(i);
      filteredTexts.push(trimmed);
    } else {
      const reason = trimmed.length > 0 ? decision.reason : 'empty-or-non-text';
      outcomes[i] = { status: 'skipped', reason };
      skippedEntries.push({
        index: i,
        reason,
        targetConfidence: decision.targetConfidence
      });
    }
  }

  const requestedProvider = settings.translationProvider || 'libre';
  const provider = requestedProvider === 'google' ? 'libre' : requestedProvider;

  if (filteredTexts.length === 0) {
    console.log('[VisionTranslate Translation] Skipped all OCR text blocks before translation', {
      sourceLang,
      targetLang,
      skippedCount: skippedEntries.length,
      skippedEntries
    });

    return {
      translations: texts.map(() => ''),
      outcomes,
      sourceLang,
      targetLang,
      provider: 'none',
      diagnostics: {
        requestedProvider,
        providerUsed: 'none',
        fallbackUsed: false,
        identicalCount: 0,
        identicalIndices: [],
        failedIndices: [],
        skippedTargetLanguageCount: skippedEntries.length,
        skippedTargetLanguageIndices: skippedEntries.map((entry) => entry.index),
        skippedEntries
      }
    };
  }

  let result;
  let modelMigration = null;

  console.log('[VisionTranslate Translation] Dispatching translation request', {
    requestedProvider,
    resolvedProvider: provider,
    sourceLang,
    targetLang,
    originalTextCount: texts.length,
    textCount: filteredTexts.length,
    skippedCount: skippedEntries.length,
    skippedEntries: skippedEntries.map((entry) => ({
      index: entry.index,
      reason: entry.reason,
      targetConfidence: Number(entry.targetConfidence.toFixed(2)),
      characterCount: String(texts[entry.index] || '').length
    })),
    characterCount: filteredTexts.reduce((total, text) => total + text.length, 0)
  });

  const llmModelFor = (llmProvider) => {
    modelMigration = describeModelMigration(llmProvider, settings.llmModel);
    if (modelMigration && modelMigration.reason === 'retired') {
      console.warn(
        `[VisionTranslate] The stored ${llmProvider} model "${modelMigration.from}" was retired by the provider; using "${modelMigration.to}".`
      );
    }
    return resolveProviderModel(llmProvider, settings.llmModel);
  };

  try {
    switch (provider) {
      case 'openai': {
        const apiKey = settings.openaiApiKey;
        if (!apiKey) {
          throw new Error(
            'OpenAI translation requires an API key. Please add your key in the extension settings.'
          );
        }
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          apiKey,
          'openai',
          llmModelFor('openai'),
          undefined,
          { signal }
        );
        break;
      }

      case 'claude': {
        const apiKey = settings.claudeApiKey;
        if (!apiKey) {
          throw new Error(
            'Claude translation requires an API key. Please add your key in the extension settings.'
          );
        }
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          apiKey,
          'claude',
          llmModelFor('claude'),
          undefined,
          { signal }
        );
        break;
      }

      case 'gemini': {
        const apiKey = settings.geminiApiKey;
        if (!apiKey) {
          throw new Error(
            'Gemini translation requires an API key. Please add your key in the extension settings.'
          );
        }
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          apiKey,
          'gemini',
          llmModelFor('gemini'),
          undefined,
          { signal }
        );
        break;
      }

      case 'custom': {
        const baseUrl = trimTrailingSlashes(settings.customBaseUrl);
        if (!baseUrl) {
          throw new Error(
            'Custom API requires a base URL. Please add your API base URL in the extension settings.'
          );
        }
        // Local servers (Ollama, LM Studio, vLLM) legitimately run without a
        // key; the empty string is passed through and no header is sent.
        const modelName = settings.customModelName || 'default';
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          settings.customApiKey || '',
          'custom',
          modelName,
          baseUrl,
          { signal }
        );
        break;
      }

      case 'libre':
      default: {
        if (requestedProvider === 'google') {
          console.warn('[VisionTranslate] Google Cloud Translation has been removed. Using MyMemory.');
        }
        result = await translateWithMyMemory(filteredTexts, sourceLang, targetLang, { signal });
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // A cancelled request is not a provider failure; never fall back for it.
    if (signal?.aborted || error?.name === 'AbortError') {
      throw error;
    }

    console.error(`[VisionTranslate] Translation failed with provider "${provider}":`, error);

    if (provider !== 'libre' && settings.allowThirdPartyFallback === true) {
      console.warn('[VisionTranslate] User-enabled third-party fallback is being used.');
      try {
        result = await translateWithMyMemory(filteredTexts, sourceLang, targetLang, { signal });
        result.fallback = true;
        result.originalError = errorMessage;
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
        console.error('[VisionTranslate] Fallback also failed:', fallbackError);
        throw new Error(
          `Translation failed: ${errorMessage}. Fallback also failed: ${fallbackErrorMessage}`
        );
      }
    } else {
      throw error;
    }
  }

  if (!result || !Array.isArray(result.translations)) {
    throw new Error('Translation provider returned an invalid response.');
  }

  if (result.translations.length !== filteredTexts.length) {
    throw new Error(
      `Translation provider returned ${result.translations.length} items for ` +
      `${filteredTexts.length} requested texts.`
    );
  }

  const identicalEntries = result.translations
    .map((translation, index) => ({
      index,
      originalIndex: indexMap[index],
      source: filteredTexts[index],
      translation: String(translation || '').trim(),
      identical: isEffectivelyIdenticalTranslation(filteredTexts[index], translation)
    }))
    .filter((entry) => entry.identical && entry.translation.length > 0);

  if (identicalEntries.length > 0) {
    console.warn('[VisionTranslate Translation] Provider returned identical text for some entries', {
      requestedProvider,
      providerUsed: result.provider || provider,
      sourceLang: result.sourceLang || sourceLang,
      targetLang: result.targetLang || targetLang,
      identicalCount: identicalEntries.length,
      identicalIndices: identicalEntries.map((entry) => entry.originalIndex)
    });
  }

  const fullTranslations = new Array(texts.length).fill('');
  const failedIndices = [];
  for (let i = 0; i < indexMap.length; i++) {
    const translation = String(result.translations[i] || '').trim();
    fullTranslations[indexMap[i]] = translation;
    if (!translation) {
      // Requested, present in the provider's answer, but empty: this block
      // failed. It is not "skipped" — the user asked for it.
      outcomes[indexMap[i]] = { status: 'failed', reason: 'empty-provider-output' };
      failedIndices.push(indexMap[i]);
    }
  }

  if (failedIndices.length === indexMap.length) {
    throw new Error(
      `${result.provider || provider} returned no translated text for any of the ${indexMap.length} requested blocks.`
    );
  }

  return {
    translations: fullTranslations,
    outcomes,
    sourceLang: result.sourceLang || sourceLang,
    targetLang: result.targetLang || targetLang,
    provider: result.provider || provider,
    fallback: result.fallback || false,
    originalError: result.originalError || null,
    diagnostics: {
      requestedProvider,
      providerUsed: result.provider || provider,
      fallbackUsed: Boolean(result.fallback),
      modelMigration,
      identicalCount: identicalEntries.length,
      identicalIndices: identicalEntries.map((entry) => entry.originalIndex),
      failedIndices,
      skippedTargetLanguageCount: skippedEntries.length,
      skippedTargetLanguageIndices: skippedEntries.map((entry) => entry.index),
      skippedEntries,
      retryCount: result.retryCount || 0
    }
  };
}
