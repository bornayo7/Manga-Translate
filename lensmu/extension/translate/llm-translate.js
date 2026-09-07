/**
 * =============================================================================
 * LLM TRANSLATION — OpenAI & Claude Contextual Translation
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * Uses large language models (LLMs) for translation instead of traditional
 * machine translation. This has major advantages for manga and comic text:
 *
 *   1. CONTEXTUAL UNDERSTANDING — LLMs understand that text blocks on the
 *      same page are part of a conversation, so they can maintain consistent
 *      character voice, pronoun references, and narrative flow.
 *
 *   2. SLANG & IDIOMS — Traditional MT often translates literally. LLMs
 *      understand that "マジかよ" isn't "Is it serious?" but more like
 *      "No way!" or "Are you kidding me?"
 *
 *   3. SOUND EFFECTS — Manga has onomatopoeia everywhere (ドーン, ゴゴゴ).
 *      LLMs can translate these meaningfully while noting the original.
 *
 *   4. HONORIFICS — LLMs can either keep Japanese honorifics (-san, -chan,
 *      -sensei) for weebs or translate them naturally for general audiences.
 *
 *   5. TONE PRESERVATION — A tsundere character sounds different from a
 *      shy character. LLMs can preserve these personality markers.
 *
 * SUPPORTED PROVIDERS:
 * --------------------
 *   - OpenAI (api.openai.com), Anthropic Claude (api.anthropic.com), Google
 *     Gemini, and any OpenAI-compatible endpoint. The model IDs on offer live
 *     in shared/llm-models.js.
 *
 * BATCHING STRATEGY:
 * ------------------
 * We send ALL text blocks from a single image in ONE request. This lets the
 * LLM see the full context (all speech bubbles on the page) and produce
 * more coherent translations. We number each text block and ask the LLM
 * to return translations in the same numbered format for easy parsing.
 *
 * COST CONSIDERATIONS:
 * --------------------
 * LLM translation is more expensive than Google Translate:
 *   - GPT-4o-mini: ~$0.15 per 1M input tokens (~$0.001 per manga page)
 *   - GPT-4o: ~$2.50 per 1M input tokens (~$0.01 per manga page)
 *   - Claude Sonnet: ~$3 per 1M input tokens (~$0.01 per manga page)
 *
 * For most manga reading, GPT-4o-mini offers the best cost/quality ratio.
 * =============================================================================
 */

/**
 * The system prompt that instructs the LLM how to translate.
 *
 * This prompt is CRITICAL for translation quality. It tells the model to:
 *   - Translate contextually, not literally
 *   - Handle manga-specific conventions
 *   - Maintain consistent character voice across bubbles
 *   - Return results in a structured, parseable format
 *
 * The prompt is designed to work well with both OpenAI and Claude models.
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
You will receive numbered text blocks. Respond with ONLY the translations in the exact same numbered format. Do not add explanations, notes, or commentary outside the numbered list.

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
 * short bubbles and silently truncated denser pages (the missing blocks
 * simply rendered untranslated). Estimate from the input instead:
 * translations run up to ~2x the source length, each numbered line costs a
 * few tokens of framing, and current models may spend part of the budget
 * on thinking. Bounded so a runaway estimate stays under every provider's
 * output limit.
 */
const MIN_OUTPUT_TOKENS = 1024;
const MAX_OUTPUT_TOKENS = 8192;

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
 * writing the answer. Throwing (as parseGeminiResponse already does) is
 * what lets translate-manager's opt-in public fallback engage; returning
 * '' would resolve with an all-empty array and skip it.
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

/**
 * Translate text blocks using an LLM (OpenAI or Claude).
 *
 * @param {string[]} texts      — Array of text strings to translate
 * @param {string}   sourceLang — Source language code ("auto", "ja", etc.)
 * @param {string}   targetLang — Target language code ("en", "es", etc.)
 * @param {string}   apiKey     — API key for the provider
 * @param {string}   provider   — "openai", "claude", "gemini", or "custom"
 * @param {string}   model      — Model ID (e.g., "gpt-4o-mini", "claude-sonnet-4-20250514")
 * @param {string}   [baseUrl]  — Custom API base URL (only used when provider is "custom")
 * @returns {Promise<Object>}   — { translations: string[], sourceLang, targetLang, provider }
 */
export async function translateWithLLM(texts, sourceLang, targetLang, apiKey, provider, model, baseUrl) {
  /*
   * Build the user message with numbered text blocks.
   *
   * We include the target language in the prompt so the LLM knows what
   * language to translate INTO. We also mention the source language if
   * known (helps with ambiguous text that could be multiple languages).
   *
   * Example user message:
   *   "Translate the following text blocks from Japanese to English:
   *    [1] こんにちは
   *    [2] さようなら"
   */
  const langInstruction = sourceLang && sourceLang !== 'auto'
    ? `from ${getLanguageName(sourceLang)} to ${getLanguageName(targetLang)}`
    : `to ${getLanguageName(targetLang)}`;

  const numberedTexts = texts.map((text, i) => `[${i + 1}] ${text}`).join('\n');

  const userMessage = `Translate the following text blocks ${langInstruction}:\n\n${numberedTexts}`;

  /*
   * Route to the appropriate API based on provider.
   */
  let responseText;
  const maxOutputTokens = estimateOutputTokens(texts);

  if (provider === 'openai') {
    responseText = await callOpenAI(userMessage, apiKey, model, maxOutputTokens);
  } else if (provider === 'claude') {
    responseText = await callClaude(userMessage, apiKey, model, maxOutputTokens);
  } else if (provider === 'gemini') {
    responseText = await callGemini(userMessage, apiKey, model, maxOutputTokens);
  } else if (provider === 'custom') {
    responseText = await callCustom(userMessage, apiKey, model, baseUrl, maxOutputTokens);
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }

  /*
   * Parse the numbered response back into an array of translations.
   *
   * The LLM should respond with:
   *   [1] Hello
   *   [2] Goodbye
   *
   * We parse this by looking for [N] patterns and extracting the text after.
   */
  const translations = parseNumberedResponse(responseText, texts.length);

  return {
    translations,
    sourceLang: sourceLang === 'auto' ? 'auto' : sourceLang,
    targetLang,
    provider: provider
  };
}

/**
 * Call the OpenAI Chat Completions API.
 *
 * API docs: https://platform.openai.com/docs/api-reference/chat
 *
 * @param {string} userMessage — The user prompt
 * @param {string} apiKey      — OpenAI API key
 * @param {string} model       — Model ID (e.g., "gpt-4o-mini")
 * @returns {Promise<string>}  — The model's response text
 */
async function callOpenAI(userMessage, apiKey, model, maxOutputTokens) {
  const requestBody = {
    model: model,
    messages: [
      {
        role: 'system',
        content: MANGA_TRANSLATION_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: userMessage
      }
    ],
    /*
     * max_completion_tokens limits response length; the older max_tokens
     * name is rejected by the gpt-5 family. The budget is sized to the
     * request (see estimateOutputTokens).
     */
    max_completion_tokens: maxOutputTokens
  };

  /*
   * Temperature controls randomness. 0.3 gives mostly deterministic
   * translations while allowing some natural variation. Pure 0 can
   * sometimes produce stiff translations. Reasoning models only accept
   * the default, so the field is omitted for them.
   */
  if (openAiModelSupportsTemperature(model)) {
    requestBody.temperature = 0.3;
  }

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      /*
       * OpenAI uses Bearer token auth in the Authorization header.
       * The key starts with "sk-" and is ~50 characters long.
       */
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `OpenAI API error (${response.status}): ${error?.error?.message || response.statusText}`
    );
  }

  const data = await response.json();

  /*
   * OpenAI response format:
   * {
   *   "choices": [{
   *     "message": {
   *       "role": "assistant",
   *       "content": "[1] Hello\n[2] Goodbye"
   *     }
   *   }]
   * }
   */
  const finishReason = data.choices?.[0]?.finish_reason || '';
  warnIfTruncated('OpenAI', finishReason === 'length');
  return requireResponseText('OpenAI', data.choices?.[0]?.message?.content, finishReason);
}

/**
 * Call the Anthropic Messages API (Claude).
 *
 * API docs: https://docs.anthropic.com/en/docs/build-with-claude/overview
 *
 * @param {string} userMessage — The user prompt
 * @param {string} apiKey      — Anthropic API key
 * @param {string} model       — Model ID (e.g., "claude-sonnet-4-20250514")
 * @returns {Promise<string>}  — The model's response text
 */
async function callClaude(userMessage, apiKey, model, maxOutputTokens) {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      /*
       * Anthropic uses a custom header for auth, not Bearer tokens.
       * The key starts with "sk-ant-" and is ~100+ characters.
       */
      'x-api-key': apiKey,
      /*
       * The anthropic-version header is required. It pins the API
       * behavior to a specific version so breaking changes don't
       * surprise us. Use the latest stable version.
       */
      'anthropic-version': '2023-06-01',
      /*
       * This header tells Anthropic the request is coming from a
       * browser extension, which helps their abuse prevention.
       */
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: maxOutputTokens,
      /*
       * Claude's API uses "system" as a top-level field, not as a
       * message role. This is different from OpenAI's format.
       */
      system: MANGA_TRANSLATION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userMessage
        }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Claude API error (${response.status}): ${error?.error?.message || response.statusText}`
    );
  }

  const data = await response.json();

  /*
   * Anthropic response format:
   * {
   *   "content": [{
   *     "type": "text",
   *     "text": "[1] Hello\n[2] Goodbye"
   *   }]
   * }
   *
   * Current models may put a "thinking" block first, so take every text
   * block rather than assuming content[0] is the answer.
   */
  warnIfTruncated('Claude', data.stop_reason === 'max_tokens');
  return requireResponseText('Claude', extractClaudeText(data), data.stop_reason || '');
}

export function extractClaudeText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Call the Google Gemini API.
 *
 * API docs: https://ai.google.dev/gemini-api/docs
 *
 * @param {string} userMessage — The user prompt
 * @param {string} apiKey      — Google AI API key
 * @param {string} model       — Model ID (e.g., "gemini-2.0-flash", "gemini-2.5-pro-preview-06-05")
 * @returns {Promise<string>}  — The model's response text
 */
async function callGemini(userMessage, apiKey, model, maxOutputTokens) {
  /*
   * Gemini uses a REST API where the model name is part of the URL.
   * The API key is passed as a query parameter.
   *
   * We combine the system prompt and user message into the contents
   * array since Gemini handles system instructions via a separate field.
   */
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: MANGA_TRANSLATION_SYSTEM_PROMPT }]
        },
        contents: [{
          parts: [{ text: userMessage }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Gemini API error (${response.status}): ${error?.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  return parseGeminiResponse(data);
}

/*
 * Gemini response format:
 * {
 *   "candidates": [{
 *     "content": { "parts": [{ "text": "[1] Hello\n[2] Goodbye" }] },
 *     "finishReason": "STOP"
 *   }],
 *   "promptFeedback": { "blockReason": "SAFETY" }   // only when refused
 * }
 *
 * Manga dialogue trips Gemini's safety filters more often than most text.
 * A refused prompt or a candidate stopped for SAFETY/RECITATION used to
 * come back as an empty string, which the content script reported as
 * "provider returned no translated text" - true, but it hid the cause and
 * the fix (another model, or another provider). Thinking parts are
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
 * Call a custom OpenAI-compatible API endpoint.
 *
 * This uses the same request format as OpenAI's Chat Completions API,
 * which is supported by many local and cloud providers (Ollama, LM Studio,
 * vLLM, Azure OpenAI, Together AI, etc.).
 *
 * @param {string} userMessage — The user prompt
 * @param {string} apiKey      — API key (can be empty for local servers)
 * @param {string} model       — Model name
 * @param {string} baseUrl     — Base URL of the API (e.g., "http://localhost:11434/v1")
 * @returns {Promise<string>}  — The model's response text
 */
async function callCustom(userMessage, apiKey, model, baseUrl, maxOutputTokens) {
  const url = `${trimTrailingSlashes(baseUrl)}/chat/completions`;

  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: MANGA_TRANSLATION_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      temperature: 0.3,
      /*
       * Local and third-party OpenAI-compatible servers (Ollama, LM Studio,
       * vLLM, ...) all understand max_tokens; not all know the newer name.
       */
      max_tokens: maxOutputTokens
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Custom API error (${response.status}): ${error?.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  const finishReason = data.choices?.[0]?.finish_reason || '';
  warnIfTruncated('The custom API', finishReason === 'length');
  return requireResponseText('The custom API', data.choices?.[0]?.message?.content, finishReason);
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
 * Parse a numbered response from the LLM into an array of translations.
 *
 * Expected format:
 *   [1] Hello
 *   [2] Goodbye
 *   [3] BOOM (ドーン)
 *
 * The parser walks the response line by line. A line whose marker number
 * is larger than the previous one (and within the expected range) starts a
 * new entry; every other line, including blank ones and any preamble, is
 * appended to the entry that is open. That keeps multi-line translations
 * intact, lets an entry legitimately be empty, and stops a "2024." or a
 * numbered list *inside* a translation from being read as the next entry.
 *
 * If no marker is found at all the response is treated as bare lines: a
 * single-block request takes the whole text, and a response with exactly
 * one non-empty line per block is mapped by position.
 *
 * @param {string} responseText — The raw LLM response
 * @param {number} expectedCount — How many translations we expect
 * @returns {string[]}          — Array of translated strings
 */
export function parseNumberedResponse(responseText, expectedCount) {
  const lines = String(responseText || '').replace(/\r\n?/g, '\n').split('\n');
  const markerPattern = lines.some((line) => BRACKET_MARKER_PATTERN.test(line))
    ? BRACKET_MARKER_PATTERN
    : PLAIN_MARKER_PATTERN;
  const entries = new Map();
  let currentIndex = -1;
  let currentLines = [];
  let lastMarker = 0;

  const flush = () => {
    if (currentIndex >= 0) {
      entries.set(currentIndex, currentLines.join('\n').trim());
    }
    currentLines = [];
  };

  for (const line of lines) {
    const match = line.match(markerPattern);
    const marker = match ? parseInt(match[1], 10) : 0;

    if (match && marker > lastMarker && marker <= expectedCount) {
      flush();
      currentIndex = marker - 1;
      lastMarker = marker;
      currentLines = [match[2]];
      continue;
    }

    if (currentIndex >= 0) {
      currentLines.push(line);
    }
  }
  flush();

  if (entries.size === 0) {
    const bareLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);

    if (expectedCount === 1) {
      return [bareLines.join('\n')];
    }

    if (bareLines.length === expectedCount) {
      return bareLines;
    }
  }

  return Array.from({ length: expectedCount }, (_, index) => entries.get(index) || '');
}

/**
 * Convert a language code to a human-readable name for the LLM prompt.
 *
 * We include the name in the prompt so the LLM understands the context
 * better than just seeing a two-letter code.
 *
 * @param {string} code — ISO 639-1 language code
 * @returns {string}    — Human-readable language name
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
