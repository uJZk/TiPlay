package com.shilapi.xcertplay.airplay

import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.TimeUnit

/** Process-local diagnostic only. No persisted setting and no network control endpoint. */
object CarPlayTcpProbe {
    val controller = TcpReceiveProbe()
}

/**
 * A bounded receive-window experiment for one main-screen connection. Waiting happens before
 * reading a complete screen message, never inside a media sink or its shared delivery lock.
 * Throughput is receiver evidence; it is not a measurement of the iPhone encoder's production rate.
 */
class TcpReceiveProbe(private val nanoTime: () -> Long = System::nanoTime) {
    private val lock = Object()
    private var owner: Any? = null
    private var report: (String) -> Unit = {}
    @Volatile private var running = false
    private var started = 0L
    private var phase = -1
    private var nextRead = 0L
    private var baselineBytes = 0L
    private var budget = 0.0
    private var bytes = 0L
    private var frames = 0L
    private var reads = 0L
    private var gateNanos = 0L
    private var senderNanos: Long? = null
    private var ageMs: Double? = null
    private var lastArrivalNanos: Long? = null
    private var maxAgeMs: Double? = null
    private var sampleAt = 0L
    private var sampleBytes = 0L
    private var sampleFrames = 0L
    private var measuredMbps = 0.0
    private var measuredFps = 0.0
    private var state = "OFF / 默认关闭"
    private val history = ArrayDeque<String>()

    fun attach(connection: Any, diagnostic: (String) -> Unit = {}) = synchronized(lock) {
        if (owner !== connection && running) finish("STOPPED: video connection replaced")
        owner = connection
        report = diagnostic
    }

    fun detach(connection: Any) = synchronized(lock) {
        if (owner !== connection) return@synchronized
        if (running) finish("STOPPED: video connection ended")
        owner = null
        report = {}
        lock.notifyAll()
    }

    /** 15 s baseline, 15 s at 70%, 15 s at 40%, 15 s unrestricted recovery. */
    fun start(): Boolean = synchronized(lock) {
        if (owner == null || running) return@synchronized false
        running = true
        started = nanoTime()
        sampleAt = started
        phase = 0
        nextRead = started
        baselineBytes = 0
        budget = 0.0
        bytes = 0
        frames = 0
        reads = 0
        gateNanos = 0
        senderNanos = null
        ageMs = null
        lastArrivalNanos = null
        maxAgeMs = null
        sampleBytes = 0
        sampleFrames = 0
        measuredMbps = 0.0
        measuredFps = 0.0
        history.clear()
        state = PHASES[0]
        emit("START: 60 s, baseline → 70% → 40% → unrestricted recovery; receive throughput is not encoder bitrate")
        lock.notifyAll()
        true
    }

    fun stop() = synchronized(lock) {
        if (running) finish("STOPPED: user; unrestricted reads restored")
    }

    fun isRunning(connection: Any): Boolean = running && synchronized(lock) { owner === connection }

    /** Returns false only when this connection was detached; stop immediately releases the gate. */
    fun beforeRead(connection: Any): Boolean {
        if (!running) return true
        synchronized(lock) {
            while (running && owner === connection) {
                val now = nanoTime()
                advance(now)
                if (!running || phase !in 1..2) break
                val phaseEnd = started + (phase + 1) * PHASE_NANOS
                val remaining = minOf(nextRead, phaseEnd) - now
                if (remaining <= 0L) break
                val began = nanoTime()
                TimeUnit.NANOSECONDS.timedWait(lock, remaining)
                gateNanos += (nanoTime() - began).coerceAtLeast(0L)
            }
            return owner === connection
        }
    }

    fun read(connection: Any) {
        if (!running) return
        synchronized(lock) { if (owner === connection) reads++ }
    }

    fun message(connection: Any, wireBytes: Int, frameSenderNanos: Long?, arrivalNanos: Long, sourceTimeNanos: Long?) {
        if (!running) return
        synchronized(lock) {
            if (owner !== connection) return
            advance(arrivalNanos)
            if (!running) return
            bytes += wireBytes
            if (phase == 0) baselineBytes += wireBytes
            if (frameSenderNanos != null) {
                frames++
                lastArrivalNanos = arrivalNanos
                senderNanos = frameSenderNanos
                // Null means synchronization is unavailable; never substitute arrival as source time.
                ageMs = sourceTimeNanos?.let { (arrivalNanos - it) / 1_000_000.0 }
                ageMs?.let { maxAgeMs = maxOf(maxAgeMs ?: it, it) }
            }
            if (phase in 1..2 && budget > 0.0) {
                nextRead = maxOf(arrivalNanos, nextRead) + (wireBytes / budget * 1e9).toLong()
            }
            updateMetrics(arrivalNanos)
        }
    }

    fun snapshot(): String = synchronized(lock) {
        val now = nanoTime()
        if (running) {
            advance(now)
            updateMetrics(now)
        }
        val left = if (running) ((started + TOTAL_NANOS - now).coerceAtLeast(0) + 999_999_999L) / 1_000_000_000L else 0L
        """TiPlay TCP receive probe / TCP 接收背压实验
state=$state
videoConnected=${owner != null} running=$running remainingSeconds=$left
budgetBytesPerSecond=${if (running && phase in 1..2) budget.toLong() else "unrestricted"}
receiveMbps=${fmt(measuredMbps)} receiveFps=${fmt(measuredFps)}
readCalls=$reads completeWireBytes=$bytes frames=$frames gateWaitMs=${gateNanos / 1_000_000}
lastSourceNanos=${senderNanos ?: "unavailable"}
lastReceivedSourceAgeMs=${fmt(ageMs)} maxSourceAgeMs=${fmt(maxAgeMs)}
lastFrameReceivedAgoMs=${lastArrivalNanos?.let { (now - it).coerceAtLeast(0) / 1_000_000 } ?: "unavailable"}

Age = arrival minus source scheduled presentation time, not capture latency.
Negative age means early arrival. Valid NTP required; unavailable ≠ zero delay.
readCalls counts socket read attempts, not TCP packets.
画面年龄是相对源计划呈现时间的到达偏差；负数表示提前，非采集延迟。
吞吐下降不等于源编码降码率。关注画面年龄是否增长，以及恢复后是否追播旧帧。

${history.joinToString("\n")}"""
    }

    private fun advance(now: Long) {
        if (!running) return
        val next = ((now - started).coerceAtLeast(0) / PHASE_NANOS).toInt()
        if (next >= PHASES.size) {
            updateMetrics(now)
            finish("COMPLETE: unrestricted reads restored")
            return
        }
        if (next == phase) return
        if (phase == 0) {
            budget = baselineBytes / (PHASE_NANOS / 1e9)
            if (budget <= 0.0) {
                finish("STOPPED: baseline had no complete video data")
                return
            }
        }
        phase = next
        budget = when (next) {
            1 -> baselineBytes / (PHASE_NANOS / 1e9) * 0.7
            2 -> baselineBytes / (PHASE_NANOS / 1e9) * 0.4
            else -> 0.0
        }
        nextRead = now
        state = PHASES[next]
        emit("PHASE ${next * 15}s: $state budgetBps=${budget.toLong()}")
    }

    private fun updateMetrics(now: Long) {
        val span = now - sampleAt
        if (span < 1_000_000_000L) return
        measuredMbps = (bytes - sampleBytes) * 8_000.0 / span
        measuredFps = (frames - sampleFrames) * 1e9 / span
        sampleAt = now
        sampleBytes = bytes
        sampleFrames = frames
        emit("t=${(now - started) / 1_000_000_000}s phase=$state Mbps=${fmt(measuredMbps)} fps=${fmt(measuredFps)} ageMs=${fmt(ageMs)} maxAgeMs=${fmt(maxAgeMs)} waitMs=${gateNanos / 1_000_000} reads=$reads bytes=$bytes frames=$frames sourceNs=${senderNanos ?: "unavailable"}")
    }

    private fun finish(reason: String) {
        state = reason
        running = false
        nextRead = 0
        emit(reason)
        lock.notifyAll()
    }

    private fun emit(line: String) {
        while (history.size >= 90) history.removeFirst()
        history.addLast(line)
        runCatching { report("TCP probe: $line") }
    }

    private fun fmt(value: Double?): String = value?.let { String.format(Locale.ROOT, "%.2f", it) } ?: "unavailable"

    private companion object {
        const val PHASE_NANOS = 15_000_000_000L
        const val TOTAL_NANOS = PHASE_NANOS * 4
        val PHASES = listOf("BASELINE / 基线", "70% / 读取限速", "40% / 读取限速", "RECOVERY / 无限制恢复")
    }
}
