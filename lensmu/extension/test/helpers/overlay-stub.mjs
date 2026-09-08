// Stand-in for overlay.js inside the content-script lifecycle tests: the
// real grouping and speech-text logic, and a renderer that records what it
// was asked to draw instead of painting a fake canvas.
export { groupTextBlocks, buildSpeechText } from '../../overlay.js';

export const renderCalls = [];

export function renderTranslation(canvas, image, blocks, translations) {
  renderCalls.push({ canvas, blocks, translations });
  const rendered = translations.filter((text) => String(text || '').trim()).length;
  return { rendered, skipped: translations.length - rendered, unfit: 0, unfitIndices: [] };
}
