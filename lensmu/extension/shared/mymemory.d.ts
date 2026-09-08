export const MYMEMORY_BYTE_LIMIT: number;

export function exceedsMyMemoryLimit(text: unknown): boolean;

export function resolveMyMemorySourceLanguage(
  sourceLang: unknown,
  text: unknown
): { language: string; detected: boolean; reason: string };

export function buildMyMemoryLangPair(sourceLanguage: string, targetLang: unknown): string;

export function assertMyMemoryStatus(data: unknown): void;

export function ensureTranslatedText(
  rawTranslatedText: unknown,
  originalText: string,
  providerName?: string
): string;
