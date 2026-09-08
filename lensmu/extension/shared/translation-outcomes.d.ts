export type TranslationEntry = {
  index: number;
  sourceText: string;
  translation: string;
  status: 'translated' | 'skipped' | 'failed';
  reason: string;
  identical: boolean;
};

export type TranslationVerdict = { status: 'skipped' | 'failed'; reason: string };

export function languagesClearlyDiffer(sourceLang: string, targetLang: string): boolean;

export function buildTranslationEntries(
  blocks?: Array<{ text?: string }>,
  translations?: string[],
  reportedOutcomes?: Array<{ status?: string; reason?: string }> | null
): TranslationEntry[];

export function classifyTranslations(options?: {
  blocks?: Array<{ text?: string }>;
  translations?: string[];
  reportedOutcomes?: Array<{ status?: string; reason?: string }> | null;
  sourceLanguage?: string;
  targetLanguage?: string;
}): {
  entries: TranslationEntry[];
  translated: TranslationEntry[];
  skipped: TranslationEntry[];
  failed: TranslationEntry[];
  /** null when there is something worth rendering. */
  verdict: TranslationVerdict | null;
};
