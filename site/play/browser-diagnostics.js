/*! SPDX-License-Identifier: GPL-3.0-only */
import { flatStats } from './link.js';

// Keep this identifier in step with the offline cache; the receiver records the loaded page.
export const PAGE_VERSION = 'v54';
export const AUDIO_DIAGNOSTIC_BYTES = 16 * 1024;

/** Audio details have their own budget, so video stats cannot crowd out render evidence. */
export function browserDiagnosticEvents(page, themeDark, debug = false, debugSession = null) {
  const { debug: audioDebug, ...audio } = page.audio ?? {};
  const events = [{ k: 'st', v: {
    ...flatStats({ page: { version: PAGE_VERSION }, ...page, audio }), themeDark,
  } }];
  if (debug && audioDebug) {
    const full = flatStats(audioDebug, Infinity);
    // The receiver admits at most 256 fields, including these two metadata fields.
    const values = Object.fromEntries(Object.entries(flatStats(audioDebug, AUDIO_DIAGNOSTIC_BYTES - 128)).slice(0, 254));
    const omitted = Object.keys(full).length - Object.keys(values).length;
    values.pageVersion = PAGE_VERSION;
    values.omittedFields = omitted;
    events.push({ k: 'audio-diag', d: debugSession, v: values });
  }
  return events;
}
