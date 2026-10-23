/*! SPDX-License-Identifier: GPL-3.0-only */
import qrcode from './vendor/qrcode-generator.js';

/** Render a local diagnostic URL as a sharp QR code. The caller constructs the
 * same-page fragment URL; this module never navigates, fetches or uploads it. */
export function renderQr(canvas, text, { maxPixels = 640 } = {}) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 1900 || !/^[\x21-\x7e]+$/.test(text)) {
    throw new Error('二维码内容必须是 1–1900 个 ASCII 字符；请改用拍照结果卡。');
  }
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 64 || maxPixels > 1024) {
    throw new Error('二维码画布尺寸无效。');
  }
  if (!canvas || typeof canvas.getContext !== 'function') throw new Error('此浏览器无法绘制二维码。');
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte'); qr.make();
  const moduleCount = qr.getModuleCount(), quietZone = 4;
  const scale = Math.floor(maxPixels / (moduleCount + quietZone * 2));
  if (scale < 2) throw new Error('屏幕不足以清晰显示此二维码；请改用拍照结果卡。');
  const pixels = (moduleCount + quietZone * 2) * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此浏览器无法绘制二维码。');
  canvas.width = canvas.height = pixels;
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, pixels, pixels);
  context.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row++) for (let column = 0; column < moduleCount; column++) {
    if (qr.isDark(row, column)) context.fillRect((column + quietZone) * scale, (row + quietZone) * scale, scale, scale);
  }
  return { moduleCount, pixels, version: (moduleCount - 17) / 4, scale, quietZone, errorCorrectionLevel: 'M' };
}
