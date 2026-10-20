package com.shilapi.xcertplay.airplay

import java.util.Locale
import java.util.concurrent.atomic.AtomicLong

/** Receive-thread timing only: no payloads, endpoint addresses, or route data. */
internal class StreamReceiveStats(
    private val label: String,
    private val report: (String) -> Unit,
    private val nowNs: () -> Long = System::nanoTime,
) {
    private var windowStart = nowNs()
    private var readStart = windowStart
    private var processingStart = windowStart
    private var packets = 0
    private var bytes = 0L
    private var maxReadNs = 0L
    private var readsOver250Ms = 0
    private var seqGapAfterReadOver250Ms = 0
    private var seqMissingAfterReadOver250Ms = 0
    private var lastReceivedNs = 0L
    private var maxInterArrivalNs = 0L
    private var maxProcessNs = 0L
    private var lastTimestamp: Int? = null
    private var nextSequence: Int? = null
    private var forwardGapPackets = 0
    private var sequenceGapEvents = 0
    private var maxSequenceGap = 0
    private var lastSequenceGap = "none"
    private var lastSequenceGapAtMs = -1L
    private var lateOrDuplicate = 0
    private var decryptSamples = 0
    private var decryptBytes = 0L
    private var decryptSumNs = 0L
    private var maxDecryptNs = 0L
    private val videoSourceId = if (label == "video") videoSources.incrementAndGet() else null
    private var sourceWindow = 0L
    private var videoFrames = 0L
    private var totalVideoFrames = 0L
    private var previousVideoArrivalNs: Long? = null
    private var previousVideoSenderNs: Long? = null
    private var arrivalSteps = 0L
    private var maxVideoArrivalNs = 0L
    private var videoArrivalsOver50Ms = 0L
    private var videoArrivalsOver250Ms = 0L
    private var ptsPositiveSteps = 0L
    private var ptsMissing = 0L
    private var ptsRepeat = 0L
    private var ptsBackwards = 0L
    private var minVideoPtsNs: Long? = null
    private var maxVideoPtsNs = 0L
    private var sumVideoPtsNs = 0.0
    private data class VideoGap(val fromFrame: Long, val toFrame: Long, val ptsNs: Long?, val arrivalNs: Long?)
    private var maxPtsPair: VideoGap? = null
    private var maxArrivalPair: VideoGap? = null

    fun reading() { readStart = nowNs() }

    fun received(size: Int, sequence: Int? = null, timestamp: Int? = null) {
        processingStart = nowNs()
        val readNs = processingStart - readStart
        maxReadNs = maxOf(maxReadNs, readNs)
        if (readNs >= LONG_READ_NS) readsOver250Ms++
        if (lastReceivedNs != 0L) {
            maxInterArrivalNs = maxOf(maxInterArrivalNs, processingStart - lastReceivedNs)
        }
        lastReceivedNs = processingStart
        packets++
        bytes += size
        if (sequence != null) {
            val expected = nextSequence
            val delta = if (expected == null) 0 else (sequence - expected) and 0xffff
            if (delta < 0x8000) {
                forwardGapPackets += delta
                if (delta > 0) {
                    sequenceGapEvents++
                    if (readNs >= LONG_READ_NS) {
                        seqGapAfterReadOver250Ms++
                        seqMissingAfterReadOver250Ms += delta
                    }
                    maxSequenceGap = maxOf(maxSequenceGap, delta)
                    lastSequenceGap = "expected=$expected received=$sequence missing=$delta " +
                        "previousRtpTs=${lastTimestamp?.toUnsignedLong() ?: "unknown"} " +
                        "receivedRtpTs=${timestamp?.toUnsignedLong() ?: "unknown"}"
                    lastSequenceGapAtMs = (processingStart - windowStart) / 1_000_000L
                }
                nextSequence = (sequence + 1) and 0xffff
            } else lateOrDuplicate++
        }
        if (timestamp != null) lastTimestamp = timestamp
    }

    /** A complete OP_VIDEO_FRAME body, before decrypt/forward; config and keepalives never call this.
     * Sender timestamps are NTP-derived; only adjacent values in that same domain are compared.
     * Arrival timestamps reuse the receive loop's monotonic body-completion time.
     */
    fun videoFrame(senderNanos: Long, arrivalNanos: Long) {
        if (videoSourceId == null) return
        videoFrames++
        totalVideoFrames++
        val ptsInterval = if (senderNanos == 0L) null else previousVideoSenderNs?.let { senderNanos - it }
        previousVideoArrivalNs?.let { previous ->
            val interval = arrivalNanos - previous
            if (interval >= 0L) {
                arrivalSteps++
                if (maxArrivalPair == null || interval > maxVideoArrivalNs) {
                    maxArrivalPair = VideoGap(totalVideoFrames - 1, totalVideoFrames, ptsInterval, interval)
                    maxVideoArrivalNs = interval
                }
                if (interval >= 50_000_000L) videoArrivalsOver50Ms++
                if (interval >= LONG_READ_NS) videoArrivalsOver250Ms++
            }
        }
        if (senderNanos == 0L) {
            ptsMissing++
            previousVideoSenderNs = null
            previousVideoArrivalNs = arrivalNanos
            return
        }
        previousVideoSenderNs?.let { previous ->
            val interval = senderNanos - previous
            when {
                interval > 0L -> {
                    ptsPositiveSteps++
                    minVideoPtsNs = minOf(minVideoPtsNs ?: interval, interval)
                    if (interval > maxVideoPtsNs) {
                        maxVideoPtsNs = interval
                        maxPtsPair = VideoGap(totalVideoFrames - 1, totalVideoFrames, interval,
                            previousVideoArrivalNs?.let { arrivalNanos - it })
                    }
                    sumVideoPtsNs += interval.toDouble()
                }
                interval == 0L -> ptsRepeat++
                else -> ptsBackwards++
            }
        }
        previousVideoSenderNs = senderNanos
        previousVideoArrivalNs = arrivalNanos
    }

    /** One payload opened in [durationNs]; reported only for streams that call it. */
    fun decrypted(durationNs: Long, size: Int) {
        decryptSamples++
        decryptBytes += size
        decryptSumNs += durationNs
        maxDecryptNs = maxOf(maxDecryptNs, durationNs)
    }

    fun processed() {
        maxProcessNs = maxOf(maxProcessNs, nowNs() - processingStart)
        flush()
    }

    fun flush(ended: Boolean = false) {
        val now = nowNs()
        if (!ended && now - windowStart < 5_000_000_000L) return
        runCatching { report("Receive: $label packets=$packets bytes=$bytes readMaxMs=${maxReadNs / 1_000_000} " +
            "processMaxUs=${maxProcessNs / 1000} seqForwardGaps=$forwardGapPackets " +
            "lateOrDuplicate=$lateOrDuplicate interArrivalMaxMs=${maxInterArrivalNs / 1_000_000} " +
            "seqGapEvents=$sequenceGapEvents seqGapMax=$maxSequenceGap " +
            "seqGapLast=[$lastSequenceGap] seqGapAtMs=$lastSequenceGapAtMs ended=$ended " +
            "windowMs=${(now - windowStart).coerceAtLeast(0) / 1_000_000} " +
            "readsOver250Ms=$readsOver250Ms seqGapAfterReadOver250Ms=$seqGapAfterReadOver250Ms " +
            "seqMissingAfterReadOver250Ms=$seqMissingAfterReadOver250Ms" + decryptSummary()) }
        if (videoSourceId != null) {
            sourceWindow++
            runCatching { report(videoSourceSummary(now, ended)) }
            runCatching { report(videoSourceGapSummary()) }
        }
        windowStart = now
        decryptSamples = 0
        decryptBytes = 0
        decryptSumNs = 0
        maxDecryptNs = 0
        packets = 0
        bytes = 0
        maxReadNs = 0
        readsOver250Ms = 0
        seqGapAfterReadOver250Ms = 0
        seqMissingAfterReadOver250Ms = 0
        maxInterArrivalNs = 0
        maxProcessNs = 0
        forwardGapPackets = 0
        sequenceGapEvents = 0
        maxSequenceGap = 0
        lastSequenceGap = "none"
        lastSequenceGapAtMs = -1L
        lateOrDuplicate = 0
        videoFrames = 0
        arrivalSteps = 0
        maxVideoArrivalNs = 0
        videoArrivalsOver50Ms = 0
        videoArrivalsOver250Ms = 0
        ptsPositiveSteps = 0
        ptsMissing = 0
        ptsRepeat = 0
        ptsBackwards = 0
        minVideoPtsNs = null
        maxVideoPtsNs = 0
        sumVideoPtsNs = 0.0
        maxPtsPair = null
        maxArrivalPair = null
    }

    private fun videoSourceSummary(now: Long, ended: Boolean): String {
        val duration = (now - windowStart).coerceAtLeast(0)
        val fps = if (duration > 0L) String.format(Locale.ROOT, "%.1f", videoFrames * 1e9 / duration) else "unknown"
        val first = if (videoFrames > 0L) (totalVideoFrames - videoFrames + 1).toString() else "unknown"
        val last = if (videoFrames > 0L) totalVideoFrames.toString() else "unknown"
        val ptsMin = minVideoPtsNs?.div(1000)?.toString() ?: "unknown"
        val ptsMean = if (ptsPositiveSteps > 0L) (sumVideoPtsNs / ptsPositiveSteps / 1000).toLong().toString() else "unknown"
        val ptsMax = if (ptsPositiveSteps > 0L) (maxVideoPtsNs / 1000).toString() else "unknown"
        val arrivalMax = if (arrivalSteps > 0L) (maxVideoArrivalNs / 1_000_000).toString() else "unknown"
        return "Video source: stream=$videoSourceId window=$sourceWindow firstFrame=$first lastFrame=$last " +
            "frames=$videoFrames fps=$fps windowMs=${duration / 1_000_000} " +
            "ptsPositiveSteps=$ptsPositiveSteps ptsMissing=$ptsMissing ptsRepeat=$ptsRepeat ptsBackwards=$ptsBackwards " +
            "ptsMinUs=$ptsMin ptsMeanUs=$ptsMean ptsMaxUs=$ptsMax " +
            "arrivalSteps=$arrivalSteps arrivalMaxMs=$arrivalMax " +
            "arrivalOver50Ms=$videoArrivalsOver50Ms arrivalOver250Ms=$videoArrivalsOver250Ms ended=$ended"
    }

    /** Maxima can belong to different adjacent frames; retain each pair's other clock-domain gap. */
    private fun videoSourceGapSummary(): String {
        fun ptsState(gap: VideoGap?): String = when {
            gap?.ptsNs == null -> "unknown"
            gap.ptsNs > 0L -> "forward"
            gap.ptsNs == 0L -> "repeat"
            else -> "backwards"
        }
        fun frame(value: Long?) = value?.toString() ?: "unknown"
        fun us(value: Long?) = value?.div(1000)?.toString() ?: "unknown"
        return "Video source gap: stream=$videoSourceId window=$sourceWindow " +
            "maxPtsFrom=${frame(maxPtsPair?.fromFrame)} maxPtsTo=${frame(maxPtsPair?.toFrame)} " +
            "maxPtsState=${ptsState(maxPtsPair)} maxPtsGapUs=${us(maxPtsPair?.ptsNs)} " +
            "maxPtsArrivalGapUs=${us(maxPtsPair?.arrivalNs)} " +
            "maxArrivalFrom=${frame(maxArrivalPair?.fromFrame)} maxArrivalTo=${frame(maxArrivalPair?.toFrame)} " +
            "maxArrivalPtsState=${ptsState(maxArrivalPair)} maxArrivalPtsGapUs=${us(maxArrivalPair?.ptsNs)} " +
            "maxArrivalGapUs=${us(maxArrivalPair?.arrivalNs)}"
    }

    private fun Int.toUnsignedLong(): Long = toLong() and 0xffff_ffffL

    private fun decryptSummary(): String {
        if (decryptSamples == 0) return ""
        val mbPerSecond = if (decryptSumNs == 0L) 0L else decryptBytes * 1_000L / decryptSumNs
        return " decryptAvgUs=${decryptSumNs / decryptSamples / 1000} decryptMaxUs=${maxDecryptNs / 1000} " +
            "decryptMBps=$mbPerSecond"
    }

    private companion object {
        const val LONG_READ_NS = 250_000_000L
        val videoSources = AtomicLong(0)
    }

}
