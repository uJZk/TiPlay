package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Fault-injected retired readers; production permits only one cipher per control/verification epoch. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class CarPlayEventChannelTest {
    @Test fun retiredReaderEofCannotCloseOrClearItsWritableSuccessor() = retiredReader(false)
    @Test fun retiredReaderFailureCannotCloseOrClearItsWritableSuccessor() = retiredReader(true)

    private fun retiredReader(fail: Boolean) {
        var sessionCloses = 0
        val session = session(media = object : AirPlayMediaHandler {
            override fun onSessionClosed(session: AirPlaySession) { sessionCloses++ }
        })
        val old = TestSocket(if (fail) object : InputStream() {
            override fun read(): Int = throw IOException("retired channel")
        } else ByteArrayInputStream(ByteArray(0)))
        val current = TestSocket()
        try {
            val oldGeneration = install(session, old)
            val currentGeneration = install(session, current)
            runReader(session, old, oldGeneration)
            assertTrue(old.isClosed)
            assertFalse(session.isClosed)
            assertFalse(current.isClosed)
            assertEquals(0, sessionCloses)
            assertSame(current, field(session, "eventSocket"))
            assertEquals(currentGeneration, field(session, "eventGeneration"))
            assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
            assertTrue(current.output.size() > 0)
        } finally { session.close(); old.close(); current.close() }
    }

    @Test fun socketPollTimeoutPreservesPartialEncryptedResponseAndDoesNotGrantScreen() {
        val directory = java.nio.file.Files.createTempDirectory("command-response").toFile()
        val capture = java.io.File(directory, "capture.tsv")
        RawTraffic.configure(capture, true)
        val session = session()
        val peer = cipher()
        val responseBody = BplistCodec.encode(mapOf("status" to 0))
        val response = peer.encrypt(("RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: ${responseBody.size}\r\n\r\n")
            .toByteArray(Charsets.US_ASCII) + responseBody)
        var reads = 0
        val input = object : InputStream() {
            override fun read(): Int = error("bulk reads only")
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int = when (reads++) {
                0 -> response.copyOfRange(0, 3).also { it.copyInto(bytes, offset) }.size
                1 -> {
                    assertFalse(session.isClosed)
                    throw SocketTimeoutException("idle event channel")
                }
                2 -> response.copyOfRange(3, response.size).also { it.copyInto(bytes, offset) }.size
                else -> {
                    assertTrue(session.screenBorrowState.pending)
                    assertFalse(session.screenBorrowState.confirmedBorrow)
                    assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
                    -1
                }
            }
        }
        val socket = TestSocket(input)
        try {
            val generation = install(session, socket)
            val borrow = field(session, "screenBorrow") as CarPlayScreenBorrow
            borrow.setEventReady(true)
            session.setScreenBorrowed(true)
            runReader(session, socket, generation)
            val rows = capture.readLines().mapNotNull { row ->
                val columns = row.split('\t')
                if (columns.getOrNull(2) == "iphone/carplay-screen-loan/events")
                    String(java.util.Base64.getDecoder().decode(columns[4]), Charsets.UTF_8) else null
            }
            assertTrue(rows.any { "event=COMMAND reason=RESPONSE" in it && "result=ACCEPTED" in it })
            assertFalse(rows.any { "confirmedBorrow=true" in it })
            assertTrue(session.isClosed)
        } finally {
            session.close()
            RawTraffic.configure(capture, false)
            directory.deleteRecursively()
        }
    }

    @Test fun failedResponseCannotOverrideAFreshModesChangedOwner() {
        val session = session()
        try {
            val socket = TestSocket()
            val generation = install(session, socket)
            val borrow = field(session, "screenBorrow") as CarPlayScreenBorrow
            borrow.setEventReady(true)
            session.setScreenBorrowed(true)
            borrow.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 1, "entity" to 2))))
            assertTrue(session.screenBorrowState.confirmedBorrow)
            val results = field(session, "commandResults") as CarPlayCommandResults
            val rejected = results.response(generation, RtspMessage.Request("RTSP/1.0", "200", "OK",
                mapOf("cseq" to "1"), BplistCodec.encode(mapOf("status" to -1)))).single()
            assertEquals(CarPlayCommandResults.Result.REJECTED, rejected.result)
            assertTrue(session.screenBorrowState.confirmedBorrow)
            assertFalse(session.isClosed)
        } finally { session.close() }
    }

    @Test fun retiredModesChangedWaitingForDispatchCannotOverwriteTheSuccessorOwner() {
        val body = BplistCodec.encode(mapOf("type" to "modesChanged", "params" to mapOf(
            "resources" to listOf(mapOf("resourceID" to 1, "entity" to 2)))))
        val wire = cipher().encrypt(("POST /command RTSP/1.0\r\nCSeq: 9\r\nContent-Length: ${body.size}\r\n\r\n")
            .toByteArray(Charsets.US_ASCII) + body)
        val read = CountDownLatch(1)
        val source = ByteArrayInputStream(wire)
        val old = TestSocket(object : InputStream() {
            override fun read(): Int = source.read()
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int =
                source.read(bytes, offset, length).also { if (it > 0) read.countDown() }
        })
        val current = TestSocket()
        val session = session()
        val failed = AtomicReference<Throwable>()
        var reader: Thread? = null
        try {
            val generation = install(session, old)
            val borrow = field(session, "screenBorrow") as CarPlayScreenBorrow
            borrow.setEventReady(true)
            session.setScreenBorrowed(true)
            // Hold dispatch, then replace the channel after the old packet has passed its read
            // identity check. The second identity check must reject it under the same monitor.
            synchronized(field(session, "eventReadLock")!!) {
                reader = Thread {
                    try { runReader(session, old, generation) } catch (error: Throwable) { failed.set(error) }
                }.apply { start() }
                assertTrue(read.await(2, TimeUnit.SECONDS))
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
                while (reader!!.state != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.yield()
                assertEquals(Thread.State.BLOCKED, reader!!.state)
                install(session, current)
                borrow.setEventReady(false)
                borrow.setEventReady(true)
                borrow.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 1, "entity" to 1))))
                assertEquals(CarPlayScreenOwner.Controller, session.screenBorrowState.owner)
            }
            reader!!.join(2_000)
            assertFalse(reader!!.isAlive)
            assertNull(failed.get())
            assertEquals(CarPlayScreenOwner.Controller, session.screenBorrowState.owner)
            assertFalse(session.screenBorrowState.confirmedBorrow)
            assertFalse(session.isClosed)
            assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
        } finally {
            session.close(); old.close(); current.close()
            reader?.join(2_000)
        }
    }

    private class TestSocket(private val input: InputStream = ByteArrayInputStream(ByteArray(0))) : Socket() {
        val output = ByteArrayOutputStream()
        override fun getInputStream(): InputStream = input
        override fun getOutputStream() = output
    }

    private fun install(session: AirPlaySession, socket: TestSocket): Long {
        synchronized(field(session, "eventReadLock")!!) {
            synchronized(field(session, "eventWriteLock")!!) {
                val tracker = field(session, "commandResults") as CarPlayCommandResults
                val generation = tracker.open().first
                setField(session, "eventSocket", socket)
                setField(session, "eventCipher", cipher())
                setField(session, "eventGeneration", generation)
                return generation
            }
        }
    }

    private fun runReader(session: AirPlaySession, socket: Socket, generation: Long) {
        AirPlaySession::class.java.getDeclaredMethod("runEventRead", Socket::class.java,
            ControlCipher::class.java, Long::class.javaPrimitiveType).apply { isAccessible = true }
            .invoke(session, socket, cipher(), generation)
    }

    private fun field(session: AirPlaySession, name: String): Any? =
        AirPlaySession::class.java.getDeclaredField(name).apply { isAccessible = true }.get(session)

    private fun setField(session: AirPlaySession, name: String, value: Any) {
        AirPlaySession::class.java.getDeclaredField(name).apply { isAccessible = true }.set(session, value)
    }

    private fun cipher() = ControlCipher(ByteArray(32), ByteArray(32))

    private fun session(media: AirPlayMediaHandler = object : AirPlayMediaHandler {}) = AirPlaySession(
        socket = TestSocket(),
        config = AirPlayConfig("test", "02:00:00:00:00:02", "02:00:00:00:00:01", "1.0",
            main = AirPlayDisplayConfig(800, 480)),
        identity = AirPlayIdentity.generate(), pairings = PairingStore(), mfi = null,
        listener = object : AirPlaySessionListener {}, media = media,
    )
}
