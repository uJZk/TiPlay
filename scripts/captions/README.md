# Embedded caption parser

This bundle extracts registered ATSC CEA data from original AVC/HEVC SEI and
decodes display-state updates. It has no renderer, playback clock, timer or media
loader. The AVPlayer adapter owns presentation order, source generation and reset
boundaries; AVPlayer owns when and where an update is shown.

CEA-608 decoding uses the pinned hls.js parser. Its public channel display memory
is sampled after each source-timed byte pair, rather than using a second cue
scheduler. CEA-708 restores TiPlay's previous plain-text service/window decoder:
colors, fonts, positioning and window-layout fidelity are not implemented. That
limited text support must not be described as complete CEA-708 conformance.

Packets and output are bounded. A reset discards decoding state without emitting
old-generation callbacks; the owner must clear its presentation queue at the same
boundary. An empty update clears only a service already discovered from caption
text. Missing or invalid caption data never creates synthetic menu entries.
The registered-data extractor accepts the ATSC `GA94` provider envelope used by
the previous implementation; `DTG1` and other provider formats are not decoded.

Use the locked dependency installation followed by `npm run build`, or
`npm run check` to compare the complete generated artifacts. The build verifies
the source archive against the dependency lock; generated resources and complete
hls.js package sources are under `site/play/vendor/captions/`. This parser uses
TiPlay GPL-3.0-only code and hls.js Apache-2.0 code; retained notices accompany the
bundle.
