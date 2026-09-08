/**
 * =============================================================================
 * LLM TRANSLATION — OpenAI, Claude, Gemini and OpenAI-compatible endpoints
 * =============================================================================
 *
 * Uses large language models for translation instead of traditional machine
 * translation, which matters for manga and comic text: the model sees every
 * bubble on the page at once (context, consistent voice), understands slang
 * and onomatopoeia, and can keep honorifics.
 *
 * BATCHING AND ALIGNMENT:
 * -----------------------
 * All text blocks from one image go in ONE request as a numbered list, and
 * the model answers in the same numbered format. The numbering is the only
 * thing that ties a translation back to its bubble, so the parser demands an
 * unambiguous one-to-one mapping: every requested number present exactly
 * once, nothing outside the range. A response that is missing numbers (the
 * usual sign of truncation) triggers one bounded retry for just the missing
 * blocks; a response with duplicate or out-of-range numbers is retried
 * whole; if the retry is still incomplete the request fails with the block
 * numbers named rather than rendering the wrong text on the wrong bubble.
 *
 * The model IDs on offer live in shared/llm-models.js.
 * =============================================================================
 */

import { fetchWithTimeout } from '../shared/fetch-with-timeout.js';
import { trimTrailingSlashes } from '../shared/text.js';
import { openAiModelSupportsTemperature } from '../shared/llm-models.js';

const MANGA_TRANSLATION_SYSTEM_PROMPT = `You are an expert manga/comic translator with deep knowledge of Japanese, Chinese, Korean, and other Asian languages. You translate text extracted from manga panels, comic speech bubbles, signs, and other image-based text.

TRANSLATION GUIDELINES:
1. CONTEXT IS KING: The numbered text blocks you receive are from the SAME image/page. They are likely part of a conversation or scene. Use this context to produce coherent, natural translations.

2. NATURAL LANGUAGE: Translate into natural, fluent speech — NOT word-for-word literal translation. "お腹すいた" should be "I'm hungry" or "I'm starving", not "Stomach became empty."

3. SOUND EFFECTS (SFX): For onomatopoeia and sound effects:
   - Translate the meaning/feeling, then note the original in parentheses
   - Example: "BOOM (ドーン)" or "RUMBLE (ゴゴゴ)" or "*stare* (ジーッ)"
   - Short SFX that are purely atmospheric can be transliterated: "ゴゴゴ" → "Go go go..."

4. HONORIFICS: Keep Japanese honorifics (-san, -chan, -kun, -sama, -sensei, -senpai) as-is when translating to English. Most manga readers expect them. For other target languages, adapt naturally.

5. TONE & EMOTION: Preserve the speaker's tone:
   - Formal/polite speech (です/ます form) → formal English
   - Casual/rough speech (だ/ぜ/ぞ) → casual English with contractions
   - Cute/childish speech → simpler vocabulary, maybe a stutter
   - Angry shouting (indicated by OCR confidence, exclamation marks) → emphatic English

6. CULTURAL REFERENCES: If a reference is obscure, translate the meaning rather than transliterating. If it's well-known in the manga community, keep it.

7. FORMATTING:
   - Keep translations concise — they must fit in small speech bubbles
   - Prefer short, punchy sentences over long explanations
   - Use line breaks only if the original clearly has them

RESPONSE FORMAT:
You will receive numbered text blocks. Respond with ONLY the translations in the exact same numbered format, one entry per block, every number exactly once. Do not add explanations, notes, or commentary outside the numbered list.

Input example:
[1] こんにちは
[2] お元気ですか？
[3] ドーン

Response example:
[1] Hello!
[2] How are you doing?
[3] BOOM (ドーン)`;

/*
 * Output budget for one request. A fixed 2000 tokens topped out around 30
 * short bubbles and silently truncated denser pages. Estimate from the
 * input instead: translations run up to ~2x the source length, each
 * numbered line costs a few tokens of framing, and current models may spend
 * part of the budget on thinking. Bounded so a runaway estimate stays under
 * every provider's output limit.
 */
const MIN_OUTPUT_TOKENS = 1024;
const MAX_OUTPUT_TOKENS = 8192;
const MAX_ALIGNMENT_RETRIES = 1;
const LLM_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;

export function estimateOutputTokens(texts) {
  const inputChars = (Array.isArray(texts) ? texts : []).reduce(
    (total, text) => total + String(text || '').length,
    0
  );
  const estimate = Math.ceil(inputChars * 1.5) + (Array.isArray(texts) ? texts.length : 0) * 16 + 200;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(MAX_OUTPUT_TOKENS, estimate));
}

function warnIfTruncated(providerName, truncated) {
  if (truncated) {
    console.warn(
      `[VisionTranslate] ${providerName} hit its output limit; the last text blocks may be missing their translation.`
    );
  }
}

/*
 * A provider that produced no text at all is a failed request, not an
 * empty translation: a thinking model can spend the whole budget before
 * writing the answer. Throwing is what lets translate-manager's opt-in
 * public fallback engage; returning '' would resolve with an all-empty
 * array and skip it.
 */
export function requireResponseText(providerName, text, stopReason = '') {
  if (String(text || '').trim()) {
    return text;
  }

  if (stopReason === 'length' || stopReason === 'max_tokens') {
    throw new Error(
      `${providerName} hit its output limit before producing a translation. Try a smaller page or a faster model.`
    );
  }

  throw new Error(`${providerName} returned no text${stopReason ? ` (${stopReason})` : ''}.`);
}

function buildUserMessage(texts, sourceLang, targetLang) {
  const langInstruction = sourceLang && sourceLang !== 'auto'
    ? `from ${getLanguageName(sourceLang)} to ${getLanguageName(targetLang)}`
    : `to ${getLanguageName(targetLang)}`;

  const numberedTexts = texts.map((text, i) => `[${i + 1}] ${text}`).join('\n');

  return `Translate the following text blocks ${langInstruction}:\n\n${numberedTexts}`;
}

async function requestTranslations(texts, sourceLang, targetLang, apiKey, provider, model, baseUrl, signal) {
  const userMessage = buildUserMessage(texts, sourceLang, targetLang);
  const maxOutputTokens = estimateOutputTokens(texts);
  const requestOptions = { signal };

  if (provider === 'openai') {
    return callOpenAI(userMessage, apiKey, model, maxOutputTokens, requestOptions);
  }
  if (provider === 'claude') {
    return callClaude(userMessage, apiKey, model, maxOutputTokens, requestOptions);
  }
  if (provider === 'gemini') {
    return callGemini(userMessage, apiKey, model, maxOutputTokens, requestOptions);
  }
  if (provider === 'custom') {
    return callCustom(userMessage, apiKey, model, baseUrl, maxOutputTokens, requestOptions);
  }
  throw new Error(`Unknown LLM provider: ${provider}`);
}

function describeAlignmentProblem(providerName, parsed, expectedCount, truncated) {
  const parts = [];
  if (parsed.missing.length) {
    parts.push(`missing block${parsed.missing.length === 1 ? '' : 's'} ${parsed.missing.join(', ')}`);
  }
  if (parsed.duplicates.length) {
    parts.push(`duplicate number${parsed.duplicates.length === 1 ? '' : 's'} ${parsed.duplicates.join(', ')}`);
  }
  if (parsed.outOfRange.length) {
    parts.push(`unexpected number${parsed.outOfRange.length === 1 ? '' : 's'} ${parsed.outOfRange.join(', ')}`);
  }
  const cause = truncated
    ? ' The provider hit its output limit; try a smaller page or a model with a larger output budget.'
    : '';
  return `${providerName} returned an incomplete numbered response for ${expectedCount} text blocks (${parts.join('; ')}).${cause}`;
}

/**
 * Translate text blocks using an LLM.
 *
 * @param {string[]} texts      — Array of text strings to translate
 * @param {string}   sourceLang — Source language code ("auto", "ja", etc.)
 * @param {string}   targetLang — Target language code ("en", "es", etc.)
 * @param {string}   apiKey     — API key for the provider (may be '' for local custom servers)
 * @param {string}   provider   — "openai", "claude", "gemini", or "custom"
 * @param {string}   model      — Model ID
 * @param {string}   [baseUrl]  — Custom API base URL (only used when provider is "custom")
 * @param {Object}   [options]  — { signal?: AbortSignal }
 * @returns {Promise<Object>}   — { translations, sourceLang, targetLang, provider, retryCount }
 */
export async function translateWithLLM(texts, sourceLang, targetLang, apiKey, provider, model, baseUrl, options = {}) {
  const signal = options.signal || undefined;
  const providerName = PROVIDER_NAMES[provider] || provider;

  const first = await requestTranslations(texts, sourceLang, targetLang, apiKey, provider, model, baseUrl, signal);
  let parsed = parseNumberedResponseStrict(first.text, texts.length);
  let truncated = Boolean(first.truncated);
  let retryCount = 0;

  if (parsed.problems && retryCount < MAX_ALIGNMENT_RETRIES) {
    retryCount += 1;

    if (parsed.missing.length && !parsed.duplicates.length && !parsed.outOfRange.length) {
      /*
       * Only some numbers are absent (typically the tail after a length
       * stop). Ask for those blocks alone, renumbered 1..k, and slot the
       * answers back by their original index. Fabricating the alignment
       * from neighbouring lines is exactly the bug this replaces.
       */
      const missingIndices = parsed.missing.map((number) => number - 1);
      const retryTexts = missingIndices.map((index) => texts[index]);
      console.warn(
        `[VisionTranslate] ${providerName} answered ${texts.length - missingIndices.length} of ${texts.length} blocks; retrying blocks ${parsed.missing.join(', ')}.`
      );
      const retry = await requestTranslations(retryTexts, sourceLang, targetLang, apiKey, provider, model, baseUrl, signal);
      const retryParsed = parseNumberedResponseStrict(retry.text, retryTexts.length);
      truncated = truncated || Boolean(retry.truncated);

      if (!retryParsed.problems) {
        const merged = parsed.translations.slice();
        missingIndices.forEach((originalIndex, position) => {
          merged[originalIndex] = retryParsed.translations[position];
        });
        parsed = { ...retryParsed, translations: merged, missing: [], duplicates: [], outOfRange: [], problems: false };
      } else {
        const stillMissing = retryParsed.missing.map((number) => missingIndices[number - 1] + 1);
        parsed = {
          ...parsed,
          missing: stillMissing,
          duplicates: retryParsed.duplicates.map((number) => missingIndices[number - 1] + 1),
          outOfRange: retryParsed.outOfRange,
          problems: true
        };
      }
    } else {
      console.warn(
        `[VisionTranslate] ${providerName} returned ambiguous numbering (duplicates ${parsed.duplicates.join(', ') || 'none'}; out of range ${parsed.outOfRange.join(', ') || 'none'}); retrying the whole request.`
      );
      const retry = await requestTranslations(texts, sourceLang, targetLang, apiKey, provider, model, baseUrl, signal);
      parsed = parseNumberedResponseStrict(retry.text, texts.length);
      truncated = Boolean(retry.truncated);
    }
  }

  if (parsed.problems) {
    throw new Error(describeAlignmentProblem(providerName, parsed, texts.length, truncated));
  }

  return {
    translations: parsed.translations,
    sourceLang: sourceLang === 'auto' ? 'auto' : sourceLang,
    targetLang,
    provider,
    retryCount
  };
}

const PROVIDER_NAMES = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
  custom: 'The custom API'
};

function readErrorMessage(response) {
  return response.json?.error?.message || response.statusText;
}

/**
 * Call the OpenAI Chat Completions API.
 * API docs: https://platform.openai.com/docs/api-reference/chat
 */
async function callOpenAI(userMessage, apiKey, model, maxOutputTokens, { signal } = {}) {
  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: MANGA_TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ],
    /*
     * max_completion_tokens limits response length; the older max_tokens
     * name is rejected by reasoning models. The budget is sized to the
     * request (see estimateOutputTokens).
     */
    max_completion_tokens: maxOutputTokens
  };

  /*
   * 0.3 gives mostly deterministic translations while allowing some natural
   * variation. Reasoning models only accept the default, so the field is
   * omitted for them.
   */
  if (openAiModelSupportsTemperature(model)) {
    requestBody.temperature = 0.3;
  }

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal
  }, { maxResponseBytes: LLM_RESPONSE_LIMIT_BYTES });

  if (!response.ok) {
    throw new Error(`OpenAI API error (${response.status}): ${readErrorMessage(response)}`);
  }

  const data = response.json;
  const finishReason = data?.choices?.[0]?.finish_reason || '';
  const truncated = finishReason === 'length';
  warnIfTruncated('OpenAI', truncated);
  return {
    text: requireResponseText('OpenAI', data?.choices?.[0]?.message?.content, finishReason),
    truncated,
    stopReason: finishReason
  };
}

/**
 * Call the Anthropic Messages API (Claude).
 * API docs: https://platform.claude.com/docs/en/api/messages
 */
async function callClaude(userMessage, apiKey, model, maxOutputTokens, { signal } = {}) {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      /* Required for requests made directly from a browser extension. */
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: maxOutputTokens,
      system: MANGA_TRANSLATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    }),
    signal
  }, { maxResponseBytes: LLM_RESPONSE_LIMIT_BYTES });

  if (!response.ok) {
    throw new Error(`Claude API error (${response.status}): ${readErrorMessage(response)}`);
  }

  const data = response.json;
  const truncated = data?.stop_reason === 'max_tokens';
  warnIfTruncated('Claude', truncated);
  return {
    text: requireResponseText('Claude', extractClaudeText(data), data?.stop_reason || ''),
    truncated,
    stopReason: data?.stop_reason || ''
  };
}

/*
 * Current models may put a "thinking" block first, so take every text block
 * rather than assuming content[0] is the answer.
 */
export function extractClaudeText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Call the Google Gemini API. The model name is part of the URL and the
 * API key is a query parameter.
 * API docs: https://ai.google.dev/gemini-api/docs
 */
async function callGemini(userMessage, apiKey, model, maxOutputTokens, { signal } = {}) {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: MANGA_TRANSLATION_SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens }
      }),
      signal
    },
    { maxResponseBytes: LLM_RESPONSE_LIMIT_BYTES }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error (${response.status}): ${readErrorMessage(response)}`);
  }

  const data = response.json;
  const text = parseGeminiResponse(data);
  const finishReason = data?.candidates?.[0]?.finishReason || 'STOP';
  return { text, truncated: finishReason === 'MAX_TOKENS', stopReason: finishReason };
}

/*
 * Manga dialogue trips Gemini's safety filters more often than most text.
 * A refused prompt or a candidate stopped for SAFETY/RECITATION used to
 * come back as an empty string, which hid the cause. Thinking parts are
 * skipped, and every text part is joined rather than just the first.
 */
export function parseGeminiResponse(data) {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(
      `Gemini refused the request (${blockReason}). Try another Gemini model or a different provider.`
    );
  }

  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new Error('Gemini returned no candidates.');
  }

  const text = (candidate.content?.parts || [])
    .filter((part) => typeof part?.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('\n');
  const finishReason = candidate.finishReason || 'STOP';

  if (!text && finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini hit its output limit before producing a translation. Try a Flash model.');
  }

  if (!text && finishReason !== 'STOP') {
    throw new Error(
      `Gemini stopped without a translation (${finishReason}). Try another Gemini model or a different provider.`
    );
  }

  warnIfTruncated('Gemini', finishReason === 'MAX_TOKENS');
  return text;
}

/**
 * Call a custom OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, Azure
 * OpenAI, Together AI, ...). The API key is optional: local servers run
 * without one and then no Authorization header is sent.
 */
async function callCustom(userMessage, apiKey, model, baseUrl, maxOutputTokens, { signal } = {}) {
  const url = `${trimTrailingSlashes(baseUrl)}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: MANGA_TRANSLATION_SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      /*
       * Local and third-party OpenAI-compatible servers all understand
       * max_tokens; not all know the newer name.
       */
      max_tokens: maxOutputTokens
    }),
    signal
  }, { maxResponseBytes: LLM_RESPONSE_LIMIT_BYTES });

  if (!response.ok) {
    throw new Error(`Custom API error (${response.status}): ${readErrorMessage(response)}`);
  }

  const data = response.json;
  const finishReason = data?.choices?.[0]?.finish_reason || '';
  const truncated = finishReason === 'length';
  warnIfTruncated('The custom API', truncated);
  return {
    text: requireResponseText('The custom API', data?.choices?.[0]?.message?.content, finishReason),
    truncated,
    stopReason: finishReason
  };
}

/*
 * Lines that start a new numbered entry, optionally wrapped in markdown
 * bold. The prompt asks for "[N] text", so whenever a response contains a
 * bracketed marker at all, only bracketed markers open entries; that keeps
 * a numbered list *inside* a translation ("1. No shouting") as content.
 * The plain form ("1. text", "1) text") is accepted only for responses
 * that never use brackets, and it requires whitespace (or end of line)
 * after the delimiter so a decimal such as "3.50 dollars" is not a marker.
 * A colon is never a delimiter, so "1:30 PM" is not one either.
 */
const BRACKET_MARKER_PATTERN = /^\s*(?:\*\*)?\[\s*(\d+)\s*\]\s*(?:\*\*)?\s*(.*)$/;
const PLAIN_MARKER_PATTERN = /^\s*(?:\*\*)?(\d+)\s*[.)](?:\s+|\s*\*\*\s*|$)(.*)$/;

/**
 * Parse a numbered response into translations and an alignment report.
 *
 * Returns { translations, missing, duplicates, outOfRange, mode, problems }:
 *   - translations[i] is the entry for block i+1 ('' when absent),
 *   - missing / duplicates / outOfRange list 1-based block numbers,
 *   - mode is 'bracket', 'plain', 'bare' (no markers, exactly one non-empty
 *     line per block, mapped by position) or 'none',
 *   - problems is true whenever the mapping is not one-to-one.
 *
 * Every line that is not a marker is appended to the entry that is open,
 * so multi-line translations stay with their number. Once markers are in
 * use, a missing number is never filled by position, a repeated number is
 * reported as a duplicate rather than silently overwriting or appending,
 * and a number outside 1..expectedCount is reported as out of range.
 */
export function parseNumberedResponseStrict(responseText, expectedCount) {
  const lines = String(responseText || '').replace(/\r\n?/g, '\n').split('\n');
  const usesBrackets = lines.some((line) => BRACKET_MARKER_PATTERN.test(line));
  const markerPattern = usesBrackets ? BRACKET_MARKER_PATTERN : PLAIN_MARKER_PATTERN;
  const entries = new Map();
  const seen = new Set();
  const duplicates = new Set();
  const outOfRange = new Set();
  let currentIndex = -1;
  let currentLines = [];
  let sawMarker = false;

  const flush = () => {
    if (currentIndex >= 0 && !entries.has(currentIndex)) {
      entries.set(currentIndex, currentLines.join('\n').trim());
    }
    currentLines = [];
  };

  for (const line of lines) {
    const match = line.match(markerPattern);

    if (match) {
      const marker = parseInt(match[1], 10);
      sawMarker = true;

      if (marker < 1 || marker > expectedCount) {
        outOfRange.add(marker);
        flush();
        currentIndex = -1;
        continue;
      }

      if (seen.has(marker)) {
        duplicates.add(marker);
        flush();
        currentIndex = -1;
        continue;
      }

      seen.add(marker);
      flush();
      currentIndex = marker - 1;
      currentLines = [match[2]];
      continue;
    }

    if (currentIndex >= 0) {
      currentLines.push(line);
    }
  }
  flush();

  if (!sawMarker) {
    const bareLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);

    if (expectedCount === 1 && bareLines.length > 0) {
      return { translations: [bareLines.join('\n')], missing: [], duplicates: [], outOfRange: [], mode: 'bare', problems: false };
    }

    if (bareLines.length === expectedCount && expectedCount > 0) {
      return { translations: bareLines, missing: [], duplicates: [], outOfRange: [], mode: 'bare', problems: false };
    }

    return {
      translations: Array.from({ length: expectedCount }, () => ''),
      missing: Array.from({ length: expectedCount }, (_, index) => index + 1),
      duplicates: [],
      outOfRange: [],
      mode: 'none',
      problems: expectedCount > 0
    };
  }

  const missing = [];
  const translations = Array.from({ length: expectedCount }, (_, index) => {
    if (!entries.has(index)) {
      missing.push(index + 1);
      return '';
    }
    return entries.get(index);
  });

  const duplicateList = [...duplicates].sort((a, b) => a - b);
  const outOfRangeList = [...outOfRange].sort((a, b) => a - b);

  return {
    translations,
    missing,
    duplicates: duplicateList,
    outOfRange: outOfRangeList,
    mode: usesBrackets ? 'bracket' : 'plain',
    problems: missing.length > 0 || duplicateList.length > 0 || outOfRangeList.length > 0
  };
}

/**
 * Backwards-compatible view of parseNumberedResponseStrict(): the
 * translations array only. Missing entries are '' — callers that need to
 * know whether the mapping was complete use the strict variant.
 */
export function parseNumberedResponse(responseText, expectedCount) {
  return parseNumberedResponseStrict(responseText, expectedCount).translations;
}

/**
 * Convert a language code to a human-readable name for the LLM prompt.
 */
function getLanguageName(code) {
  const names = {
    'auto': 'the detected language',
    'en': 'English',
    'ja': 'Japanese',
    'zh': 'Chinese (Simplified)',
    'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
    'ko': 'Korean',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'th': 'Thai',
    'vi': 'Vietnamese',
    'it': 'Italian'
  };

  return names[code] || code;
}
