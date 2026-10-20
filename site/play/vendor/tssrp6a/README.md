# tssrp6a

Unmodified ESM JavaScript from npm `tssrp6a@3.0.0`, under the included MIT LICENSE by Benjamin Grosse,
Dmitry Bufistov and Denis Kruschinski. Source: https://github.com/midonet/tssrp6a.

Tarball: https://registry.npmjs.org/tssrp6a/-/tssrp6a-3.0.0.tgz

Tarball SHA-256: `e032b72b15cd2bcb0decac0cffb110b732cece98998bde0f046930117f2be2a3`.

TiPlay imports the RFC 5054 2048-bit group, SRP6a client, and WebCrypto utilities.
The separate `rtc-pairing.js` adapter selects SHA-256 and Bouncy Castle compatible
padded evidence/identity routines, then authenticates SDP with HMAC-SHA256 over
the established session key. No password or reusable password hash is sent over HTTP.
The existing online pairing lockout also covers these exchanges. The library's
private-value and modular arithmetic implementation is retained unmodified.

Keep the accompanying LICENSE and update checksums and cross-language vectors
when upgrading. Source map references belong to the upstream build; maps are not
needed at runtime.

The upstream package metadata says Apache-2.0, while the distributed LICENSE
explicitly grants MIT terms. TiPlay retains both metadata and the LICENSE verbatim.
