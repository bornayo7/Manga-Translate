import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextDisplayPlan } from '../shared/text-layout.js';
import { renderTranslation } from '../overlay.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { resolveImagePlacement } from '../render/image-placement.js';

const graphemes = (text) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((x) => x.segment);
const measureText = (text, size) => graphemes(text).length * size;

test('vertical display plans preserve combined/emoji graphemes and fit every placement', () => {
  const text = 'あか\u3099😀👩‍👩‍👧‍👦あ';
  const plan = createTextDisplayPlan({ measureText, text, maxWidth: 48, maxHeight: 120, isVertical: true });
  assert.equal(plan.fits, true);
  assert.deepEqual(plan.placements.map((p) => p.text), graphemes(text));
  for (const p of plan.placements) {
    assert.ok(p.x >= 0 && p.x + measureText(p.text, plan.fontSize) <= 48);
    assert.ok(p.y >= 0 && p.y + plan.lineHeight <= 120);
  }
});

test('real overlay paint consumes the fitted whole glyphs, with no surrogate splitting', () => {
  const document = new FakeDocument(); const canvas = document.createElement('canvas');
  canvas.style.width = '300px'; canvas.style.height = '200px';
  const text = 'ああ😀ああ';
  const report = renderTranslation(canvas, { naturalWidth: 300, naturalHeight: 200 }, [{
    text: 'original', orientation: 'vertical', bbox: { x: 10, y: 10, width: 35, height: 180 }, confidence: .9
  }], [text], { showConfidenceBorders: false });
  assert.equal(report.rendered, 1);
  assert.deepEqual(canvas.getContext('2d').calls.map((call) => call.text), graphemes(text));
  assert.equal(report.outcomes[0].status, 'rendered');
});

test('horizontal alignment is resolved once into absolute glyph origins', () => {
  for (const [alignment, expected] of [['left', 0], ['center', 30], ['right', 60]]) {
    const plan = createTextDisplayPlan({ measureText, text: 'test', maxWidth: 100, maxHeight: 20, minFontSize: 10, maxFontSize: 10, alignment });
    assert.equal(plan.placements[0].x, expected);
  }
});

test('object-fit and background sizing share one source-pixel transform', () => {
  const options = { width: 300, height: 300, naturalWidth: 300, naturalHeight: 200 };
  const contain = resolveImagePlacement({ ...options, fit: 'contain' });
  assert.equal(contain.y, 50); assert.equal(contain.height, 200);
  const cover = resolveImagePlacement({ ...options, fit: 'cover', position: 'right bottom' });
  assert.equal(cover.x, -150); assert.equal(cover.scaleX, 1.5);
  const size = resolveImagePlacement({ ...options, size: '50% auto', position: '0% 0%' });
  assert.equal(size.width, 150); assert.equal(size.height, 100);
  assert.equal(resolveImagePlacement({ ...options, position: 'calc(100% - 2px) 50%' }), null);
});

test('real overlay paints contained content at its letterbox offset and reports cropped regions', () => {
  const document = new FakeDocument(); const canvas = document.createElement('canvas');
  canvas.style.width = '300px'; canvas.style.height = '300px';
  const original = { naturalWidth: 300, naturalHeight: 200 };
  const blocks = [{ text: 'original', bbox: { x: 10, y: 10, width: 100, height: 40 } }];
  const report = renderTranslation(canvas, original, blocks, ['Hello'], { imagePlacement: { fit: 'contain' } });
  assert.equal(report.rendered, 1);
  assert.ok(canvas.getContext('2d').calls.every((call) => call.y >= 50));
  const cropped = renderTranslation(canvas, original, blocks, ['Hello'], { imagePlacement: { fit: 'cover' } });
  assert.equal(cropped.rendered, 0); assert.equal(cropped.outcomes[0].reason, 'out-of-bounds');
});
