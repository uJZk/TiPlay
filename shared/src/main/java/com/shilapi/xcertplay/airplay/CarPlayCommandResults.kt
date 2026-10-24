package com.shilapi.xcertplay.airplay

/** Low-frequency screen commands only. HID/media traffic must not grow a response journal. */
internal class CarPlayCommandResults(
    private val nowNanos: () -> Long = System::nanoTime,
    private val timeoutNanos: Long = 5_000_000_000L,
    private val capacity: Int = 16,
) {
    enum class Boundary { REQUEST, WRITTEN, RESPONSE, TIMEOUT, CAPACITY, CANCELLED, WRITE_FAILED }
    enum class Result { ACCEPTED, REJECTED, UNKNOWN }
    data class Event(
        val generation: Long,
        val cseq: Int,
        val borrowed: Boolean,
        val boundary: Boundary,
        val elapsedNanos: Long,
        val rtspStatus: Int? = null,
        val commandStatus: Long? = null,
    ) {
        val result: Result get() = when {
            boundary != Boundary.RESPONSE -> Result.UNKNOWN
            rtspStatus == null -> Result.UNKNOWN
            rtspStatus !in 200..299 || commandStatus != null && commandStatus != 0L -> Result.REJECTED
            commandStatus == 0L -> Result.ACCEPTED
            else -> Result.UNKNOWN
        }
    }
    private data class Pending(val generation: Long, val cseq: Int, val borrowed: Boolean, val start: Long)
    private val pending = linkedMapOf<Int, Pending>()
    private var generation = 0L
    private var active = false
    private var retired = false

    init { require(timeoutNanos > 0 && capacity > 0) }

    /** A replacement event socket cannot inherit responses from its predecessor. */
    @Synchronized fun open(): Pair<Long, List<Event>> {
        val cancelled = pending.values.map { it.event(Boundary.CANCELLED) }
        pending.clear()
        generation++
        active = !retired
        return generation to cancelled
    }

    /** Register before writing: the peer can reply before OutputStream.flush returns. */
    @Synchronized fun request(channel: Long, cseq: Int, borrowed: Boolean): List<Event> {
        if (!active || channel != generation) return emptyList()
        val events = expireLocked().toMutableList()
        if (pending.size >= capacity) {
            val oldest = pending.entries.first()
            events += oldest.value.event(Boundary.CAPACITY)
            pending.remove(oldest.key)
        }
        val request = Pending(channel, cseq, borrowed, nowNanos())
        pending[cseq] = request
        events += request.event(Boundary.REQUEST)
        return events
    }

    @Synchronized fun written(channel: Long, cseq: Int): List<Event> =
        pending[cseq]?.takeIf { it.generation == channel && channel == generation }
            ?.let { listOf(it.event(Boundary.WRITTEN)) }.orEmpty()

    @Synchronized fun failed(channel: Long, cseq: Int): List<Event> {
        val request = pending[cseq]?.takeIf { it.generation == channel && channel == generation }
            ?: return emptyList()
        pending.remove(cseq)
        return listOf(request.event(Boundary.WRITE_FAILED))
    }

    @Synchronized fun response(channel: Long, message: RtspMessage.Request): List<Event> {
        if (!active || channel != generation) return emptyList()
        val events = expireLocked().toMutableList()
        val cseq = message.headers["cseq"]?.toIntOrNull() ?: return events
        val request = pending[cseq] ?: return events
        val status = message.path.toIntOrNull()?.takeIf { it in 100..599 } ?: return events
        if (message.method != "RTSP/1.0" && message.method != "HTTP/1.1" && message.method != "HTTP/1.0") return events
        // Informational responses do not complete the outstanding request.
        if (status < 200) return events
        pending.remove(cseq)
        val commandStatus = if (message.body.isEmpty()) null else runCatching {
            val value = (BplistCodec.decode(message.body) as? Map<*, *>)?.get("status") as? Number
                ?: return@runCatching null
            value.toLong().takeIf { value.toDouble() == it.toDouble() }
        }.getOrNull()
        events += request.event(Boundary.RESPONSE).copy(rtspStatus = status, commandStatus = commandStatus)
        return events
    }

    @Synchronized fun expire(channel: Long): List<Event> =
        if (active && channel == generation) expireLocked() else emptyList()

    @Synchronized fun close(channel: Long): List<Event> {
        if (!active || channel != generation) return emptyList()
        active = false
        return pending.values.map { it.event(Boundary.CANCELLED) }.also { pending.clear() }
    }

    /** Session close cannot wait for an event writer blocked in native socket I/O. */
    @Synchronized fun retire(): List<Event> {
        retired = true
        active = false
        return pending.values.map { it.event(Boundary.CANCELLED) }.also { pending.clear() }
    }

    private fun expireLocked(): List<Event> {
        val expired = pending.values.filter { nowNanos() - it.start >= timeoutNanos }
        expired.forEach { pending.remove(it.cseq) }
        return expired.map { it.event(Boundary.TIMEOUT) }
    }

    private fun Pending.event(boundary: Boundary) = Event(generation, cseq, borrowed, boundary,
        (nowNanos() - start).coerceAtLeast(0))
}
