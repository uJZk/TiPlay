// SPDX-License-Identifier: GPL-3.0-only
// Main-thread plumbing fixtures do not execute DSP. Worklet/quality acceptance loads the real module.
const module = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
export const loadTestResampler = async () => module;
