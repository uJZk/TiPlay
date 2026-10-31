package com.shilapi.xcertplay

import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.github.luben.zstd.ZstdInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AsyncDiagnosticLogTest {
    @Test fun debugLoggingNeverWaitsForTheJournalMonitorAndRetainsObservationTime() {
        val folder = Files.createTempDirectory("diagnostic-callback-").toFile()
        val raw = folder.resolve("raw-traffic-test.tsv.zst")
        val target = SessionLogFile(folder.resolve("metadata.log"))
        val release = CountDownLatch(1)
        val held = CountDownLatch(1)
        val lock = RawTraffic::class.java.getDeclaredField("lock").apply { isAccessible = true }.get(RawTraffic)
        var holder: Thread? = null
        try {
            RawTraffic.configure(raw, true, compressed = true)
            target.reset("started")
            assertTrue(RawTraffic.awaitMetadataIdle(2_000))
            holder = Thread {
                synchronized(lock) { held.countDown(); release.await(3, TimeUnit.SECONDS) }
            }.apply { start() }
            assertTrue(held.await(1, TimeUnit.SECONDS))
            val started = System.nanoTime()
            AsyncDiagnosticLog.append(target, "CarPlay connected", nowMillis = 42)
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 1_000)
            assertFalse(AsyncDiagnosticLog.awaitIdle(10))
            release.countDown(); holder.join(1_000)
            assertTrue(AsyncDiagnosticLog.awaitIdle(2_000))
            val journal = ZstdInputStream(raw.inputStream()).use { String(it.readBytes()) }
            assertTrue(journal.lineSequence().any { it.startsWith("42\t") && it.contains("\tandroid/log\t") })
            assertTrue(target.file.readText().contains(".042 "))
            assertEquals(true, RawTraffic.integrity()["complete"])
        } finally {
            release.countDown(); holder?.join(1_000)
            RawTraffic.configure(raw, false); target.close(); folder.deleteRecursively()
        }
    }

    @Test fun queuedEvidenceIsRedactedAndTimestampedBeforeUsingItsCapturedFileTarget() {
        val folder = Files.createTempDirectory("diplay-async-log").toFile()
        val old = SessionLogFile(folder.resolve("old.log"))
        val current = SessionLogFile(folder.resolve("current.log"))
        try {
            old.reset("old session"); current.reset("current session")
            AsyncDiagnosticLog.append(old, "CONNECTION_DIAGNOSTIC attempt=1 teardown end elapsedMs=117", 0)
            AsyncDiagnosticLog.append(old, "Microphone: start type=telephony codec=OPUS peer=192.168.49.1", 0)
            AsyncDiagnosticLog.append(old, "CONNECTION_DIAGNOSTIC token=private-token", 0)
            AsyncDiagnosticLog.append(old, "Microphone: payload=private-audio", 0)
            assertTrue(AsyncDiagnosticLog.awaitIdle(2_000))
            val evidence = old.file.readText()
            assertTrue(evidence.contains("teardown end elapsedMs=117"))
            assertTrue(evidence.contains("Microphone: start type=telephony codec=OPUS peer=[ip]"))
            assertFalse(evidence.contains("192.168.49.1"))
            assertFalse(evidence.contains("private-token")); assertFalse(evidence.contains("private-audio"))
            assertFalse(current.file.readText().contains("teardown end"))
            assertEquals(4, evidence.lineSequence().count())
        } finally {
            old.close(); current.close(); folder.deleteRecursively()
        }
    }
}
