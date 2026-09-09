import { chunkTextByBytes } from '../../extension/shared/text-chunking.js';
import { MYMEMORY_BYTE_LIMIT, assertMyMemoryStatus, buildMyMemoryLangPair, ensureTranslatedText, resolveMyMemorySourceLanguage } from '../../extension/shared/mymemory.js';
import { fetchWithTimeout } from '../../extension/shared/fetch-with-timeout.js';
import { classifyTranslations } from '../../extension/shared/translation-outcomes.js';

export async function translateTexts(texts: string[], source: string, target: string, signal?: AbortSignal, progress?: (detail: string) => void) {
  const translations: string[] = [];
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index];
    signal?.throwIfAborted();
    progress?.(`Translating region ${index + 1} of ${texts.length}`);
    const language = resolveMyMemorySourceLanguage(source, text).language;
    const segments: string[] = [];
    // Sequential requests respect the free provider's limited capacity. Counts
    // and cancellation make that cost explicit instead of pretending to be %.
    for (const chunk of chunkTextByBytes(text, MYMEMORY_BYTE_LIMIT)) {
      signal?.throwIfAborted();
      const params = new URLSearchParams({ q: chunk, langpair: buildMyMemoryLangPair(language, target) });
      const response = await fetchWithTimeout(`https://api.mymemory.translated.net/get?${params}`, { signal }, { timeoutMs: 30000, maxResponseBytes: 256 * 1024 });
      if (!response.ok) throw new Error(`MyMemory could not translate region ${index + 1} (${response.status}). Try again later.`);
      const data = response.json as { responseData?: { translatedText?: unknown } } | null;
      assertMyMemoryStatus(data);
      segments.push(ensureTranslatedText(data?.responseData?.translatedText, chunk, 'MyMemory'));
    }
    translations.push(segments.join(' '));
  }
  const { entries, verdict } = classifyTranslations({ blocks: texts.map((text) => ({ text })), translations, sourceLanguage: source, targetLanguage: target });
  if (verdict) throw new Error(verdict.reason === 'identical-output'
    ? 'MyMemory returned the original text for every region. No translated image was created.'
    : 'MyMemory returned no usable translations. No translated image was created.');
  // Keep indices aligned, but only pass classified translations to the renderer.
  // A mixed response can contain source echoes alongside useful translations.
  return entries.map((entry) => entry.status === 'translated' ? entry.translation : '');
}
