package com.shilapi.xcertplay.airplay

import java.util.concurrent.atomic.AtomicLong

/** Numeric timing evidence only; never logs peer addresses or protocol payloads. */
internal class MediaClockDiagnostics(private val log: (String) -> Unit) {
    private val requestsSent = AtomicLong()
    private val requestsReceived = AtomicLong()
    private val responsesReceived = AtomicLong()
    private val unmatchedResponses = AtomicLong()
    private val sendFailures = AtomicLong()
    @Volatile private var lastPacketType: Int? = null
    @Volatile private var lastRttMicros: Long? = null
    @Volatile private var lastOffsetMillis: Long? = null
    private var lastReportNanos: Long? = null

    fun sent() { requestsSent.incrementAndGet() }
    fun requested() { requestsReceived.incrementAndGet() }
    fun responded(matched: Boolean) {
        responsesReceived.incrementAndGet()
        if (!matched) unmatchedResponses.incrementAndGet()
    }
    fun failed() { sendFailures.incrementAndGet() }
    fun packet(type: Int) { lastPacketType = type }
    fun sample(rttSeconds: Double, offsetSeconds: Double) {
        lastRttMicros = Math.round(rttSeconds * 1_000_000)
        lastOffsetMillis = Math.round(offsetSeconds * 1_000)
    }

    @Synchronized
    fun frame(now: Long, senderNanos: Long, mapped: Long?, synced: Boolean, lastSyncNanos: Long) {
        if (lastReportNanos?.let { now - it < 10_000_000_000L } == true) return
        lastReportNanos = now
        val syncAge = if (synced) (now - lastSyncNanos) / 1_000_000 else null
        val frameAge = mapped?.let { (now - it) / 1_000_000 }
        val message = "Media clock: tx=${requestsSent.get()} rxRequest=${requestsReceived.get()} " +
            "rxResponse=${responsesReceived.get()} unmatched=${unmatchedResponses.get()} " +
            "sendFailures=${sendFailures.get()} synced=$synced syncAgeMs=${syncAge ?: "-"} " +
            "lastPacketType=${lastPacketType ?: "-"} rttUs=${lastRttMicros ?: "-"} " +
            "offsetMs=${lastOffsetMillis ?: "-"} senderZero=${senderNanos == 0L} frameAgeMs=${frameAge ?: "-"}"
        runCatching { log(message) }
    }
}
