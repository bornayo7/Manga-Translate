/**
 * =============================================================================
 * TRANSLATION MANAGER — The Central Hub for All Translation Providers
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * This is the "router" for translation requests. After OCR extracts text from
 * an image, that text needs to be translated into the user's target language.
 * This module picks the right translation provider based on the user's settings
 * and sends the text to be translated.
 *
 * AVAILABLE PROVIDERS:
 * --------------------
 *   1. OpenAI (GPT) — LLM-based translation. Excellent for context-aware
 *      translation of manga, slang, idioms. Requires API key, costs per token.
 *
 *   2. Claude (Anthropic) — Similar to OpenAI but from Anthropic. Also great
 *      for contextual/manga translation. Requires API key.
 *
 *   3. LibreTranslate / MyMemory — Free, no API key needed. Quality varies
 *      by language pair. Good as a free fallback.
 *
 * NORMALIZED OUTPUT:
 * ------------------
 * All providers return the same format:
 *   {
 *     translations: ["translated text 1", "translated text 2", ...],
 *     sourceLang: "ja",      // detected or specified source language
 *     targetLang: "en",      // target language
 *     provider: "openai"     // which provider was used
 *   }
 *
 * The translations array is in the SAME ORDER as the input texts array.
 * This is critical — we use array index to match translations back to their
 * original bounding boxes for overlay rendering.
 *
 * USAGE:
 * ------
 *   import { translateTexts } from './translate/translate-manager.js';
 *
 *   const result = await translateTexts(
 *     ["こんにちは", "世界"],   // texts to translate
 *     "auto",                   // source language ("auto" for auto-detect)
 *     "en",                     // target language
 *     settings                  // user settings (contains provider choice + keys)
 *   );
 * =============================================================================
 */

import { translateWithLLM } from './llm-translate.js';
import { translateWithLibre } from './libre-translate.js';

function normalizeForComparison(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isEffectivelyIdenticalTranslation(sourceText, translatedText) {
  return normalizeForComparison(sourceText) === normalizeForComparison(translatedText);
}

function previewText(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

/**
 * Main entry point for translation. Routes to the configured provider.
 *
 * @param {string[]} texts       — Array of text strings to translate
 * @param {string}   sourceLang  — Source language code ("auto", "ja", "zh", etc.)
 * @param {string}   targetLang  — Target language code ("en", "es", "fr", etc.)
 * @param {Object}   settings    — User settings from chrome.storage
 * @returns {Promise<Object>}    — { translations: string[], sourceLang, targetLang, provider }
 */
export async function translateTexts(texts, sourceLang, targetLang, settings = {}) {
  /*
   * Guard: If there's nothing to translate, return immediately.
   * This can happen if OCR found bounding boxes but couldn't read any text.
   */
  if (!texts || texts.length === 0) {
    return {
      translations: [],
      sourceLang,
      targetLang,
      provider: 'none'
    };
  }

  /*
   * Filter out empty/whitespace-only strings but keep track of their
   * original indices. We'll put empty strings back in the right spots
   * after translation so the array stays aligned with bounding boxes.
   */
  const indexMap = [];      // Maps filtered index → original index
  const filteredTexts = []; // Non-empty texts to actually translate

  for (let i = 0; i < texts.length; i++) {
    const trimmed = (texts[i] || '').trim();
    if (trimmed.length > 0) {
      indexMap.push(i);
      filteredTexts.push(trimmed);
    }
  }

  /*
   * If ALL texts were empty after filtering, return empty translations.
   */
  if (filteredTexts.length === 0) {
    return {
      translations: texts.map(() => ''),
      sourceLang,
      targetLang,
      provider: 'none'
    };
  }

  /*
   * Determine which provider to use. The setting is stored as a string
   * like "openai", "claude", or "libre".
   */
  const requestedProvider = settings.translationProvider || 'libre';
  const provider = requestedProvider === 'google' ? 'libre' : requestedProvider;

  let result;

  console.log('[VisionTranslate Translation] Dispatching translation request', {
    requestedProvider,
    resolvedProvider: provider,
    sourceLang,
    targetLang,
    textCount: filteredTexts.length,
    texts: filteredTexts.map((text, index) => ({
      index,
      sourcePreview: previewText(text)
    }))
  });

  try {
    switch (provider) {
      case 'openai': {
        const apiKey = settings.openaiApiKey;
        if (!apiKey) {
          throw new Error(
            'OpenAI translation requires an API key. ' +
            'Please add your key in the extension settings.'
          );
        }
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          apiKey,
          'openai',
          settings.llmModel || 'gpt-4o-mini'
        );
        break;
      }

      case 'claude': {
        const apiKey = settings.claudeApiKey;
        if (!apiKey) {
          throw new Error(
            'Claude translation requires an API key. ' +
            'Please add your key in the extension settings.'
          );
        }
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          apiKey,
          'claude',
          settings.llmModel || 'claude-sonnet-4-20250514'
        );
        break;
      }

      case 'gemini': {
        const apiKey = settings.geminiApiKey;
        if (!apiKey) {
          throw new Error(
            'Gemini translation requires an API key. ' +
            'Please add your key in the extension settings.'
          );
        }
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          apiKey,
          'gemini',
          settings.llmModel || 'gemini-2.0-flash'
        );
        break;
      }

      case 'custom': {
        const rawBaseUrl = (settings.customBaseUrl || '').trim();
        const baseUrl = rawBaseUrl.replace(/\/+$/, '');
        if (!baseUrl) {
          throw new Error(
            'Custom API requires a base URL. ' +
            'Please add your API base URL in the extension settings.'
          );
        }
        const modelName = settings.customModelName || 'default';
        result = await translateWithLLM(
          filteredTexts,
          sourceLang,
          targetLang,
          settings.customApiKey || '',
          'custom',
          modelName,
          baseUrl
        );
        break;
      }

      case 'libre':
      default: {
        /*
         * LibreTranslate is the free fallback — no API key needed.
         * If the user hasn't configured anything, we land here.
         */
        if (requestedProvider === 'google') {
          console.warn('[VisionTranslate] Google Cloud Translation has been removed. Falling back to LibreTranslate.');
        }
        result = await translateWithLibre(filteredTexts, sourceLang, targetLang);
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[VisionTranslate] Translation failed with provider "${provider}":`, error);

    /*
     * If the primary provider fails, try the free fallback (unless that's
     * what already failed). This gives users a degraded but still-functional
     * experience if their API key expires or they hit a quota limit.
     */
    if (provider !== 'libre') {
      console.warn('[VisionTranslate] Falling back to LibreTranslate...');
      try {
        result = await translateWithLibre(filteredTexts, sourceLang, targetLang);
        result.fallback = true;
        result.originalError = errorMessage;
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error('[VisionTranslate] Fallback also failed:', fallbackError);
        throw new Error(
          `Translation failed: ${errorMessage}. ` +
          `Fallback also failed: ${fallbackErrorMessage}`
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
      identicalEntries: identicalEntries.map((entry) => ({
        index: entry.index,
        sourcePreview: previewText(entry.source),
        translationPreview: previewText(entry.translation)
      }))
    });
  }

  /*
   * Re-insert empty strings at the original positions so the translations
   * array lines up exactly with the input texts array.
   *
   * Example:
   *   Input texts:     ["Hello", "", "World", ""]
   *   Filtered texts:  ["Hello", "World"]     (indices 0, 2)
   *   Translations:    ["Hola", "Mundo"]
   *   Final output:    ["Hola", "", "Mundo", ""]
   */
  const translatedItems = Array.isArray(result.translations) ? result.translations : [];
  const fullTranslations = new Array(texts.length).fill('');
  for (let i = 0; i < indexMap.length; i++) {
    fullTranslations[indexMap[i]] = translatedItems[i] || '';
  }

  return {
    translations: fullTranslations,
    sourceLang: result.sourceLang || sourceLang,
    targetLang: result.targetLang || targetLang,
    provider: result.provider || provider,
    fallback: result.fallback || false,
    originalError: result.originalError || null,
    diagnostics: {
      requestedProvider,
      providerUsed: result.provider || provider,
      fallbackUsed: Boolean(result.fallback),
      identicalCount: identicalEntries.length,
      identicalIndices: identicalEntries.map((entry) => entry.index)
    }
  };
}

/**
 * LANGUAGE CODE REFERENCE:
 * ========================
 * Most translation APIs use ISO 639-1 two-letter codes:
 *
 *   "auto" — Auto-detect (let the API figure out the source language)
 *   "en"   — English
 *   "ja"   — Japanese
 *   "zh"   — Chinese (Simplified)
 *   "zh-TW"— Chinese (Traditional)
 *   "ko"   — Korean
 *   "es"   — Spanish
 *   "fr"   — French
 *   "de"   — German
 *   "pt"   — Portuguese
 *   "ru"   — Russian
 *   "ar"   — Arabic
 *   "hi"   — Hindi
 *   "th"   — Thai
 *   "vi"   — Vietnamese
 *   "it"   — Italian
 *
 * Some APIs (Google, DeepL) support "auto" for source; others require an
 * explicit language. Our provider wrappers handle this mapping internally.
 */
