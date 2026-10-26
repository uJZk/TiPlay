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

    /** Native routing is asynchronous. This boundary proves an attempt, never RTP transmission. */
    fun route(sequence: Int, bytes: ByteArray, submit: () -> Unit) {
        if (!enabled()) { submit(); return }
        val attempt = ++attempts
        val routeChannel = "$channel/rtp"
        record("$routeChannel/records", bytes)
        event(attempt, sequence, bytes.size, "route-attempt", path = routeChannel)
        try {
            submit()
            event(attempt, sequence, bytes.size, "route-returned", path = routeChannel)
        } catch (error: Exception) {
            event(attempt, sequence, bytes.size, "route-failed", DiagnosticErrorText.describe(error), routeChannel)
            throw error
        }
    }

    /** Metadata references the captured source owner; do not copy an original codec record again. */
    fun nativeMetadata(sequence: Int, bytes: ByteArray) {
        if (!enabled() || bytes.size < 28 || bytes[4].toInt() != 6) return
        val config = WebJson.parse(String(bytes, 28, bytes.size - 28, Charsets.UTF_8)) as? Map<*, *> ?: return
        val fields = mapOf("sequence" to (sequence.toLong() and 0xffff_ffffL), "phase" to "metadata-local-enqueue",
            "bytes" to bytes.size, "type" to (bytes[5].toInt() and 255), "modeFlags" to (bytes[7].toInt() and 12),
            "epoch" to java.nio.ByteBuffer.wrap(bytes).getInt(16), "rtpSlot" to config["rtpSlot"],
            "rtcGeneration" to config["rtcGeneration"], "rtcOwnerEpoch" to config["rtcOwnerEpoch"], "ended" to config["ended"])
        record("$channel/rtp/events", (WebJson.write(fields) + "\n").toByteArray(Charsets.UTF_8))
    }

    private fun event(attempt: Long, sequence: Int, bytes: Int, phase: String, error: String? = null, path: String = channel) {
        val fields = linkedMapOf<String, Any?>("attempt" to attempt, "sequence" to (sequence.toLong() and 0xffff_ffffL),
            "bytes" to bytes, "phase" to phase)
        if (error != null) fields["error"] = error
        record("$path/events", (WebJson.write(fields) + "\n").toByteArray(Charsets.UTF_8))
    }
}
