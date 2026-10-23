# Local QR encoder

`qrcode-generator.js` contains qrcode-generator **1.4.4** by Kazuhiko Arase,
licensed under MIT. Its copyright header is retained; the full license is in
`QR-LICENSE.txt`. The only adaptation replaces the AMD/CommonJS export footer
with an ES module export, so the standalone diagnostic page needs no global
variables, evaluation permission or runtime network dependency.

`provenance.json` records the fixed npm source archive, original/bundled file
hashes, license source and adaptation. The npm archive declares MIT but does not
bundle a separate license file; the bundled text is the upstream repository's
MIT license with the same 2009 Kazuhiko Arase copyright.

The caller supplies only a bounded ASCII URL. The wrapper uses byte mode, M
error correction, a four-module quiet zone and integer pixels per module.
