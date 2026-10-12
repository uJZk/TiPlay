# AirPlay transport key exchange

`playfair/` is copied without changes from UxPlay commit
`ec203121355220dd90278a369eeabb0b8ba4f14a` (https://github.com/FDH2/UxPlay).
Its GPL-3.0 license is retained in `playfair/LICENSE.md`.
`fairplay_replies.h` contains Juho Vähä-Herttua’s LGPL-2.1-or-later
reply tables from that revision’s `lib/fairplay_playfair.c`.
TiPlay’s JNI wrapper checks input sizes and modes before calling these routines.
These routines negotiate mirroring transport keys. They do not provide
FairPlay Streaming content licenses or decrypt DRM video.
