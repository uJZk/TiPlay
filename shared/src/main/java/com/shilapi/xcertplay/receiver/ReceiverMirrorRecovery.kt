package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.BufferedInputStream
import java.io.Closeable
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One control session's reverse mirror commands, independent of its media/control writers.
 *
 * A sender may emit no further IDR until asked. Keep one recovery demand until both its first
 * validated video AU and its event connection exist; never ask before that AU (some macOS senders
 * answer an early command with an empty codec packet). Tokens retire demands with their mirror.
 * Protocol comparison: regulad/UxPlay aef802e2, lib/raop_events.c (POST /command forceKeyFrame).
 */
internal class ReceiverMirrorRecovery(
    private val log: (String) -> Unit,
    private val requestIntervalMillis: Long = 500,
    private val acknowledgementTimeoutMillis: Long = 2_000,
) : Closeable {
    private val lock = Any()
    private val writer = ScheduledThreadPoolExecutor(1) { runnable ->
        Thread(runnable, "tiplay-mirror-keyframe").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
    private var closed = false
    private var token: Any? = null
    private var firstFrame = false
    private var pending = false
    private var channel: Channel? = null
    private var dispatch: ScheduledFuture<*>? = null
    private var outstanding: Command? = null
    private var lastRequestNanos: Long? = null
    private var cseq = 0L

    init {
        require(requestIntervalMillis > 0 && acknowledgementTimeoutMillis > 0)
    }

    fun begin(token: Any) = synchronized(lock) {
        if (closed) return@synchronized
        retireLocked()
        this.token = token
    }

    fun end(token: Any) = synchronized(lock) {
        if (this.token === token) retireLocked()
    }

    fun request(token: Any) = synchronized(lock) {
        if (closed || this.token !== token) return@synchronized
        pending = true
        scheduleLocked()
    }

    fun frameReady(token: Any) = synchronized(lock) {
        if (closed || this.token !== token || firstFrame) return@synchronized
        firstFrame = true
        scheduleLocked()
    }

    /** Runs on the event reader, never on the ownership/video/browser recovery threads. */
    fun serve(socket: Socket, cipher: ReceiverAirPlay2Cipher? = null): String {
        val candidate = Channel(socket, cipher)
        val accepted = synchronized(lock) {
            if (closed || channel != null) false else {
                channel = candidate
                scheduleLocked()
                true
            }
        }
        if (!accepted) { candidate.close(); return "control-closed" }
        var reason = "eof"
        try {
            val raw = BufferedInputStream(RawTraffic.input(
                "iphone/ReceiverMirrorEvent/${socket.remoteSocketAddress}/${socket.localPort}/in", socket.getInputStream()))
            val input = cipher?.input(raw) ?: raw
            while (!socket.isClosed) {
                val message = readReceiverRequest(input, maximumBodyBytes = 4 * 1024) ?: break
                if (message.method.startsWith("RTSP/") || message.method.startsWith("HTTP/")) {
                    acknowledge(candidate, message)
                } else {
                    // Sender feedback remains independent of video recovery, including after a rejection.
                    candidate.write(RtspMessage.buildResponse(message, RtspMessage.Response()))
                }
            }
        } catch (error: Exception) {
            reason = when {
                socket.isClosed -> "control-closed"
                error is SocketTimeoutException -> "timeout"
                else -> "error"
            }
            if (!socket.isClosed) report("state=failure reason=event-read")
        } finally {
            synchronized(lock) {
                if (channel === candidate) {
                    channel = null
                    outstanding?.takeIf { it.channel === candidate }?.let {
                        it.deadline?.cancel(false)
                        outstanding = null
                        if (token === it.token) pending = true
                    }
                }
            }
            candidate.close()
        }
        return reason
    }

    private fun scheduleLocked() {
        val current = channel ?: return
        if (closed || token == null || !firstFrame || !pending || !current.commandsAllowed ||
            outstanding != null || dispatch != null) return
        val elapsed = lastRequestNanos?.let { System.nanoTime() - it }
        val interval = TimeUnit.MILLISECONDS.toNanos(requestIntervalMillis)
        val delay = if (elapsed == null) 0L else (interval - elapsed).coerceAtLeast(0)
        dispatch = writer.schedule(::send, delay, TimeUnit.NANOSECONDS)
    }

    private fun send() {
        val command = synchronized(lock) {
            dispatch = null
            val current = channel
            val owner = token
            if (closed || current == null || owner == null || !firstFrame || !pending ||
                !current.commandsAllowed || outstanding != null) return
            if (cseq == Long.MAX_VALUE) { current.commandsAllowed = false; return }
            pending = false
            lastRequestNanos = System.nanoTime()
            Command(owner, current, ++cseq).also { outstanding = it }
        }
        try {
            val body = BplistCodec.encode(mapOf("type" to "forceKeyFrame"))
            val header = "POST /command RTSP/1.0\r\nCSeq: ${command.cseq}\r\n" +
                "Content-Type: application/x-apple-binary-plist\r\nContent-Length: ${body.size}\r\n\r\n"
            // An already admitted write may finish while its mirror is closing. A queued old demand
            // must not acquire the writer or be redirected to a replacement event connection.
            val written = command.channel.write(header.toByteArray(Charsets.US_ASCII) + body) {
                synchronized(lock) { !closed && outstanding === command && token === command.token && channel === command.channel }
            }
            if (!written) {
                synchronized(lock) {
                    if (outstanding === command) {
                        outstanding = null
                        if (token === command.token) pending = true
                    }
                }
                return
            }
            report("state=sent cseq=${command.cseq}")
            synchronized(lock) {
                if (outstanding === command) {
                    command.deadline = deadlines.schedule({ timeout(command) }, acknowledgementTimeoutMillis, TimeUnit.MILLISECONDS)
                }
            }
        } catch (_: Exception) {
            synchronized(lock) {
                if (outstanding === command) {
                    outstanding = null
                    if (token === command.token) pending = true
                }
            }
            report("state=failure reason=event-write cseq=${command.cseq}")
            command.channel.close()
        }
    }

    private fun acknowledge(candidate: Channel, message: RtspMessage.Request) {
        val sequence = message.headers["cseq"]?.toLongOrNull() ?: return
        val status = message.path.toIntOrNull()?.takeIf { it in 200..599 } ?: return
        val matched = synchronized(lock) {
            val command = outstanding?.takeIf { it.channel === candidate && it.cseq == sequence } ?: return@synchronized false
            command.deadline?.cancel(false)
            outstanding = null
            if (status !in 200..299) {
                candidate.commandsAllowed = false
                pending = false
            }
            scheduleLocked()
            true
        }
        if (matched) report("state=${if (status in 200..299) "acknowledged" else "rejected"} cseq=$sequence status=$status")
    }

    private fun timeout(command: Command) {
        val expired = synchronized(lock) {
            if (outstanding !== command) false else {
                outstanding = null
                pending = false
                command.channel.commandsAllowed = false
                true
            }
        }
        if (expired) report("state=timeout cseq=${command.cseq}")
    }

    private fun retireLocked() {
        token = null
        firstFrame = false
        pending = false
        dispatch?.cancel(false)
        dispatch = null
        outstanding?.deadline?.cancel(false)
        outstanding = null
    }

    override fun close() {
        val previous = synchronized(lock) {
            if (closed) return
            closed = true
            retireLocked()
            channel.also { channel = null }
        }
        previous?.close()
        writer.shutdownNow()
    }

    private fun report(message: String) { runCatching { log("stage=MIRROR_KEYFRAME $message") } }

    private class Command(val token: Any, val channel: Channel, val cseq: Long) {
        var deadline: ScheduledFuture<*>? = null
    }

    private class Channel(private val socket: Socket, private val cipher: ReceiverAirPlay2Cipher?) : Closeable {
        private val writeLock = Any()
        private val closed = AtomicBoolean(false)
        private val output = RawTraffic.output(
            "iphone/ReceiverMirrorEvent/${socket.remoteSocketAddress}/${socket.localPort}/out", socket.getOutputStream())
        var commandsAllowed = true // guarded by the recovery controller's lock

        fun write(bytes: ByteArray, admitted: () -> Boolean = { true }): Boolean {
            // Socket.soTimeout bounds reads only. A stuck writer must release this exact channel
            // without holding an ownership lock or consuming the next mirror's event connection.
            val timeout = deadlines.schedule({ close() }, WRITE_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            try {
                return synchronized(writeLock) {
                    if (closed.get() || !admitted()) return@synchronized false
                    output.write(cipher?.encrypt(bytes) ?: bytes)
                    output.flush()
                    true
                }
            } finally {
                timeout.cancel(false)
            }
        }

        override fun close() {
            if (!closed.compareAndSet(false, true)) return
            runCatching { socket.close() }
            cipher?.close()
        }
    }

    private companion object {
        const val WRITE_TIMEOUT_MILLIS = 2_000L
        val deadlines = ScheduledThreadPoolExecutor(1) { runnable ->
            Thread(runnable, "tiplay-mirror-event-deadlines").apply { isDaemon = true }
        }.apply { removeOnCancelPolicy = true }
    }
}
