// SPDX-License-Identifier: GPL-3.0-only
// Adapted from WheelPlay (https://github.com/fython/wheelplay), GPL-3.0-only,
// common/src/main/java/com/shilapi/xcertplay/web/RtcFrameQueue.kt at commit c1bd077. Modified for TiPlay, 2026-10.
package com.shilapi.xcertplay.web

/**
 * The records waiting for one media writer. Caller holds the hub lock. Reliable delivery preserves
 * admitted frames in order, measures old media, and fails explicitly on finite-capacity overflow.
 * The retained HTTP queue drops a dependency chain on age/overflow and resumes at a key frame
 * carrying [WebVideoRecords.FLAG_DISCONTINUITY].
 * Config records keep their place between frames. A full config budget rejects the new record so the caller
 * can end the subscription instead of continuing without a required configuration.
 */
internal class WebFrameQueue(
    // TCP retransmits instead of losing packets, so allow more than WheelPlay's 50 ms WebRTC budget.
    private val maxAgeNanos: Long = 150_000_000,
    private val maxBytes: Int = 4 * 1024 * 1024,
    private val maxFrames: Int = 10,
    private val maxConfigs: Int = 8,
    private val maxConfigBytes: Int = WebVideoRecords.MAX_PAYLOAD,
    private val reliable: Boolean = false,
) {
    private val records = ArrayDeque<WebVideoRecord>()
    /** A reliable queue fails explicitly rather than resuming after loss of a reference frame. */
    var failureReason: String? = null; private set
    private var started = false
    private var gap = false
    var configCount = 0; private set
    var configBytes = 0; private set
    var boundaryCount = 0; private set
    var size = 0; private set
    var bytes = 0; private set
    var needsKeyFrame = true; private set
    /** When the queue began waiting for a key frame, or null while it is not waiting. */
    var waitingSinceNanos: Long? = null; private set
    var expired = 0L; private set
    var overflow = 0L; private set
    var skipped = 0L; private set
    /** Reliable input keeps its dependency chain; old media is measured rather than erased. */
    var overAgeFrames = 0L; private set
    var maxQueueAgeNanos = 0L; private set

    /** Queues a frame; false when it was skipped while waiting for a key frame or is larger than the queue. */
    fun offer(frame: WebVideoRecord, now: Long): Boolean {
        if (failureReason != null) return false
        expire(now)
        if (failureReason != null) return false
        val cost = frame.payloadLength
        if (reliable && (cost > maxBytes || size >= maxFrames || cost > maxBytes - bytes)) {
            overflow++
            failureReason = "reliable-overload"
            return false
        }
        if (cost > maxBytes) { overflow++; invalidate(now); return false }
        if (size >= maxFrames || cost > maxBytes - bytes) {
            overflow += size
            invalidate(now)
        }
        if (needsKeyFrame && !frame.keyFrame) {
            if (waitingSinceNanos == null) waitingSinceNanos = now
            skipped++
            // Deltas before the first key frame of a subscription are not a gap in what the page has seen.
            if (started) gap = true
            return false
        }
        records.addLast(if (gap) frame.withFlags(WebVideoRecords.FLAG_DISCONTINUITY) else frame)
        size++
        bytes += cost
        needsKeyFrame = false
        waitingSinceNanos = null
        started = true
        gap = false
        return true
    }

    /** Queues a config record; the next frame must be a key frame of the new configuration. */
    fun offerConfig(config: WebVideoRecord, now: Long): Boolean {
        if (failureReason != null) return false
        if (configCount >= maxConfigs || config.payloadLength > maxConfigBytes - configBytes) {
            if (reliable) failureReason = "reliable-overload"
            return false
        }
        records.addLast(config)
        configCount++
        configBytes += config.payloadLength
        requireKeyFrame(now)
        return true
    }

    /** A source boundary follows admitted AUs and precedes the next configuration, without a subscriber gap. */
    fun offerBoundary(now: Long): Boolean {
        check(reliable)
        if (failureReason != null) return false
        if (records.lastOrNull()?.kind == WebVideoRecords.KIND_IDLE) return true
        if (boundaryCount >= maxConfigs) {
            failureReason = "reliable-overload"
            return false
        }
        records.addLast(WebVideoRecords.IDLE)
        boundaryCount++
        requireKeyFrame(now)
        return true
    }

    /** Releases all retained payloads when a subscription ends. */
    fun clear() {
        records.clear()
        size = 0
        bytes = 0
        configCount = 0
        configBytes = 0
        boundaryCount = 0
        waitingSinceNanos = null
        needsKeyFrame = true
    }

    fun poll(now: Long): WebVideoRecord? {
        if (failureReason != null) return null
        expire(now)
        if (failureReason != null) return null
        val record = records.removeFirstOrNull() ?: return null
        if (record.kind == WebVideoRecords.KIND_FRAME) {
            if (reliable && now - record.queuedAtNanos >= maxAgeNanos) overAgeFrames++
            size--
            bytes -= record.payloadLength
        } else if (record.kind == WebVideoRecords.KIND_CONFIG) {
            configCount--
            configBytes -= record.payloadLength
        } else if (record.kind == WebVideoRecords.KIND_IDLE) {
            boundaryCount--
        }
        return record
    }

    /** Drops every queued frame; frames are skipped until the next key frame. */
    fun invalidate(now: Long) {
        records.removeAll { it.kind == WebVideoRecords.KIND_FRAME }
        if (started) gap = true
        size = 0
        bytes = 0
        requireKeyFrame(now)
    }

    /** Waits for a key frame without counting a gap, as at the start of a stream or configuration. */
    fun requireKeyFrame(now: Long) {
        needsKeyFrame = true
        if (waitingSinceNanos == null) waitingSinceNanos = now
    }

    private fun expire(now: Long) {
        val oldest = records.firstOrNull { it.kind == WebVideoRecords.KIND_FRAME } ?: return
        val age = (now - oldest.queuedAtNanos).coerceAtLeast(0)
        maxQueueAgeNanos = maxOf(maxQueueAgeNanos, age)
        // Media age is not a no-progress timeout. Reliable queues drain in full until capacity
        // fails; the peer separately bounds consumption/credit stalls by its progress deadline.
        if (age >= maxAgeNanos && !reliable) {
            expired += size
            invalidate(now)
        }
    }
}
