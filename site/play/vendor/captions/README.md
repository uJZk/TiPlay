# Embedded caption parser

The caption parser and extractor are built from the corresponding sources in
`scripts/captions/`. The dependency source archive is retained under `source/`,
with its registry integrity recorded in `artifacts.json`. Apache-2.0 notices are
in `THIRD_PARTY_LICENSES.txt`; TiPlay's adapter/extractor is GPL-3.0-only.

The parser restores CEA-608 and TiPlay's limited plain-text CEA-708 service support.
It does not render captions or schedule playback. AVPlayer retains the media and
subtitle clock. See the source README for the decoder boundaries and build checks.
