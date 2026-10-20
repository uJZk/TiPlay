package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.diagnostics.RawTraffic

/** One replayable copy of outgoing audio records; transport outcomes only reference that copy. */
internal class BrowserRtcAudioCapture(
    epoch: Int,
    private val enabled: () -> Boolean = { RawTraffic.enabled },
    private val record: (String, ByteArray) -> Unit = { channel, bytes -> RawTraffic.record(channel, bytes) },
) {
    private val channel = "browser/audio/rtc/$epoch"
    private var attempts = 0L

    fun send(sequence: Int, bytes: ByteArray, submit: () -> Unit) {
        if (!enabled()) { submit(); return }
        // Capture before admission/fragments so a partial or failed send remains replayable.
        // RawTraffic flushes synchronously and reports storage failure in capture integrity.
        val attempt = ++attempts
        record("$channel/records", bytes)
        event(attempt, sequence, bytes.size, "attempt")
        try {
            submit()
            // All fragments accepted by local SCTP. This does not establish remote receipt,
            // parser consumption, decoder admission or physical audio-device output.
            event(attempt, sequence, bytes.size, "local-enqueue")
        } catch (error: Exception) {
            event(attempt, sequence, bytes.size, "failed", DiagnosticErrorText.describe(error))
            throw error
        }
    }

    private fun event(attempt: Long, sequence: Int, bytes: Int, phase: String, error: String? = null) {
        val fields = linkedMapOf<String, Any?>("attempt" to attempt, "sequence" to (sequence.toLong() and 0xffff_ffffL),
            "bytes" to bytes, "phase" to phase)
        if (error != null) fields["error"] = error
        record("$channel/events", (WebJson.write(fields) + "\n").toByteArray(Charsets.UTF_8))
    }
}
