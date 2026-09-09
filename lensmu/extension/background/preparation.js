import { groupTextBlocks } from '../render/text-regions.js';

// One trusted snapshot spans OCR and translation; a settings change retires
// acceptance without mixing providers or credentials midway through an image.
export function createPreparationPipeline({ loadSettings, recognize, translate }) {
  return async function prepare(payload, { signal } = {}) {
    const settings = await loadSettings();
    const revision = settings.preparationRevision;
    const assertCurrent = async () => {
      signal?.throwIfAborted();
      if ((payload.preparationRevision && payload.preparationRevision !== revision) ||
          (await loadSettings()).preparationRevision !== revision) {
        throw new DOMException('Translation settings changed. Retry this image.', 'AbortError');
      }
    };
    await assertCurrent();
    const ocr = await recognize(payload.imageBase64, settings, { signal, sourceLanguage: settings.sourceLanguage });
    await assertCurrent();
    const rawOcrResults = ocr.blocks;
    const mergedOcrResults = groupTextBlocks(rawOcrResults);
    const sourceLanguage = settings.sourceLanguage === 'auto' ? ocr.source_lang || 'auto' : settings.sourceLanguage;
    const targetLanguage = settings.targetLanguage || 'en';
    const result = await translate(mergedOcrResults.map(block => block.text), sourceLanguage, targetLanguage, settings, { signal });
    await assertCurrent();
    return { rawOcrResults, mergedOcrResults, translations: result.translations, outcomes: result.outcomes,
      sourceLanguage: result.sourceLang || sourceLanguage, targetLanguage: result.targetLang || targetLanguage,
      provider: result.provider, fallback_used: Boolean(result.fallback), diagnostics: result.diagnostics || null,
      warnings: ocr.warnings || [], preparationRevision: revision };
  };
}
