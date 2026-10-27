package com.shilapi.xcertplay.airplay

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AirPlayAudioSetupDiagnosticsTest {
    private val config = AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480))
    private val audioTypes = listOf(null, "compatibility", "default", "media", "telephony", "speechRecognition", "alert", "private")

    @Test fun acceptedTypesSurviveDeclinedReplacementAndPartialTeardown() {
        val diagnostics = AirPlayAudioSetupDiagnostics()
        diagnostics.record(101, mapOf("audioType" to "default"), accepted = true)
        diagnostics.record(100, mapOf("audioType" to "telephony"), accepted = true)
        diagnostics.record(101, mapOf("audioType" to "default"), accepted = false)
        diagnostics.record(103, mapOf("audioType" to "media"), accepted = false)
        val snapshot = diagnostics.snapshot()
        assertEquals(listOf(100, 101), snapshot.activeTypes)
        diagnostics.retire(listOf(100, 110))
        assertEquals(listOf(101), diagnostics.snapshot().activeTypes)
        assertEquals(listOf(100, 101), snapshot.activeTypes)
        diagnostics.retire()
        assertTrue(diagnostics.snapshot().activeTypes.isEmpty())
        assertEquals(4L, diagnostics.snapshot().count)
        diagnostics.close()
        diagnostics.record(100, mapOf("audioType" to "telephony"), accepted = true)
        assertTrue(diagnostics.snapshot().activeTypes.isEmpty())
        assertEquals(5L, diagnostics.snapshot().count)
    }

    @Test fun summaryPreservesTotalFirstSeenOrderAndSnapshotOwnership() {
        val diagnostics = AirPlayAudioSetupDiagnostics()
        assertEquals(AirPlayAudioDiagnostics.summary(config, emptyList()), diagnostics.snapshot().summary(config))
        diagnostics.record(100, mapOf("audioType" to "media"))
        diagnostics.record(101, mapOf("audioType" to "default"))
        diagnostics.record(100, mapOf("audioType" to "media"))
        val snapshot = diagnostics.snapshot()
        diagnostics.record(102, mapOf("audioType" to "alert"))
        assertEquals(3L, snapshot.count)
        assertEquals(listOf("100/media", "101/default"), snapshot.labels)
        assertEquals(AirPlayAudioDiagnostics.summary(config, listOf("100/media", "101/default", "100/media")),
            snapshot.summary(config))
        assertEquals(4L, diagnostics.snapshot().count)
    }

    @Test fun repeatedSetupsRetainOnlyWhitelistedDistinctLabels() {
        val diagnostics = AirPlayAudioSetupDiagnostics()
        repeat(1_000) { iteration ->
            for (type in 100..103) {
                for (audioType in audioTypes) {
                    diagnostics.record(type, mapOf("audioType" to if (audioType == "private") "secret-$iteration" else audioType))
                }
            }
        }
        val snapshot = diagnostics.snapshot()
        assertEquals(32_000L, snapshot.count)
        assertEquals(32, snapshot.labels.size)
        assertEquals("100/none", snapshot.labels.first())
        assertEquals("103/other", snapshot.labels.last())
        assertFalse(snapshot.summary(config).contains("secret"))
    }

    @Test fun concurrentWritersAndSnapshotsKeepExactTotals() {
        val diagnostics = AirPlayAudioSetupDiagnostics()
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(5)
        try {
            val writers = (100..103).map { type ->
                pool.submit {
                    assertTrue(start.await(5, TimeUnit.SECONDS))
                    repeat(2_000) { diagnostics.record(type, mapOf("audioType" to "media")) }
                }
            }
            val reader = pool.submit {
                assertTrue(start.await(5, TimeUnit.SECONDS))
                repeat(2_000) {
                    val snapshot = diagnostics.snapshot()
                    assertTrue(snapshot.count >= snapshot.labels.size)
                    assertTrue(snapshot.labels.size <= 4)
                    assertEquals(snapshot.count == 0L, snapshot.labels.isEmpty())
                }
            }
            start.countDown()
            writers.forEach { it.get(10, TimeUnit.SECONDS) }
            reader.get(10, TimeUnit.SECONDS)
            assertEquals(8_000L, diagnostics.snapshot().count)
            assertEquals((100..103).map { "$it/media" }.toSet(), diagnostics.snapshot().labels.toSet())
        } finally {
            pool.shutdownNow()
            assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS))
        }
    }

    @Test fun snapshotNeverSplitsAnAppendBetweenCountAndLabels() {
        val pool = Executors.newSingleThreadExecutor()
        try {
            repeat(100) {
                val diagnostics = AirPlayAudioSetupDiagnostics()
                val start = CountDownLatch(1)
                val writer = pool.submit {
                    assertTrue(start.await(5, TimeUnit.SECONDS))
                    for (type in 100..103) {
                        for (audioType in audioTypes) diagnostics.record(type, mapOf("audioType" to audioType))
                    }
                }
                start.countDown()
                repeat(100) {
                    val snapshot = diagnostics.snapshot()
                    assertEquals(snapshot.count, snapshot.labels.size.toLong())
                }
                writer.get(5, TimeUnit.SECONDS)
                assertEquals(32L, diagnostics.snapshot().count)
            }
        } finally {
            pool.shutdownNow()
            assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS))
        }
    }
}
