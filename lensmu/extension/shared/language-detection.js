// Script- and stop-word-based language heuristics shared by the translation
// manager (skip blocks already in the target language) and the MyMemory
// client (which needs an explicit source language: its spec offers no
// autodetect value). Pure functions; no browser or provider access.
//
// The rules are deliberately conservative. Han characters (CJK Unified
// Ideographs) are shared by Chinese and Japanese, so text made only of Han
// characters can never establish either language by script alone: it is
// reported as *ambiguous* (confidence 0.5, below the 0.58 skip threshold)
// rather than as Japanese or Chinese. Kana establishes Japanese and rules
// Chinese out; Hangul, Cyrillic, Arabic, Devanagari and Thai each establish
// their own language.

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

const KANA_PATTERN = /[぀-ヿ]/g;
const HAN_PATTERN = /[㐀-鿿]/g;

// Scripts that identify exactly one supported language.
const EXCLUSIVE_SCRIPT_RULES = {
  ko: { pattern: /[가-힯]/g, threshold: 0.15 },
  ru: { pattern: /[Ѐ-ӿ]/g, threshold: 0.25 },
  ar: { pattern: /[؀-ۿ]/g, threshold: 0.2 },
  hi: { pattern: /[ऀ-ॿ]/g, threshold: 0.2 },
  th: { pattern: /[฀-๿]/g, threshold: 0.2 }
};

const JA_KANA_THRESHOLD = 0.08;
const HAN_AMBIGUITY_THRESHOLD = 0.35;
export const AMBIGUOUS_SCRIPT_CONFIDENCE = 0.5;
export const TARGET_LANGUAGE_SKIP_THRESHOLD = 0.58;

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

export function normalizeLanguageCode(languageCode) {
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
    .replace(/[̀-ͯ]/g, '')
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

export function hasOnlyNonTranslatableCharacters(text) {
  const normalized = String(text || '').normalize('NFKC').trim();
  if (!normalized) {
    return true;
  }

  return getLetterCount(normalized) === 0;
}

/*
 * Script evidence for one language. Returns { confidence, ambiguous }:
 * confidence is 1 when the script is decisive, AMBIGUOUS_SCRIPT_CONFIDENCE
 * when only shared Han characters are present (could be ja or zh), and 0
 * when the script rules the language out or says nothing.
 */
export function getScriptLanguageEvidence(text, languageCode) {
  const totalLetters = Math.max(1, getLetterCount(text));
  const kanaRatio = countRegexMatches(text, KANA_PATTERN) / totalLetters;
  const hanRatio = countRegexMatches(text, HAN_PATTERN) / totalLetters;

  if (languageCode === 'ja') {
    if (kanaRatio >= JA_KANA_THRESHOLD) {
      return { confidence: Math.min(1, kanaRatio / JA_KANA_THRESHOLD), ambiguous: false };
    }
    if (hanRatio >= HAN_AMBIGUITY_THRESHOLD) {
      return { confidence: AMBIGUOUS_SCRIPT_CONFIDENCE, ambiguous: true };
    }
    return { confidence: 0, ambiguous: false };
  }

  if (languageCode === 'zh') {
    // Any kana at all means the text is Japanese, whatever the Han ratio.
    if (kanaRatio > 0) {
      return { confidence: 0, ambiguous: false };
    }
    if (hanRatio >= HAN_AMBIGUITY_THRESHOLD) {
      return { confidence: AMBIGUOUS_SCRIPT_CONFIDENCE, ambiguous: true };
    }
    return { confidence: 0, ambiguous: false };
  }

  const rules = EXCLUSIVE_SCRIPT_RULES[languageCode];
  if (!rules) {
    return { confidence: 0, ambiguous: false };
  }

  const ratio = countRegexMatches(text, rules.pattern) / totalLetters;
  if (ratio >= rules.threshold) {
    return { confidence: Math.min(1, ratio / Math.max(rules.threshold, 0.01)), ambiguous: false };
  }
  return { confidence: 0, ambiguous: false };
}

export function isScriptLanguage(languageCode) {
  return languageCode === 'ja' || languageCode === 'zh' || Boolean(EXCLUSIVE_SCRIPT_RULES[languageCode]);
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

export function getLatinLanguageScores(text) {
  return Object.fromEntries(
    Object.keys(LATIN_LANGUAGE_PROFILES).map((languageCode) => [
      languageCode,
      scoreLatinLanguage(text, languageCode)
    ])
  );
}

export function isLatinProfileLanguage(languageCode) {
  return Boolean(LATIN_LANGUAGE_PROFILES[languageCode]);
}

/*
 * How confident we are that `text` is already written in `targetLanguage`.
 * Returns { confidence, ambiguous }; callers skip translation only at or
 * above TARGET_LANGUAGE_SKIP_THRESHOLD, which an ambiguous Han-only block
 * never reaches.
 */
export function getTargetLanguageConfidence(text, targetLanguage) {
  const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage);

  if (isScriptLanguage(normalizedTargetLanguage)) {
    return getScriptLanguageEvidence(text, normalizedTargetLanguage);
  }

  if (isLatinProfileLanguage(normalizedTargetLanguage)) {
    const scores = getLatinLanguageScores(text);
    const targetScore = scores[normalizedTargetLanguage] || 0;
    const competingScore = Math.max(
      0,
      ...Object.entries(scores)
        .filter(([languageCode]) => languageCode !== normalizedTargetLanguage)
        .map(([, score]) => score)
    );

    if (targetScore >= 0.78) {
      return { confidence: targetScore, ambiguous: false };
    }

    if (targetScore >= TARGET_LANGUAGE_SKIP_THRESHOLD && targetScore >= competingScore + 0.12) {
      return { confidence: targetScore, ambiguous: false };
    }
  }

  return { confidence: 0, ambiguous: false };
}

/*
 * Best-effort source language for text whose language the user left on
 * "auto". Returns { language, confidence, reason }; `language` is null when
 * the script is shared (Han only) or the stop-word evidence is not decisive.
 * Callers that need an explicit code (MyMemory) must treat null as "ask the
 * user", never as a guess.
 */
export function detectSourceLanguage(text) {
  const normalizedText = String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

  if (hasOnlyNonTranslatableCharacters(normalizedText)) {
    return { language: null, confidence: 0, reason: 'empty-or-non-text' };
  }

  const japanese = getScriptLanguageEvidence(normalizedText, 'ja');
  if (!japanese.ambiguous && japanese.confidence >= TARGET_LANGUAGE_SKIP_THRESHOLD) {
    return { language: 'ja', confidence: japanese.confidence, reason: 'kana-script' };
  }

  for (const languageCode of Object.keys(EXCLUSIVE_SCRIPT_RULES)) {
    const evidence = getScriptLanguageEvidence(normalizedText, languageCode);
    if (evidence.confidence >= TARGET_LANGUAGE_SKIP_THRESHOLD) {
      return { language: languageCode, confidence: evidence.confidence, reason: 'exclusive-script' };
    }
  }

  if (japanese.ambiguous) {
    return { language: null, confidence: AMBIGUOUS_SCRIPT_CONFIDENCE, reason: 'han-only-ambiguous' };
  }

  const scores = Object.entries(getLatinLanguageScores(normalizedText)).sort(
    ([, left], [, right]) => right - left
  );
  const [bestLanguage, bestScore] = scores[0] || [null, 0];
  const runnerUpScore = scores[1]?.[1] || 0;

  if (bestLanguage && bestScore >= TARGET_LANGUAGE_SKIP_THRESHOLD && bestScore >= runnerUpScore + 0.12) {
    return { language: bestLanguage, confidence: bestScore, reason: 'stop-words' };
  }

  return { language: null, confidence: bestScore, reason: 'latin-undecided' };
}
