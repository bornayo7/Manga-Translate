/**
 * =============================================================================
 * TRANSLATION MANAGER - The Central Hub for All Translation Providers
 * =============================================================================
 *
 * This module routes translation requests to the configured provider.
 * It also skips OCR blocks that already appear to be in the target language
 * before any provider call is made.
 */

import { translateWithLLM } from './llm-translate.js';
import { translateWithMyMemory } from './libre-translate.js';
import { isEffectivelyIdenticalTranslation } from '../shared/text.js';

const PROVIDER_MODEL_RULES = Object.freeze({
  openai: { prefix: 'gpt-', fallback: 'gpt-4o-mini' },
  claude: { prefix: 'claude-', fallback: 'claude-sonnet-4-20250514' },
  gemini: { prefix: 'gemini-', fallback: 'gemini-2.0-flash' }
});

export function resolveProviderModel(provider, configuredModel) {
  const rule = PROVIDER_MODEL_RULES[provider];
  if (!rule) {
    return String(configuredModel || '').trim();
  }

  const model = String(configuredModel || '').trim();
  return model.startsWith(rule.prefix) ? model : rule.fallback;
}

const LANGUAGE_ALIASES = {
  english: 'en',
  eng: 'en',
  spanish: 'es',
  spa: 'es',
  japanese: 'ja',
  jpn: 'ja',
  chinese: 'zh',
  mandarin: 'zh',
  korean: 'ko',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  italian: 'it',
  russian: 'ru',
  arabic: 'ar',
  hindi: 'hi',
  thai: 'th',
  vietnamese: 'vi',
  auto: 'auto',
  autodetect: 'auto',
  automatic: 'auto'
};

const SCRIPT_LANGUAGE_RULES = {
  ja: {
    pattern: /[\u3040-\u30ff]/g,
    fallbackPattern: /[\u3400-\u9fff]/g,
    threshold: 0.08,
    fallbackThreshold: 0.35
  },
  zh: {
    pattern: /[\u3400-\u9fff]/g,
    threshold: 0.3
  },
  ko: {
    pattern: /[\uac00-\ud7af]/g,
    threshold: 0.15
  },
  ru: {
    pattern: /[\u0400-\u04ff]/g,
    threshold: 0.25
  },
  ar: {
    pattern: /[\u0600-\u06ff]/g,
    threshold: 0.2
  },
  hi: {
    pattern: /[\u0900-\u097f]/g,
    threshold: 0.2
  },
  th: {
    pattern: /[\u0e00-\u0e7f]/g,
    threshold: 0.2
  }
};

const LATIN_LANGUAGE_PROFILES = {
  en: {
    stopWords: [
      'a', 'about', 'above', 'after', 'again', 'all', 'also', 'although', 'am',
      'an', 'and', 'any', 'are', 'as', 'at', 'away', 'back', 'be', 'because',
      'been', 'before', 'between', 'but', 'by', 'came', 'can', 'clear',
      'climbed', 'cold', 'could', 'day', 'did', 'down', 'due', 'east',
      'eastward', 'even', 'few', 'for', 'from', 'gray', 'had', 'has', 'have',
      'he', 'her', 'here', 'him', 'himself', 'his', 'i', 'if', 'in', 'into',
      'is', 'it', 'its', 'just', 'lack', 'left', 'line', 'little', 'looking',
      'made', 'main', 'man', 'many', 'more', 'must', 'no', 'nor', 'not', 'of',
      'on', 'one', 'or', 'over', 'reaching', 'right', 'seemed', 'seen', 'she',
      'should', 'sky', 'south', 'steep', 'still', 'sun', 'that', 'the',
      'their', 'them', 'then', 'there', 'these', 'they', 'things', 'this',
      'though', 'through', 'to', 'trail', 'up', 'upon', 'us', 'used', 'was',
      'watch', 'we', 'were', 'when', 'where', 'which', 'who', 'will', 'with',
      'without', 'would', 'you', 'your'
    ],
    penaltyPattern: /[àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ¿¡]/i
  },
  es: {
    stopWords: [
      'a', 'al', 'algo', 'aunque', 'cada', 'como', 'con', 'cuando', 'de',
      'del', 'desde', 'dia', 'el', 'ella', 'ellos', 'en', 'era', 'eran', 'es',
      'ese', 'esta', 'estaba', 'estaban', 'este', 'esto', 'frio', 'gris',
      'habia', 'habian', 'hacia', 'hasta', 'hombre', 'la', 'las', 'le', 'lo',
      'los', 'mas', 'me', 'mi', 'muy', 'ni', 'no', 'para', 'pero', 'por',
      'que', 'se', 'si', 'sin', 'sol', 'su', 'sus', 'un', 'una', 'unas',
      'unos', 'y', 'ya'
    ],
    markerPattern: /[áéíóúüñ¿¡]/i
  },
  fr: {
    stopWords: [
      'a', 'ai', 'au', 'aux', 'avec', 'ce', 'ces', 'dans', 'de', 'des', 'du',
      'elle', 'en', 'est', 'et', 'il', 'je', 'la', 'le', 'les', 'leur', 'mais',
      'ne', 'nous', 'pas', 'pour', 'que', 'qui', 'se', 'son', 'sur', 'tu',
      'un', 'une', 'vous'
    ],
    markerPattern: /[àâçéèêëîïôûùüÿœ]/i
  },
  de: {
    stopWords: [
      'aber', 'als', 'am', 'auf', 'aus', 'bei', 'das', 'dem', 'den', 'der',
      'des', 'die', 'du', 'ein', 'eine', 'einem', 'einen', 'einer', 'er', 'es',
      'für', 'hat', 'ich', 'im', 'in', 'ist', 'mit', 'nicht', 'sie', 'und',
      'von', 'war', 'wir', 'zu'
    ],
    markerPattern: /[äöüß]/i
  },
  pt: {
    stopWords: [
      'a', 'ao', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e',
      'ela', 'ele', 'em', 'era', 'estava', 'eu', 'foi', 'mais', 'mas', 'na',
      'não', 'no', 'o', 'os', 'para', 'por', 'que', 'se', 'sem', 'um', 'uma'
    ],
    markerPattern: /[áâãàçéêíóôõúü]/i
  },
  it: {
    stopWords: [
      'a', 'al', 'alla', 'che', 'con', 'da', 'del', 'della', 'di', 'e', 'era',
      'gli', 'ha', 'ho', 'il', 'in', 'io', 'la', 'le', 'lo', 'ma', 'mi',
      'non', 'per', 'piu', 'più', 'si', 'sono', 'su', 'un', 'una'
    ],
    markerPattern: /[àèéìíîòóùú]/i
  },
  vi: {
    stopWords: [
      'anh', 'ban', 'bạn', 'cua', 'của', 'da', 'đã', 'de', 'để', 'duoc',
      'được', 'la', 'là', 'mot', 'một', 'nay', 'này', 'toi', 'tôi', 'trong',
      'va', 'và', 'voi', 'với'
    ],
    markerPattern:
      /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i
  }
};

function normalizeLanguageCode(languageCode) {
  const normalized = String(languageCode || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/^zh-cn$/, 'zh')
    .replace(/^zh-hans$/, 'zh')
    .replace(/^zh-tw$/, 'zh')
    .replace(/^zh-hant$/, 'zh');

  if (!normalized) {
    return 'auto';
  }

  if (LANGUAGE_ALIASES[normalized]) {
    return LANGUAGE_ALIASES[normalized];
  }

  const baseLanguage = normalized.split('-')[0];
  return LANGUAGE_ALIASES[baseLanguage] || baseLanguage;
}

function countRegexMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function getLetterCount(text) {
  const matches = String(text || '').match(/\p{L}/gu);
  return matches ? matches.length : 0;
}

function foldDiacritics(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getLatinWords(text) {
  return (
    String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .match(/[a-zÀ-ÿ]+(?:['’][a-zÀ-ÿ]+)?/g) || []
  );
}

function getScriptLanguageConfidence(text, languageCode) {
  const rules = SCRIPT_LANGUAGE_RULES[languageCode];
  if (!rules) {
    return 0;
  }

  const totalLetters = Math.max(1, getLetterCount(text));
  const primaryRatio = countRegexMatches(text, rules.pattern) / totalLetters;

  if (primaryRatio >= rules.threshold) {
    return Math.min(1, primaryRatio / Math.max(rules.threshold, 0.01));
  }

  if (rules.fallbackPattern) {
    const fallbackRatio = countRegexMatches(text, rules.fallbackPattern) / totalLetters;
    if (fallbackRatio >= rules.fallbackThreshold) {
      return Math.min(0.75, fallbackRatio / Math.max(rules.fallbackThreshold, 0.01));
    }
  }

  return 0;
}

function scoreLatinLanguage(text, languageCode) {
  const profile = LATIN_LANGUAGE_PROFILES[languageCode];
  if (!profile) {
    return 0;
  }

  const words = getLatinWords(text);
  if (!words.length) {
    return 0;
  }

  const stopWords = new Set(profile.stopWords.map(foldDiacritics));
  const normalizedWords = words.map(foldDiacritics);
  const stopWordHits = normalizedWords.filter((word) => stopWords.has(word)).length;
  const uniqueStopWordHits = new Set(
    normalizedWords.filter((word) => stopWords.has(word))
  ).size;
  const cappedWordCount = Math.min(words.length, 14);
  let score = Math.min(0.72, (stopWordHits / cappedWordCount) * 1.55);

  if (stopWordHits >= 4) {
    score += 0.28;
  } else if (stopWordHits >= 3) {
    score += 0.2;
  } else if (stopWordHits >= 2 && words.length >= 4) {
    score += 0.12;
  }

  if (uniqueStopWordHits >= 3) {
    score += 0.08;
  }

  if (profile.markerPattern?.test(text)) {
    score += 0.32;
  }

  if (profile.penaltyPattern?.test(text)) {
    score -= 0.25;
  }

  return Math.max(0, Math.min(1, score));
}

function getLatinLanguageScores(text) {
  return Object.fromEntries(
    Object.keys(LATIN_LANGUAGE_PROFILES).map((languageCode) => [
      languageCode,
      scoreLatinLanguage(text, languageCode)
    ])
  );
}

function getTargetLanguageConfidence(text, targetLanguage) {
  const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage);

  if (SCRIPT_LANGUAGE_RULES[normalizedTargetLanguage]) {
    return getScriptLanguageConfidence(text, normalizedTargetLanguage);
  }

  if (LATIN_LANGUAGE_PROFILES[normalizedTargetLanguage]) {
    const scores = getLatinLanguageScores(text);
    const targetScore = scores[normalizedTargetLanguage] || 0;
    const competingScore = Math.max(
      0,
      ...Object.entries(scores)
        .filter(([languageCode]) => languageCode !== normalizedTargetLanguage)
        .map(([, score]) => score)
    );

    if (targetScore >= 0.78) {
      return targetScore;
    }

    if (targetScore >= 0.58 && targetScore >= competingScore + 0.12) {
      return targetScore;
    }
  }

  return 0;
}

function hasOnlyNonTranslatableCharacters(text) {
  const normalized = String(text || '').normalize('NFKC').trim();
  if (!normalized) {
    return true;
  }

  return getLetterCount(normalized) === 0;
}

/**
 * Decide whether one OCR block should be translated.
 * Conservative behavior is intentional. It is better to leave target-language
 * text untouched than to overwrite it with a bad duplicate translation.
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

  const targetConfidence = getTargetLanguageConfidence(
    normalizedText,
    normalizedTargetLanguage
  );

  if (targetConfidence >= 0.58) {
    return {
      translate: false,
      reason: 'already-target-language',
      targetConfidence
    };
  }

  if (
    normalizedSourceLanguage &&
    normalizedSourceLanguage !== 'auto' &&
    normalizedSourceLanguage === normalizedTargetLanguage
  ) {
    return {
      translate: false,
      reason: 'source-matches-target-language',
      targetConfidence: Math.max(targetConfidence, 0.9)
    };
  }

  if (
    normalizedSourceLanguage &&
    normalizedSourceLanguage !== 'auto' &&
    normalizedSourceLanguage !== normalizedTargetLanguage
  ) {
    return {
      translate: true,
      reason: 'source-language-differs-from-target',
      targetConfidence
    };
  }

  return {
    translate: true,
    reason: 'needs-translation',
    targetConfidence
  };
}

/**
 * Main entry point for translation. Routes to the configured provider.
 *
 * @param {string[]} texts - Array of text strings to translate.
 * @param {string} sourceLang - Source language code.
 * @param {string} targetLang - Target language code.
 * @param {Object} settings - User settings from chrome.storage.
 * @returns {Promise<Object>} Translation result.
 */
export async function translateTexts(texts, sourceLang, targetLang, settings = {}) {
  if (!texts || texts.length === 0) {
    return {
      translations: [],
      sourceLang,
      targetLang,
      provider: 'none'
    };
  }

  const indexMap = [];
  const filteredTexts = [];
  const skippedEntries = [];

  for (let i = 0; i < texts.length; i++) {
    const trimmed = (texts[i] || '').trim();
    const decision = shouldTranslateTextBlock(trimmed, targetLang, sourceLang);

    if (trimmed.length > 0 && decision.translate) {
      indexMap.push(i);
      filteredTexts.push(trimmed);
    } else {
      skippedEntries.push({
        index: i,
        reason: decision.reason,
        targetConfidence: decision.targetConfidence
      });
    }
  }

  if (filteredTexts.length === 0) {
    console.log('[VisionTranslate Translation] Skipped all OCR text blocks before translation', {
      sourceLang,
      targetLang,
      skippedCount: skippedEntries.length,
      skippedEntries
    });

    return {
      translations: texts.map(() => ''),
      sourceLang,
      targetLang,
      provider: 'none',
      diagnostics: {
        requestedProvider: settings.translationProvider || 'libre',
        providerUsed: 'none',
        fallbackUsed: false,
        identicalCount: 0,
        identicalIndices: [],
        skippedTargetLanguageCount: skippedEntries.length,
        skippedTargetLanguageIndices: skippedEntries.map((entry) => entry.index),
        skippedEntries
      }
    };
  }

  const requestedProvider = settings.translationProvider || 'libre';
  const provider = requestedProvider === 'google' ? 'libre' : requestedProvider;

  let result;

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
          resolveProviderModel('openai', settings.llmModel)
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
          resolveProviderModel('claude', settings.llmModel)
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
          resolveProviderModel('gemini', settings.llmModel)
        );
        break;
      }

      case 'custom': {
        const rawBaseUrl = (settings.customBaseUrl || '').trim();
        const baseUrl = rawBaseUrl.replace(/\/+$/, '');
        if (!baseUrl) {
          throw new Error(
            'Custom API requires a base URL. Please add your API base URL in the extension settings.'
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
        if (requestedProvider === 'google') {
          console.warn('[VisionTranslate] Google Cloud Translation has been removed. Using MyMemory.');
        }
        result = await translateWithMyMemory(filteredTexts, sourceLang, targetLang);
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[VisionTranslate] Translation failed with provider "${provider}":`, error);

    if (provider !== 'libre' && settings.allowThirdPartyFallback === true) {
      console.warn('[VisionTranslate] User-enabled third-party fallback is being used.');
      try {
        result = await translateWithMyMemory(filteredTexts, sourceLang, targetLang);
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
      identicalIndices: identicalEntries.map((entry) => entry.originalIndex),
      skippedTargetLanguageCount: skippedEntries.length,
      skippedTargetLanguageIndices: skippedEntries.map((entry) => entry.index),
      skippedEntries
    }
  };
}
