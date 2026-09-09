// What a provider's answer means for one image, shared by the content
// script and the website demo so the two cannot disagree about when a
// result is worth painting.
//
// The translation manager reports a per-block outcome. This turns that plus
// the returned text into a verdict for the image as a whole, keeping the
// three cases apart that used to collapse into "translation failed":
//
//   every block skipped     nothing to do — the text is already in the
//                           target language, or there was nothing to
//                           translate. Neutral, not an error.
//   nothing came back       blocks were sent and the provider returned no
//                           usable text for any of them. An error.
//   output equals input     every translation matched its source while the
//                           languages clearly differ, so the provider
//                           echoed rather than translated. An error.
//
// Pure functions; no network, no DOM.

import { isEffectivelyIdenticalTranslation, normalizeForComparison } from './text.js';

/*
 * True only when both languages are known and different. "auto" is not a
 * language, so it can never establish a difference.
 */
export function languagesClearlyDiffer(sourceLang, targetLang) {
  const normalizedSource = normalizeForComparison(sourceLang);
  const normalizedTarget = normalizeForComparison(targetLang);

  if (!normalizedSource || !normalizedTarget || normalizedSource === 'auto') {
    return false;
  }

  return normalizedSource !== normalizedTarget;
}

/*
 * One entry per block, in block order:
 *   { index, sourceText, translation, status, reason, identical }
 * status is "translated", "skipped" (never sent) or "failed" (sent, but
 * nothing usable came back).
 *
 * `reportedOutcomes` is the translation manager's per-block report. A
 * worker that predates it sends nothing, and every block is then judged by
 * its content alone — the behaviour before outcomes existed.
 */
export function buildTranslationEntries(blocks = [], translations = [], reportedOutcomes = null) {
  const reported =
    Array.isArray(reportedOutcomes) && reportedOutcomes.length === blocks.length
      ? reportedOutcomes
      : blocks.map(() => ({ status: 'translated', reason: '' }));

  return blocks.map((block, index) => {
    const translation = String(translations[index] || '').trim();
    const entryReport = reported[index] || { status: 'translated', reason: '' };
    const status =
      entryReport.status === 'skipped'
        ? 'skipped'
        : entryReport.status === 'failed'
          ? 'failed'
        : translation.length > 0
          ? 'translated'
          : 'failed';

    return {
      index,
      sourceText: block?.text ?? '',
      translation,
      status,
      reason: entryReport.reason || (status === 'failed' ? 'empty-provider-output' : ''),
      identical: isEffectivelyIdenticalTranslation(block?.text ?? '', translation)
    };
  });
}

/*
 * Returns { entries, translated, skipped, failed, verdict }.
 *
 * `verdict` is null when there is something worth rendering. Otherwise it
 * is the outcome to report instead: { status, reason }, where status is
 * "skipped" for the neutral case and "failed" for a real one.
 */
export function classifyTranslations({
  blocks = [],
  translations = [],
  reportedOutcomes = null,
  sourceLanguage = 'auto',
  targetLanguage = 'en'
} = {}) {
  const entries = buildTranslationEntries(blocks, translations, reportedOutcomes);
  if (languagesClearlyDiffer(sourceLanguage, targetLanguage)) {
    for (const entry of entries) {
      if (entry.status === 'translated' && entry.identical) {
        entry.status = 'failed';
        entry.reason = 'identical-output';
      }
    }
  }
  const translated = entries.filter((entry) => entry.status === 'translated');
  const skipped = entries.filter((entry) => entry.status === 'skipped');
  const failed = entries.filter((entry) => entry.status === 'failed');

  let verdict = null;

  if (translated.length === 0 && failed.length === 0) {
    /* Nothing was ever sent: neutral, and the reason says why. */
    verdict = { status: 'skipped', reason: skipped[0]?.reason || 'skipped' };
  } else if (translated.length === 0) {
    verdict = { status: 'failed', reason: failed[0]?.reason || 'empty-provider-output' };
  }

  return { entries, translated, skipped, failed, verdict };
}
