// SPDX-License-Identifier: GPL-3.0-only
// Explicit desktop test instrumentation. Never imported by the product.
export const SOFTWARE_VIDEO = process.env.E2E_SOFTWARE_VIDEO === '1';
const override = `if (globalThis.VideoDecoder && !globalThis.__tiplaySoftwareVideo) {
  globalThis.__tiplaySoftwareVideo = true;
  const NativeVideoDecoder = globalThis.VideoDecoder;
  globalThis.VideoDecoder = class extends NativeVideoDecoder {
    static isConfigSupported(config) { return NativeVideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: 'no-preference' }); }
    configure(config) { return super.configure({ ...config, hardwareAcceleration: 'no-preference' }); }
  };
}`;
export async function configureVideoDecoder(page) {
  if (!SOFTWARE_VIDEO) return;
  await page.addInitScript(override);
  // AVPlayer's non-SAB workers contain serialized upstream code in Blob scripts.
  await page.addInitScript(override => {
    const NativeBlob = globalThis.Blob;
    globalThis.Blob = class extends NativeBlob {
      constructor(parts, options) {
        super(/javascript/.test(options?.type || '') ? [override + '\n', ...parts] : parts, options);
      }
    };
  }, override);
  await page.route('**/vendor/libmedia/**', async route => {
    if (!new URL(route.request().url()).pathname.endsWith('.js')) { await route.continue(); return; }
    const response = await route.fetch();
    await route.fulfill({ response, body: override + '\n' + await response.text() });
  });
}
