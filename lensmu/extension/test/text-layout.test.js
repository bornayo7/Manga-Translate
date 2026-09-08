import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutTextBlock, wrapText } from '../shared/text-layout.js';

// Deterministic metrics: every grapheme is 0.6 em wide, CJK glyphs 1 em.
function widthAt(fontSize) {
  return (text) =>
    Array.from(String(text)).reduce(
      (total, char) => total + (/[　-鿿]/.test(char) ? 1 : 0.6) * fontSize,
      0
    );
}
const measureText = (text, fontSize) => widthAt(fontSize)(text);

function assertLayoutInside(layout, maxWidth, maxHeight) {
  assert.equal(layout.fits, true);
  assert.ok(layout.lines.length > 0);
  for (const line of layout.lines) {
    const width = layout.orientation === 'vertical'
      ? layout.fontSize * 1.2
      : measureText(line, layout.fontSize);
    assert.ok(width <= maxWidth + 1e-9, `line "${line}" is ${width}px wide for a ${maxWidth}px box`);
  }
  const stacked = layout.orientation === 'vertical'
    ? layout.lines.length * layout.fontSize * 1.2
    : layout.lines.length * layout.lineHeight;
  const limit = layout.orientation === 'vertical' ? maxWidth : maxHeight;
  assert.ok(stacked <= limit + 1e-9, `${layout.lines.length} lines need ${stacked}px of ${limit}px`);
}

test('the first token is measured like every other token', () => {
  const measure = widthAt(10);
  const { lines, fits } = wrapText(measure, 'Supercalifragilistic short', 30);
  assert.equal(fits, true);
  for (const line of lines) {
    assert.ok(measure(line) <= 30, `"${line}" overflows`);
  }
  assert.equal(lines.join(''), 'Supercalifragilisticshort');
});

test('an unspaced string wraps per grapheme and a single glyph wider than the box is reported', () => {
  const measure = widthAt(10);
  const long = wrapText(measure, 'abcdefghijklmnopqrstuvwxyz0123', 25);
  assert.equal(long.fits, true);
  assert.ok(long.lines.every((line) => measure(line) <= 25));
  assert.equal(long.lines.join(''), 'abcdefghijklmnopqrstuvwxyz0123');

  const tooNarrow = wrapText(measure, 'hello', 3); // a glyph is 6px, the box 3px
  assert.equal(tooNarrow.fits, false);
});

test('a long first word in a narrow bubble either fits or is an explicit no-fit', () => {
  const fitting = layoutTextBlock({ measureText, text: 'Incomprehensibilities yes', maxWidth: 60, maxHeight: 120, minFontSize: 8 });
  assertLayoutInside(fitting, 60, 120);

  const tiny = layoutTextBlock({ measureText, text: 'Incomprehensibilities yes', maxWidth: 40, maxHeight: 12, minFontSize: 10 });
  assert.equal(tiny.fits, false);
  assert.equal(tiny.fontSize, 10, 'the diagnostic layout is the minimum-size attempt');
});

test('every accepted horizontal layout is validated in both dimensions', () => {
  const cases = [
    ['multi-line paragraph', 'The quick brown fox jumps over the lazy dog again and again', 120, 80],
    ['single word', 'Hello', 40, 20],
    ['unspaced japanese', 'これは非常に長い日本語の翻訳テキストです', 90, 60],
    ['chinese', '这是一个很长的中文翻译文本用于测试', 70, 70],
    ['very wide box', 'ok', 500, 30]
  ];
  for (const [label, text, maxWidth, maxHeight] of cases) {
    const layout = layoutTextBlock({ measureText, text, maxWidth, maxHeight, minFontSize: 8 });
    assert.equal(layout.fits, true, `${label} should fit`);
    assertLayoutInside(layout, maxWidth, maxHeight);
  }
});

test('a tiny box or a minimum font that is still too large returns no-fit without dropping characters', () => {
  const tinyBox = layoutTextBlock({ measureText, text: 'Some translated text', maxWidth: 5, maxHeight: 5, minFontSize: 8 });
  assert.equal(tinyBox.fits, false);

  const bigMinimum = layoutTextBlock({ measureText, text: 'Some translated text that is quite long', maxWidth: 60, maxHeight: 20, minFontSize: 16 });
  assert.equal(bigMinimum.fits, false);
  assert.equal(bigMinimum.lines.join(' ').replace(/\s+/g, ''), 'Sometranslatedtextthatisquitelong'.replace(/\s+/g, ''), 'nothing is silently discarded');

  const degenerate = layoutTextBlock({ measureText, text: 'x', maxWidth: 0, maxHeight: 10 });
  assert.equal(degenerate.fits, false);
});

test('vertical CJK layout keeps every column inside the region', () => {
  const layout = layoutTextBlock({
    measureText,
    text: 'これは縦書きのテスト',
    maxWidth: 48,
    maxHeight: 120,
    minFontSize: 8,
    isVertical: true
  });
  assert.equal(layout.fits, true);
  assert.equal(layout.orientation, 'vertical');
  assertLayoutInside(layout, 48, 120);
  assert.equal(layout.lines.join(''), 'これは縦書きのテスト');

  const tooNarrow = layoutTextBlock({ measureText, text: 'これは縦書きのテスト', maxWidth: 8, maxHeight: 120, minFontSize: 10, isVertical: true });
  assert.equal(tooNarrow.fits, false);
});

test('empty text fits trivially and produces nothing to draw', () => {
  const layout = layoutTextBlock({ measureText, text: '   ', maxWidth: 50, maxHeight: 50 });
  assert.equal(layout.fits, true);
  assert.deepEqual(layout.lines, []);
});
