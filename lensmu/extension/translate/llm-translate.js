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
 *   - OpenAI: GPT-4o, GPT-4o-mini, GPT-4-turbo (via api.openai.com)
 *   - Claude: Claude 3.5 Sonnet, Claude 3 Opus, etc. (via api.anthropic.com)
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

  if (provider === 'openai') {
    responseText = await callOpenAI(userMessage, apiKey, model);
  } else if (provider === 'claude') {
    responseText = await callClaude(userMessage, apiKey, model);
  } else if (provider === 'gemini') {
    responseText = await callGemini(userMessage, apiKey, model);
  } else if (provider === 'custom') {
    responseText = await callCustom(userMessage, apiKey, model, baseUrl);
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
async function callOpenAI(userMessage, apiKey, model) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      /*
       * OpenAI uses Bearer token auth in the Authorization header.
       * The key starts with "sk-" and is ~50 characters long.
       */
      'Authorization': `Bearer ${apiKey}`
    },
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
      /*
       * Temperature controls randomness. 0.3 gives mostly deterministic
       * translations while allowing some natural variation. Pure 0 can
       * sometimes produce stiff translations.
       */
      temperature: 0.3,
      /*
       * max_tokens limits response length. We set a generous limit since
       * translations can be longer than the original (especially JP→EN).
       * 2000 tokens is enough for ~30-40 text blocks.
       */
      max_tokens: 2000
    })
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
  return data.choices?.[0]?.message?.content || '';
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
async function callClaude(userMessage, apiKey, model) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
      max_tokens: 2000,
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
   */
  return data.content?.[0]?.text || '';
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
async function callGemini(userMessage, apiKey, model) {
  /*
   * Gemini uses a REST API where the model name is part of the URL.
   * The API key is passed as a query parameter.
   *
   * We combine the system prompt and user message into the contents
   * array since Gemini handles system instructions via a separate field.
   */
  const response = await fetch(
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
          maxOutputTokens: 2000
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

  /*
   * Gemini response format:
   * {
   *   "candidates": [{
   *     "content": {
   *       "parts": [{ "text": "[1] Hello\n[2] Goodbye" }]
   *     }
   *   }]
   * }
   */
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
async function callCustom(userMessage, apiKey, model, baseUrl) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
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
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Custom API error (${response.status}): ${error?.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Parse a numbered response from the LLM into an array of translations.
 *
 * Expected format:
 *   [1] Hello
 *   [2] Goodbye
 *   [3] BOOM (ドーン)
 *
 * This parser is intentionally forgiving — LLMs sometimes add extra
 * whitespace, blank lines, or slight format variations. We handle:
 *   - "[1]" or "1." or "1)" as number prefixes
 *   - Extra blank lines between entries
 *   - Missing numbers (we try to infer from position)
 *
 * @param {string} responseText — The raw LLM response
 * @param {number} expectedCount — How many translations we expect
 * @returns {string[]}          — Array of translated strings
 */
function parseNumberedResponse(responseText, expectedCount) {
  /*
   * Strategy: Use regex to find all [N] patterns and extract text after them.
   * The text for entry N extends from after [N] to just before [N+1] (or end).
   */
  const entries = new Map();

  /*
   * Match patterns like:
   *   [1] some text
   *   [2] more text
   *   1. some text
   *   1) some text
   *
   * The regex captures the number and the text after it.
   * We use a global match to find all entries.
   */
  const pattern = /\[(\d+)\]\s*(.+?)(?=\n\[?\d+[\].)]\s|\n*$)/gs;
  let match;

  while ((match = pattern.exec(responseText)) !== null) {
    const index = parseInt(match[1], 10) - 1; // Convert 1-based to 0-based
    const text = match[2].trim();
    if (index >= 0 && index < expectedCount) {
      entries.set(index, text);
    }
  }

  /*
   * If the regex didn't find enough entries (LLM used a different format),
   * fall back to splitting by newlines and taking non-empty lines.
   */
  if (entries.size < expectedCount) {
    const lines = responseText
      .split('\n')
      .map((line) => line.replace(/^\[?\d+[\].)]\s*/, '').trim())
      .filter((line) => line.length > 0);

    for (let i = 0; i < Math.min(lines.length, expectedCount); i++) {
      if (!entries.has(i)) {
        entries.set(i, lines[i]);
      }
    }
  }

  /*
   * Build the final array, using empty string for any missing entries.
   */
  const result = [];
  for (let i = 0; i < expectedCount; i++) {
    result.push(entries.get(i) || '');
  }

  return result;
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
