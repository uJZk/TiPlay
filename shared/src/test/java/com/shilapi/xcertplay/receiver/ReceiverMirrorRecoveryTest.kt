package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Exercises the reverse event wire, including encrypted request/response counter ordering. */
class ReceiverMirrorRecoveryTest {
    @Test fun earlyRequestsAreCoalescedUntilBothFirstFrameAndEventConnectionExist() {
        for (connectFirst in listOf(false, true)) {
            val token = Any()
            val logs = CopyOnWriteArrayList<String>()
            ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
                recovery.begin(token)
                repeat(20) { recovery.request(token) }
                if (!connectFirst) recovery.frameReady(token)
                Channel(recovery).use { channel ->
                    if (connectFirst) {
                        channel.assertSilent()
                        recovery.frameReady(token)
                    }
                    val request = channel.command()
                    channel.acknowledge(request)
                    await("matching command acknowledgement") { logs.any { "state=acknowledged" in it } }
                    channel.assertSilent()
                }
            }
        }
    }

    @Test fun mismatchedOrMalformedAcknowledgementDoesNotReleaseTheOutstandingCommand() {
        val token = Any()
        val logs = CopyOnWriteArrayList<String>()
        ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
            recovery.begin(token)
            recovery.frameReady(token)
            Channel(recovery).use { channel ->
                recovery.request(token)
                val first = channel.command()
                channel.reply(first.headers.getValue("cseq").toLong() + 1, 200)
                channel.rawReply("not-a-number", "200")
                channel.rawReply(first.headers.getValue("cseq"), "invalid")
                // A keepalive reply is a read barrier: the mismatched reply was processed first.
                channel.feedback(100)
                channel.feedbackAcknowledgement(100)
                assertFalse(logs.any { "state=acknowledged" in it })
                recovery.request(token)
                channel.assertSilent()
                channel.acknowledge(first)
                await("matching acknowledgement") { logs.any { "state=acknowledged" in it } }
                val second = channel.command()
                assertTrue(second.headers.getValue("cseq").toLong() > first.headers.getValue("cseq").toLong())
                channel.acknowledge(second)
            }
        }
    }

    @Test fun rejectedOrUnacknowledgedCommandsStopRetriesButStillAnswerFeedback() {
        for (reject in listOf(false, true)) {
            val token = Any()
            val logs = CopyOnWriteArrayList<String>()
            ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1,
                acknowledgementTimeoutMillis = if (reject) 3000 else 100).use { recovery ->
                recovery.begin(token)
                recovery.frameReady(token)
                Channel(recovery).use { channel ->
                    recovery.request(token)
                    val command = channel.command()
                    if (reject) channel.acknowledge(command, 501)
                    val outcome = if (reject) "state=rejected" else "state=timeout"
                    await(outcome) { logs.any { outcome in it } }
                    assertFalse("failure is not an acknowledgement", logs.any { "state=acknowledged" in it })
                    repeat(20) { recovery.request(token) }
                    channel.feedback(17)
                    channel.feedbackAcknowledgement(17)
                    channel.assertSilent()
                }
            }
        }
    }

    @Test fun retiringMirrorClearsPendingRequestsAndOldCallbacksCannotTargetItsReplacement() {
        val old = Any()
        val next = Any()
        ReceiverMirrorRecovery({}, requestIntervalMillis = 1).use { recovery ->
            recovery.begin(old)
            recovery.request(old)
            recovery.frameReady(old)
            recovery.end(old)
            recovery.begin(next)
            Channel(recovery).use { channel ->
                recovery.request(old)
                recovery.frameReady(old)
                recovery.end(old)
                recovery.frameReady(next)
                channel.assertSilent()
                recovery.request(next)
                channel.acknowledge(channel.command())
                recovery.end(next)
                recovery.request(next)
                channel.feedback(23)
                channel.feedbackAcknowledgement(23)
                channel.assertSilent()
            }
        }
    }

    @Test fun legacyReconnectUsesTheCurrentDemandAndDoesNotRestartCseq() {
        val token = Any()
        ReceiverMirrorRecovery({}, requestIntervalMillis = 1).use { recovery ->
            recovery.begin(token)
            recovery.frameReady(token)
            val firstSequence = Channel(recovery).use { channel ->
                recovery.request(token)
                channel.command().headers.getValue("cseq").toLong()
            }
            recovery.request(token)
            Channel(recovery).use { channel ->
                val next = channel.command()
                assertTrue(next.headers.getValue("cseq").toLong() > firstSequence)
                channel.acknowledge(next)
            }
        }
    }

    @Test fun encryptedCommandsAndFeedbackResponsesShareOneOrderedNonceSequence() {
        val token = Any()
        val logs = CopyOnWriteArrayList<String>()
        ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
            recovery.begin(token)
            recovery.frameReady(token)
            Channel(recovery, encrypted = true).use { channel ->
                repeat(12) { index ->
                    val feedbackSequence = 100 + index
                    channel.feedback(feedbackSequence)
                    recovery.request(token)
                    val messages = listOf(channel.read(), channel.read())
                    val command = messages.single { it.method == "POST" }
                    assertCommand(command)
                    val response = messages.single { it.method == "RTSP/1.0" }
                    assertEquals("200", response.path)
                    assertEquals(feedbackSequence.toString(), response.headers["cseq"])
                    channel.acknowledge(command)
                    await("encrypted acknowledgement $index") {
                        logs.count { "state=acknowledged" in it } == index + 1
                    }
                }
            }
        }
    }

    @Test fun idleEventConnectionOutlivesItsInheritedReadTimeoutInPlainAndEncryptedSessions() {
        for (encrypted in listOf(false, true)) {
            val token = Any()
            ReceiverMirrorRecovery({}, requestIntervalMillis = 1).use { recovery ->
                recovery.begin(token)
                recovery.frameReady(token)
                Channel(recovery, encrypted, acceptedReadTimeoutMillis = 50).use { channel ->
                    // A real feedback round trip proves serve() has installed its read policy.
                    channel.feedback(1)
                    channel.feedbackAcknowledgement(1)
                    // Waiting for quiet wire bytes crosses the inherited 50 ms deadline without
                    // invoking the authenticated decoder (a cipher read timeout is terminal).
                    channel.assertSilent()
                    recovery.request(token)
                    channel.acknowledge(channel.command())
                    channel.feedback(2)
                    channel.feedbackAcknowledgement(2)
                }
            }
        }
    }

    private class Channel(recovery: ReceiverMirrorRecovery, encrypted: Boolean = false,
                          acceptedReadTimeoutMillis: Int = 0) : Closeable {
        private val listener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        private val peer = Socket(InetAddress.getByName("127.0.0.1"), listener.localPort).apply { soTimeout = 3000 }
        private val accepted = listener.accept().apply { soTimeout = acceptedReadTimeoutMillis }
        private val readKey = ByteArray(32) { (it + 10).toByte() }
        private val writeKey = ByteArray(32) { (it + 80).toByte() }
        private val serverCipher = if (encrypted) ReceiverAirPlay2Cipher(readKey, writeKey) else null
        private val peerCipher = if (encrypted) ReceiverAirPlay2Cipher(writeKey, readKey) else null
        private val input: InputStream = peerCipher?.input(peer.getInputStream()) ?: peer.getInputStream()
        private val worker = thread(name = "mirror-recovery-test", isDaemon = true) {
            recovery.serve(accepted, serverCipher)
        }

        fun read(): RtspMessage.Request = requireNotNull(readReceiverRequest(input))
        fun command(): RtspMessage.Request = read().also(::assertCommand)
        fun acknowledge(request: RtspMessage.Request, status: Int = 200) = reply(request.headers.getValue("cseq").toLong(), status)
        fun reply(sequence: Long, status: Int) = rawReply(sequence.toString(), status.toString())
        fun rawReply(sequence: String, status: String) = write("RTSP/1.0 $status Result\r\nCSeq: $sequence\r\nContent-Length: 0\r\n\r\n".toByteArray())
        fun feedback(sequence: Int) = write("POST /feedback RTSP/1.0\r\nCSeq: $sequence\r\nContent-Length: 0\r\n\r\n".toByteArray())
        fun feedbackAcknowledgement(sequence: Int) {
            val response = read()
            assertEquals("RTSP/1.0", response.method)
            assertEquals("200", response.path)
            assertEquals(sequence.toString(), response.headers["cseq"])
        }
        fun assertSilent() {
            peer.soTimeout = 100
            try { assertThrows(SocketTimeoutException::class.java) { peer.getInputStream().read() } }
            finally { peer.soTimeout = 3000 }
        }
        private fun write(bytes: ByteArray) {
            peer.getOutputStream().apply { write(peerCipher?.encrypt(bytes) ?: bytes); flush() }
        }
        override fun close() {
            peer.close()
            accepted.close()
            listener.close()
            worker.join(1000)
            assertFalse("event reader must retire with its socket", worker.isAlive)
            peerCipher?.close()
        }
    }

    companion object {
        private fun assertCommand(request: RtspMessage.Request) {
            assertEquals("POST", request.method)
            assertEquals("/command", request.path)
            assertEquals("RTSP/1.0", request.protocol)
            assertEquals("application/x-apple-binary-plist", request.headers["content-type"])
            assertEquals(request.body.size.toString(), request.headers["content-length"])
            assertEquals(mapOf("type" to "forceKeyFrame"), BplistCodec.decode(request.body))
            assertTrue(request.headers.getValue("cseq").toLong() > 0)
        }

        private fun await(description: String, condition: () -> Boolean) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            while (!condition() && System.nanoTime() < deadline) Thread.sleep(1)
            assertTrue(description, condition())
        }
    }
}
