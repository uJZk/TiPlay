package com.shilapi.xcertplay.diagnostics

import com.github.luben.zstd.ZstdInputStream
import java.io.File
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class RawMetadataCaptureTest {
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
            RawTraffic.clear()
            RawTraffic.configure(raw, false, compressed = true)
            val before = RawTraffic.integrity()["failures"]
            assertFalse(RawTraffic.recordMetadataAsync("usb/device-event", byteArrayOf(1)))
            assertEquals(before, RawTraffic.integrity()["failures"])
        } finally { RawTraffic.configure(raw, false); root.deleteRecursively() }
    }
}
