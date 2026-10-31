package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.Socket
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class CarPlayScreenBorrowDiagnosticsTest {
    @Test fun semanticObservationDoesNotWaitForABlockedCaptureWriter() = capture { file ->
        val diagnostics = CarPlayScreenBorrowDiagnostics()
        val worker = java.util.concurrent.Executors.newSingleThreadExecutor()
        val journalLock = RawTraffic::class.java.getDeclaredField("lock").apply { isAccessible = true }.get(RawTraffic)
        try {
            synchronized(journalLock) {
                worker.submit { diagnostics.changed(CarPlayScreenBorrowState(desired = true, pending = true)) }
                    .get(1, java.util.concurrent.TimeUnit.SECONDS)
                assertFalse(RawTraffic.awaitMetadataIdle(10))
            }
            assertEquals("true", semanticRows(file).single()["pending"])
        } finally { worker.shutdownNow() }
    }

    @Test fun rawSemanticFieldsHaveLocalConnectionIdentityAndNoSenderPayload() = capture { file ->
        val first = CarPlayScreenBorrowDiagnostics()
        val second = CarPlayScreenBorrowDiagnostics()
        first.changed(CarPlayScreenBorrowState(true, true, CarPlayScreenOwner.Accessory))
        first.closed(CarPlayConnectionCloseReason.PEER_EOF,
            CarPlayScreenBorrowState(true, true, CarPlayScreenOwner.Accessory))
        second.changed(CarPlayScreenBorrowState(owner = CarPlayScreenOwner.Controller))
        val rows = semanticRows(file)
        assertEquals(3, rows.size)
        assertEquals(setOf("schema", "connectionId", "event", "reason", "desired", "sent", "owner",
            "pending", "confirmedBorrow", "carPlayHasScreen"), rows.first().keys)
        assertEquals("STATE", rows[0]["event"])
        assertEquals("true", rows[0]["confirmedBorrow"])
        assertEquals("false", rows[0]["carPlayHasScreen"])
        assertEquals("CLOSE", rows[1]["event"])
        assertEquals("PEER_EOF", rows[1]["reason"])
        assertEquals(rows[0]["connectionId"], rows[1]["connectionId"])
        assertEquals(rows[0].getValue("connectionId").toLong() + 1,
            rows[2].getValue("connectionId").toLong())
        assertEquals("true", rows[2]["carPlayHasScreen"])
        assertTrue(file.readLines().all { line ->
            line.split('\t')[2] in setOf("capture/start", "iphone/carplay-screen-loan/events")
        })
    }

    @Test fun disabledCaptureDoesNotCreateJournalOrReplayClosedConnectionLater() {
        val directory = java.nio.file.Files.createTempDirectory("screen-semantic-disabled").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, false)
            val diagnostics = CarPlayScreenBorrowDiagnostics()
            diagnostics.changed(CarPlayScreenBorrowState(desired = true, pending = true))
            diagnostics.closed(CarPlayConnectionCloseReason.UNSPECIFIED, CarPlayScreenBorrowState())
            assertFalse(file.exists())
            RawTraffic.configure(file, true)
            diagnostics.changed(CarPlayScreenBorrowState(owner = CarPlayScreenOwner.Controller))
            diagnostics.closed(CarPlayConnectionCloseReason.PEER_EOF, CarPlayScreenBorrowState())
            assertTrue(semanticRows(file).isEmpty())
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun clearBetweenObservationAndAppendCannotInsertOldCaptureIntoNewJournal() = capture { file ->
        var clearBeforeAppend = true
        val diagnostics = CarPlayScreenBorrowDiagnostics(record = { session, channel, bytes, _ ->
            if (clearBeforeAppend) { clearBeforeAppend = false; RawTraffic.clear() }
            RawTraffic.recordForSession(session, channel, bytes)
        })
        diagnostics.changed(CarPlayScreenBorrowState(desired = true, pending = true))
        assertTrue(semanticRows(file).isEmpty())
        diagnostics.changed(CarPlayScreenBorrowState(owner = CarPlayScreenOwner.Controller))
        assertEquals("false", semanticRows(file).single()["desired"])
        assertEquals("Controller", semanticRows(file).single()["owner"])
    }

    @Test fun observationFailuresDoNotThrowAndCloseRemainsExactlyOnce() {
        var writes = 0
        val events = mutableListOf<String>()
        val diagnostics = CarPlayScreenBorrowDiagnostics(activeCapture = { "test-capture" },
            record = { _, _, bytes, _ ->
                writes++
                if (writes == 1) throw IOException("private sender data must stay out of schema")
                events += bytes.toString(Charsets.UTF_8)
                true
            })
        diagnostics.changed(CarPlayScreenBorrowState(desired = true, pending = true))
        diagnostics.closed(CarPlayConnectionCloseReason.UNSPECIFIED, CarPlayScreenBorrowState())
        diagnostics.closed(CarPlayConnectionCloseReason.PEER_EOF, CarPlayScreenBorrowState())
        diagnostics.changed(CarPlayScreenBorrowState())
        assertEquals(2, writes)
        assertEquals(1, events.size)
        assertTrue(events.single().contains("event=CLOSE reason=UNSPECIFIED"))
        CarPlayScreenBorrowDiagnostics(activeCapture = { throw IllegalStateException("capture unavailable") })
            .changed(CarPlayScreenBorrowState())
    }

    @Test fun sessionDeduplicatesStateButAlwaysCapturesOneCloseEvenAtDefaultState() = capture { file ->
        val states = mutableListOf<CarPlayScreenBorrowState>()
        val session = session(listener = object : AirPlaySessionListener {
            override fun onDebugLog(message: String) { throw IllegalStateException("log observer failure") }
            override fun onScreenBorrowChanged(session: AirPlaySession, state: CarPlayScreenBorrowState) {
                states += state
            }
        })
        try {
            session.setScreenBorrowed(true)
            session.setScreenBorrowed(true)
            session.setScreenBorrowed(false)
            session.setScreenBorrowed(false)
            session.close()
            session.close()
            val rows = semanticRows(file)
            assertEquals(listOf("STATE", "STATE", "CLOSE"), rows.map { it["event"] })
            assertEquals(listOf("true", "false", "false"), rows.map { it["desired"] })
            assertEquals("UNSPECIFIED", rows.last()["reason"])
            assertEquals(2, states.size)
            assertTrue(session.isClosed)
        } finally { session.close() }
    }

    @Test fun realControlEofHasTypedCloseBoundaryWithoutAnyLoanTransition() = capture { file ->
        val session = session(socket = inputSocket(ByteArrayInputStream(byteArrayOf())))
        try {
            runControl(session)
            assertTrue(session.isClosed)
            val row = semanticRows(file).single()
            assertEquals("CLOSE", row["event"])
            assertEquals("PEER_EOF", row["reason"])
            assertEquals("false", row["desired"])
            assertEquals("Unknown", row["owner"])
        } finally { session.close() }
    }

    @Test fun realControlReadFailureKeepsOnlyTypedCauseInSemanticBoundary() = capture { file ->
        val input = object : InputStream() {
            override fun read(): Int = throw IOException("https://private-host/token-and-cookie")
        }
        val session = session(socket = inputSocket(input))
        try {
            runControl(session)
            val row = semanticRows(file).single()
            assertEquals("CONTROL_IO_FAILED", row["reason"])
            assertFalse(row.values.any { it.contains("private-host") || it.contains("cookie") || it.contains("https:") })
        } finally { session.close() }
    }

    @Test fun screenDataBoundariesCannotBeMistakenForOwnershipOrAControlDisconnect() = capture { file ->
        val diagnostics = CarPlayScreenBorrowDiagnostics()
        val borrowed = CarPlayScreenBorrowState(true, true, CarPlayScreenOwner.Accessory)
        diagnostics.screen(CarPlayScreenDataBoundary.SETUP, true, borrowed)
        diagnostics.screen(CarPlayScreenDataBoundary.DATA_EOF, false, borrowed)
        diagnostics.changed(CarPlayScreenBorrowState(false, false, CarPlayScreenOwner.Controller))
        diagnostics.closed(CarPlayConnectionCloseReason.SCREEN_RETURN_WITHOUT_STREAM,
            CarPlayScreenBorrowState(false, false, CarPlayScreenOwner.Controller))
        diagnostics.screen(CarPlayScreenDataBoundary.DATA_FAILED, false, borrowed)
        val rows = semanticRows(file)
        assertEquals(listOf("SCREEN", "SCREEN", "STATE", "CLOSE"), rows.map { it["event"] })
        assertEquals(listOf("SETUP", "DATA_EOF", "NONE", "SCREEN_RETURN_WITHOUT_STREAM"), rows.map { it["reason"] })
        assertEquals(listOf("true", "false"), rows.take(2).map { it["screenAvailable"] })
        assertEquals("true", rows[1]["confirmedBorrow"])
        assertEquals("true", rows[2]["carPlayHasScreen"])
        assertTrue(rows.all { it["connectionId"] == rows.first()["connectionId"] })
    }

    private fun capture(block: (File) -> Unit) {
        val directory = java.nio.file.Files.createTempDirectory("screen-semantic-capture").toFile()
        val file = File(directory, "capture.tsv")
        try { RawTraffic.configure(file, true); block(file) }
        finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    private fun semanticRows(file: File): List<Map<String, String>> {
        assertTrue("metadata capture did not become idle", RawTraffic.awaitMetadataIdle(2_000))
        return if (!file.exists()) emptyList() else file.readLines().mapNotNull { line ->
            val fields = line.split('\t')
            if (fields.getOrNull(2) != "iphone/carplay-screen-loan/events") null
            else String(Base64.getDecoder().decode(fields[4]), Charsets.UTF_8).trim().split(' ')
                .associate { it.substringBefore('=') to it.substringAfter('=') }
        }
    }

    private fun inputSocket(input: InputStream): Socket = object : Socket() {
        override fun getInputStream(): InputStream = input
        override fun getOutputStream() = ByteArrayOutputStream()
    }

    private fun runControl(session: AirPlaySession) {
        AirPlaySession::class.java.getDeclaredMethod("runControl").apply { isAccessible = true }.invoke(session)
    }

    private fun session(socket: Socket = Socket(),
        listener: AirPlaySessionListener = object : AirPlaySessionListener {}): AirPlaySession = AirPlaySession(
        socket = socket,
        config = AirPlayConfig("test", "02:00:00:00:00:02", "02:00:00:00:00:01", "1.0",
            main = AirPlayDisplayConfig(800, 480)),
        identity = AirPlayIdentity.generate(), pairings = PairingStore(), mfi = null,
        listener = listener, media = object : AirPlayMediaHandler {},
    )
}
