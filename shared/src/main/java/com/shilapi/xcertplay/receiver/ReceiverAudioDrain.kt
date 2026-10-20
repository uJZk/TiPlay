package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Legacy UDP transport; optional mirror soundtrack consumer, otherwise packets are discarded. */
class ReceiverAudioDrain(private val peer: InetAddress, private val log: (String) -> Unit = {},
                         private val packetReceived: ((ByteArray) -> Unit)? = null,
                         private val controlReceived: ((ByteArray) -> Unit)? = null,
                         private val idle: (() -> Unit)? = null,
                         private val failed: ((String, Exception) -> Unit)? = null) : Closeable {
    private class Counts {
        val packets = AtomicLong()
        val bytes = AtomicLong()
        val rejected = AtomicLong()
        val failures = AtomicLong()
    }

    private val closed = AtomicBoolean(false)
    private val dataCounts = Counts()
    private val controlCounts = Counts()
    private var data: DatagramSocket? = null
    private var control: DatagramSocket? = null

    /** Send bounded RTP retransmission requests only to the authenticated SETUP peer. */
    @Synchronized fun sendControl(packet: ByteArray, port: Int) {
        if (closed.get() || port !in 1..65535 || packet.size !in 1..64) return
        runCatching { control?.send(DatagramPacket(packet, packet.size, peer, port)) }
            .onFailure { emit("audioDrain stage=RESEND_FAILED exception=${it.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(it)}") }
    }

    /** Real dual-stack UDP ports, in data/control order. */
    @Synchronized
    fun start(): Pair<Int, Int> {
        check(!closed.get() && data == null) { "Audio drain is closed or already started" }
        try {
            data = bind()
            control = bind()
            val dataSocket = requireNotNull(data)
            if (idle != null) dataSocket.soTimeout = 10
            val controlSocket = requireNotNull(control)
            worker("DATA", dataSocket, dataCounts)
            worker("CONTROL", controlSocket, controlCounts)
            emit("audioDrain stage=LISTENING")
            return dataSocket.localPort to controlSocket.localPort
        } catch (error: Exception) {
            close()
            throw error
        }
    }

    private fun bind(): DatagramSocket {
        val socket = DatagramSocket(null)
        try {
            socket.bind(InetSocketAddress(InetAddress.getByName("::"), 0))
            return socket
        } catch (error: Exception) {
            socket.close()
            throw error
        }
    }

    private fun worker(channel: String, socket: DatagramSocket, counts: Counts): Thread =
        Thread({ drain(channel, socket, counts) }, "tiplay-airplay-audio-${channel.lowercase()}").apply {
            isDaemon = true
            start()
        }

    private fun drain(channel: String, socket: DatagramSocket, counts: Counts) {
        val buffer = ByteArray(65_536)
        val packet = DatagramPacket(buffer, buffer.size)
        while (!closed.get()) {
            try {
                packet.length = buffer.size
                try {
                    RawTraffic.receive(socket, packet)
                } catch (error: SocketTimeoutException) {
                    // Callback failures must pass through the same retirement path as receive failures.
                    // An exception from a catch block would otherwise silently kill only the data worker.
                    if (!closed.get() && channel == "DATA") idle?.invoke()
                    continue
                }
                if (closed.get()) return
                if (packet.address != peer) {
                    val rejected = counts.rejected.incrementAndGet()
                    if (sample(rejected)) emit("audioDrain stage=REJECTED channel=$channel rejected=$rejected")
                    continue
                }
                val bytes = counts.bytes.addAndGet(packet.length.toLong())
                if (channel == "DATA") packetReceived?.invoke(buffer.copyOf(packet.length))
                else controlReceived?.invoke(buffer.copyOf(packet.length))
                val packets = counts.packets.incrementAndGet()
                if (sample(packets)) emit("audioDrain stage=DRAINED channel=$channel packets=$packets bytes=$bytes")
            } catch (error: Exception) {
                if (closed.compareAndSet(false, true)) {
                    counts.failures.incrementAndGet()
                    emit("audioDrain stage=FAILED channel=$channel exception=${error.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(error)}")
                    releaseSockets()
                    runCatching { failed?.invoke(channel, error) }
                }
                return
            }
        }
    }

    @Synchronized
    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        releaseSockets()
    }

    @Synchronized private fun releaseSockets() {
        data?.close()
        control?.close()
        // Closing the sockets unblocks receive; do not wait on workers from service shutdown.
        emit("audioDrain stage=END dataPackets=${dataCounts.packets.get()} dataBytes=${dataCounts.bytes.get()} " +
            "dataRejected=${dataCounts.rejected.get()} dataFailures=${dataCounts.failures.get()} " +
            "controlPackets=${controlCounts.packets.get()} controlBytes=${controlCounts.bytes.get()} " +
            "controlRejected=${controlCounts.rejected.get()} controlFailures=${controlCounts.failures.get()}")
    }

    private fun sample(count: Long) = count <= 3 || count % 120L == 0L
    private fun emit(message: String) { runCatching { log(message) } }
}
