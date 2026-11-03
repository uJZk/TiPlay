package com.shilapi.xcertplay.diagnostics

import com.github.luben.zstd.ZstdInputStream
import java.io.File
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class RawMetadataCaptureTest {
    @Test fun failureReportKeepsBoundedTimesReasonsAndSafeSourceCategories() {
        val state = MetadataCaptureSession("test")
        val before = System.currentTimeMillis()
        repeat(35) {
            assertFalse(state.enqueue("iphone/private-url-secret", ByteArray(RawMetadataCapture.MAX_BYTES + 1), 42L + it))
        }
        assertFalse(state.enqueue("browser/" + "x".repeat(257), byteArrayOf(1), 91))
        val report = state.failureReport()
        assertTrue(report.contains("omitted=4"))
        assertTrue(report.contains("payload_too_large=35"))
        assertTrue(report.contains("channel_too_long=1"))
        assertEquals(32, report.lineSequence().count { it.startsWith("RAW_ASYNC_FAILURE reason=") })
        assertTrue(report.contains("observedEpochMillis=91 source=browser bytes=1"))
        assertFalse(report.contains("private-url-secret"))
        val first = Regex("firstEpochMillis=(\\d+)").find(report)!!.groupValues[1].toLong()
        val last = Regex("lastEpochMillis=(\\d+)").find(report)!!.groupValues[1].toLong()
        assertTrue(first >= before && last >= first && last <= System.currentTimeMillis())
    }
    private fun text(file: File) = ZstdInputStream(file.inputStream()).use { String(it.readBytes()) }
    private fun journalLock(): Any = RawTraffic::class.java.getDeclaredField("lock").apply {
        isAccessible = true
    }.get(RawTraffic)

    private fun waitForCancelledQueue() {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (RawMetadataCapture.queuedCount != 0 && System.nanoTime() < deadline) Thread.sleep(1)
        assertEquals(0, RawMetadataCapture.queuedCount)
    }

    @Test fun normalMetadataCanDrainBeforeStopWithoutLosingCompleteness() {
        val root = Files.createTempDirectory("metadata-drain-").toFile()
        val raw = root.resolve("raw-traffic-normal.tsv.zst")
        try {
            RawTraffic.configure(raw, true, compressed = true)
            assertTrue(RawTraffic.recordMetadataAsync("usb/device-event", "full-usb-event".toByteArray(), observedAtMillis = 42))
            assertTrue(RawTraffic.awaitMetadataIdle(2_000))
            assertEquals(true, RawTraffic.integrity()["complete"])
            RawTraffic.configure(raw, false, compressed = true)
            assertEquals(true, RawTraffic.integrity()["complete"])
            assertTrue(text(raw).contains("ZnVsbC11c2ItZXZlbnQ="))
            assertTrue(text(raw).lineSequence().any { it.startsWith("42\t") && it.contains("\tusb/device-event\t") })
        } finally { RawTraffic.configure(raw, false); root.deleteRecursively() }
    }

    @Test fun overloadAndStopAreExplicitAndOldWorkCannotEnterTheNextCapture() {
        val root = Files.createTempDirectory("metadata-overload-").toFile()
        val old = root.resolve("raw-traffic-old.tsv.zst")
        val current = root.resolve("raw-traffic-current.tsv.zst")
        try {
            RawTraffic.configure(old, true, compressed = true)
            val session = requireNotNull(RawTraffic.activeSessionId())
            synchronized(journalLock()) {
                val started = System.nanoTime()
                val admitted = (1..128).count {
                    RawTraffic.recordMetadataForSessionAsync(session, "usb/device-event", "old-event".toByteArray())
                }
                assertTrue(admitted in 1..65)
                assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 1_000)
                assertEquals(false, RawTraffic.integrity()["complete"])
                assertEquals(false, RawTraffic.integrity()["referenceIntegrity"])
                assertFalse(RawTraffic.awaitMetadataIdle(10))
                RawTraffic.configure(old, false, compressed = true)
                assertEquals(false, RawTraffic.integrity()["complete"])
                val state = RawTraffic.integrity()["asyncMetadata"] as Map<*, *>
                assertEquals(0, state["pending"])
                assertTrue((state["failures"] as Long) > 0)
                RawTraffic.configure(current, true, compressed = true)
                assertNotEquals(session, RawTraffic.activeSessionId())
                assertEquals(true, RawTraffic.integrity()["complete"])
                assertFalse(RawTraffic.recordMetadataForSessionAsync(session, "usb/device-event", byteArrayOf(1)))
            }
            waitForCancelledQueue()
            assertEquals(true, RawTraffic.integrity()["complete"])
            assertFalse(text(current).contains("b2xkLWV2ZW50"))
            assertTrue(text(old).contains("\tcapture/stop\t"))
            val stop = text(old).lineSequence().first { it.contains("\tcapture/stop\t") }.split('\t', limit = 5)
            val failureReport = String(java.util.Base64.getDecoder().decode(stop[4]))
            assertTrue(Regex("queue_full=[1-9][0-9]*").containsMatchIn(failureReport))
            assertTrue(failureReport.contains("reason=session_retired"))
        } finally { RawTraffic.configure(current, false); waitForCancelledQueue(); root.deleteRecursively() }
    }

    @Test fun oversizedMetadataIsAnExplicitFaultButDisabledCaptureIsNot() {
        val root = Files.createTempDirectory("metadata-cap-").toFile()
        val raw = root.resolve("raw-traffic-cap.tsv.zst")
        try {
            RawTraffic.configure(raw, true, compressed = true)
            assertFalse(RawTraffic.recordMetadataAsync("usb/device-event", ByteArray(RawMetadataCapture.MAX_BYTES + 1)))
            assertEquals(false, RawTraffic.integrity()["complete"])
            assertEquals(false, RawTraffic.integrity()["referenceIntegrity"])
            val archive = java.io.ByteArrayOutputStream()
            RawTraffic.writeArchive(archive, "report.txt", "report", root)
            java.util.zip.ZipInputStream(archive.toByteArray().inputStream()).use { zip ->
                var status = ""
                while (true) {
                    val item = zip.nextEntry ?: break
                    if (item.name == "capture.txt.zst") status = ZstdInputStream(zip.readBytes().inputStream()).use { String(it.readBytes()) }
                }
                assertTrue(status.contains("payload_too_large=1"))
                assertTrue(status.contains("reason=payload_too_large"))
                assertTrue(status.contains("source=usb"))
                assertTrue(status.contains("lastFailure=AsyncMetadataLoss"))
            }
            RawTraffic.clear()
            RawTraffic.configure(raw, false, compressed = true)
            val before = RawTraffic.integrity()["failures"]
            assertFalse(RawTraffic.recordMetadataAsync("usb/device-event", byteArrayOf(1)))
            assertEquals(before, RawTraffic.integrity()["failures"])
        } finally { RawTraffic.configure(raw, false); root.deleteRecursively() }
    }
}
