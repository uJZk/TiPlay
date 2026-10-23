// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderQr } from '../../site/play/chatgpt/qr.js';

function canvas() {
  const target = { width: 0, height: 0 }, rectangles = [];
  const context = { fillStyle: '', fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); } };
  target.getContext = kind => kind === '2d' ? context : null;
  return { target, context, rectangles };
}
const prefix = 'https://ujzk.github.io/TiPlay/chatgpt/#r2.j.';

test('the QR renderer keeps an integer grid and four-module quiet zone at the payload ceiling', () => {
  for (const text of [prefix + 'e30', prefix + 'A'.repeat(800), prefix + 'a'.repeat(1900 - prefix.length)]) {
    const { target, context, rectangles } = canvas();
    const code = renderQr(target, text);
    assert.equal(code.errorCorrectionLevel, 'M'); assert.equal(code.quietZone, 4);
    assert.ok(Number.isSafeInteger(code.scale) && code.scale >= 2);
    assert.equal(code.pixels, target.width); assert.equal(target.width, target.height);
    assert.equal(code.pixels, (code.moduleCount + 8) * code.scale);
    assert.equal(context.imageSmoothingEnabled, false);
    assert.deepEqual(rectangles[0], { x: 0, y: 0, width: code.pixels, height: code.pixels, color: '#ffffff' });
    for (const rect of rectangles.slice(1)) {
      assert.equal(rect.color, '#000000'); assert.equal(rect.width, code.scale); assert.equal(rect.height, code.scale);
      assert.ok(rect.x >= 4 * code.scale && rect.y >= 4 * code.scale);
      assert.ok(rect.x + rect.width <= code.pixels - 4 * code.scale && rect.y + rect.height <= code.pixels - 4 * code.scale);
    }
  }
});

test('bad, oversized and excessively small QR requests fail before presenting an unreadable code', () => {
  for (const input of ['', null, undefined, 'a'.repeat(1901), 'has space', '含中文', '\n']) {
    const { target, rectangles } = canvas();
    assert.throws(() => renderQr(target, input), /ASCII/); assert.deepEqual(rectangles, []);
  }
  for (const maxPixels of [0, 63, 640.5, 1025, Infinity, NaN]) assert.throws(() => renderQr(canvas().target, prefix, { maxPixels }), /尺寸/);
  assert.throws(() => renderQr(canvas().target, prefix + 'a'.repeat(1900 - prefix.length), { maxPixels: 64 }), /屏幕不足/);
  assert.throws(() => renderQr({ getContext: () => null }, prefix), /无法绘制/);
});

test('the bundled QR encoder has fixed provenance and no runtime evaluation or network dependency', () => {
  const root = new URL('../../site/play/chatgpt/vendor/', import.meta.url);
  const metadata = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'));
  const bytes = readFileSync(new URL('qrcode-generator.js', root));
  assert.equal(metadata.version, '1.4.4'); assert.equal(metadata.license, 'MIT');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.bundledFileSha256);
  assert.match(readFileSync(new URL('QR-LICENSE.txt', root), 'utf8'), /Copyright \(c\) 2009 Kazuhiko Arase/);
  assert.doesNotMatch(bytes.toString(), /\b(?:eval|fetch|XMLHttpRequest)\s*\(|new Function/);
});
