package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.lang.management.ManagementFactory
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
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

    @Test fun mismatchedMalformedAndInterimRepliesDoNotReleaseTheOutstandingCommand() {
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
                channel.rawReply("", "200")
                channel.rawReply("+${first.headers.getValue("cseq")}", "200")
                channel.rawReply(first.headers.getValue("cseq"), "invalid")
                channel.acknowledge(first, 100)
                channel.unsequencedReply(100)
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

    @Test fun capturedSeventyFiveByteReplyAcknowledgesOnlyAnOutstandingCommandAndAllowsTheNextOne() {
        assertEquals(75, CAPTURED_ACK.size)
        for (encrypted in listOf(false, true)) {
            val token = Any()
            val logs = CopyOnWriteArrayList<String>()
            ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
                recovery.begin(token)
                recovery.frameReady(token)
                Channel(recovery, encrypted).use { channel ->
                    // An unsolicited response is not credit for a command that has not been sent.
                    channel.unsequencedReply()
                    channel.feedback(1)
                    channel.feedbackAcknowledgement(1)
                    assertFalse(logs.any { "state=acknowledged" in it })
                    recovery.request(token)
                    val first = channel.command()
                    channel.unsequencedReply()
                    channel.feedback(2)
                    channel.feedbackAcknowledgement(2)
                    assertTrue(logs.any {
                        "state=acknowledged cseq=${first.headers.getValue("cseq")}" in it && "responseCSeq=absent" in it
                    })
                    // A duplicate reply while idle must not acknowledge the next request early.
                    channel.unsequencedReply()
                    channel.feedback(3)
                    channel.feedbackAcknowledgement(3)
                    assertEquals(1, logs.count { "state=acknowledged" in it })
                    recovery.request(token)
                    val next = channel.command()
                    assertTrue(next.headers.getValue("cseq").toLong() > first.headers.getValue("cseq").toLong())
                    assertEquals(1, logs.count { "state=acknowledged" in it })
                    channel.unsequencedReply()
                    channel.feedback(4)
                    channel.feedbackAcknowledgement(4)
                    assertEquals(2, logs.count { "state=acknowledged" in it })
                    assertFalse(logs.any { "state=timeout" in it || "state=rejected" in it })
                }
            }
        }
    }

    @Test fun aReplyOnANonOwningEventConnectionCannotConfirmTheActiveCommand() {
        val token = Any()
        val logs = CopyOnWriteArrayList<String>()
        ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
            recovery.begin(token)
            recovery.frameReady(token)
            Channel(recovery).use { current ->
                current.feedback(1)
                current.feedbackAcknowledgement(1)
                recovery.request(token)
                val command = current.command()
                Channel(recovery).use { other ->
                    // A concurrent/retired event socket does not own this session's command.
                    // Its TCP write may race the receiver closing the rejected connection.
                    runCatching { other.unsequencedReply() }
                    other.awaitReaderRetired()
                }
                current.feedback(2)
                current.feedbackAcknowledgement(2)
                assertFalse(logs.any { "state=acknowledged" in it })
                current.unsequencedReply()
                current.feedback(3)
                current.feedbackAcknowledgement(3)
                assertTrue(logs.any { "state=acknowledged cseq=${command.headers.getValue("cseq")}" in it })
            }
        }
    }

    @Test fun unsequencedReplyBeforeWriteAdmissionCannotCancelTheCommandThatStillHasToBeSent() {
        val token = Any()
        val logs = CopyOnWriteArrayList<String>()
        ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
            recovery.begin(token)
            recovery.frameReady(token)
            Channel(recovery).use { channel ->
                channel.feedback(1)
                channel.feedbackAcknowledgement(1)
                val current = currentChannel(recovery)
                val writeLock = current.javaClass.getDeclaredField("writeLock").apply { isAccessible = true }.get(current)
                synchronized(writeLock) {
                    recovery.request(token)
                    val controllerLock = requireNotNull(recoveryField(recovery, "lock"))
                    await("command created before entering the channel writer") {
                        synchronized(controllerLock) { recoveryField(recovery, "outstanding") != null }
                    }
                    channel.unsequencedReply()
                    channel.feedback(2)
                    // The reader processes ACK then feedback in order. Waiting on this exact
                    // writer monitor proves it has finished the unsolicited ACK handler.
                    channel.awaitReaderBlockedOn(writeLock)
                    assertFalse("an unwritten command cannot have been acknowledged", logs.any { "state=acknowledged" in it })
                }
                // Both the command worker and feedback reader were waiting for the same lock.
                val messages = listOf(channel.read(), channel.read())
                val command = messages.single { it.method == "POST" }
                assertCommand(command)
                val feedback = messages.single { it.method == "RTSP/1.0" }
                assertEquals("2", feedback.headers["cseq"])
                channel.unsequencedReply()
                channel.feedback(3)
                channel.feedbackAcknowledgement(3)
                assertTrue(logs.any { "state=acknowledged cseq=${command.headers.getValue("cseq")}" in it })
            }
        }
    }

    @Test fun fastUnsequencedReplyIsAcceptedAfterWriteAdmissionBeforeFlushCompletes() {
        val token = Any()
        val logs = CopyOnWriteArrayList<String>()
        ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
            recovery.begin(token)
            recovery.frameReady(token)
            Channel(recovery).use { channel ->
                channel.feedback(1)
                channel.feedbackAcknowledgement(1)
                val current = currentChannel(recovery)
                val output = current.javaClass.getDeclaredField("output").apply { isAccessible = true }
                val writeLock = current.javaClass.getDeclaredField("writeLock").apply { isAccessible = true }.get(current)
                val gate = synchronized(writeLock) {
                    // Seeing feedback bytes does not prove its flush has returned. Install the
                    // gate after that write finishes so only the new command can enter it.
                    BlockedFirstFlush(output.get(current) as OutputStream).also { output.set(current, it) }
                }
                try {
                    recovery.request(token)
                    assertTrue(gate.entered.await(1, TimeUnit.SECONDS))
                    val command = channel.command()
                    channel.unsequencedReply()
                    await("a fast reply can acknowledge bytes already admitted to the socket") {
                        logs.any { "state=acknowledged cseq=${command.headers.getValue("cseq")}" in it }
                    }
                    assertEquals("the write has not finished flushing", 1L, gate.release.count)
                    assertFalse(logs.any { "state=sent" in it })
                    gate.release.countDown()
                    channel.feedback(2)
                    channel.feedbackAcknowledgement(2)
                    recovery.request(token)
                    channel.acknowledge(channel.command())
                } finally { gate.release.countDown() }
            }
        }
    }

    @Test fun rejectedOrUnacknowledgedCommandsStopRetriesButStillAnswerFeedback() {
        for (response in listOf("timeout", "rejected-with-cseq", "rejected-without-cseq")) {
            val reject = response != "timeout"
            val token = Any()
            val logs = CopyOnWriteArrayList<String>()
            ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1,
                acknowledgementTimeoutMillis = if (reject) 3000 else 100).use { recovery ->
                recovery.begin(token)
                recovery.frameReady(token)
                Channel(recovery).use { channel ->
                    recovery.request(token)
                    val command = channel.command()
                    when (response) {
                        "rejected-with-cseq" -> channel.acknowledge(command, 501)
                        "rejected-without-cseq" -> channel.unsequencedReply(501)
                    }
                    val outcome = if (reject) "state=rejected" else "state=timeout"
                    await(outcome) { logs.any { outcome in it } }
                    assertFalse("failure is not an acknowledgement", logs.any { "state=acknowledged" in it })
                    repeat(20) { recovery.request(token) }
                    channel.unsequencedReply()
                    channel.feedback(17)
                    channel.feedbackAcknowledgement(17)
                    channel.assertSilent()
                    assertFalse("a late reply cannot re-enable disabled requests", logs.any { "state=acknowledged" in it })
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
        val logs = CopyOnWriteArrayList<String>()
        ReceiverMirrorRecovery({ logs.add(it) }, requestIntervalMillis = 1).use { recovery ->
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
                channel.reply(firstSequence, 200)
                channel.feedback(1)
                channel.feedbackAcknowledgement(1)
                assertFalse("a retired command cannot acknowledge the replacement", logs.any { "state=acknowledged" in it })
                channel.unsequencedReply()
                channel.feedback(2)
                channel.feedbackAcknowledgement(2)
                assertTrue(logs.any { "state=acknowledged cseq=${next.headers.getValue("cseq")}" in it })
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
        fun unsequencedReply(status: Int = 200) = write(if (status == 200) CAPTURED_ACK else
            "RTSP/1.0 $status Result\r\nContent-Length: 0\r\n\r\n".toByteArray())
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
        fun awaitReaderRetired() {
            worker.join(1000)
            assertFalse("a non-owning event connection must be retired", worker.isAlive)
        }
        fun awaitReaderBlockedOn(monitor: Any) {
            await("event reader finished ACK handling and reached feedback writer") {
                ManagementFactory.getThreadMXBean().getThreadInfo(worker.id)?.let {
                    it.threadState == Thread.State.BLOCKED && it.lockInfo?.identityHashCode == System.identityHashCode(monitor)
                } == true
            }
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

    private class BlockedFirstFlush(private val output: OutputStream) : OutputStream() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        private val first = AtomicBoolean(true)
        override fun write(value: Int) = output.write(value)
        override fun write(bytes: ByteArray, offset: Int, length: Int) = output.write(bytes, offset, length)
        override fun flush() {
            output.flush()
            if (first.compareAndSet(true, false)) {
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS)) { "test flush gate was not released" }
            }
        }
    }

    companion object {
        private val CAPTURED_ACK = "RTSP/1.0 200 OK\r\nDate: Wed, 11 Nov 2026 00:47:39 GMT\r\nContent-Length: 0\r\n\r\n".toByteArray(Charsets.US_ASCII)
        private fun recoveryField(recovery: ReceiverMirrorRecovery, name: String): Any? =
            recovery.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(recovery)
        private fun currentChannel(recovery: ReceiverMirrorRecovery): Any =
            synchronized(requireNotNull(recoveryField(recovery, "lock"))) { requireNotNull(recoveryField(recovery, "channel")) }
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
