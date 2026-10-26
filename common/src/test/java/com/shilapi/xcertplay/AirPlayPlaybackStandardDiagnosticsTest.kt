package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class AirPlayPlaybackStandardDiagnosticsTest {
    @Test fun runningFailureAndImmediateCleanupAreBothReadableInActualStandardStorage() {
        val path = "shared/src/test/resources/AirPlay-playback-diagnostics-v1.json"
        val file = listOf(java.io.File(path), java.io.File("../$path")).first { it.isFile }
        val parser = Class.forName("com.shilapi.xcertplay.web.WebJson")
        val fixture = parser.getMethod("parse", String::class.java)
            .invoke(parser.getField("INSTANCE").get(null), file.readText()) as Map<*, *>
        val directory = java.nio.file.Files.createTempDirectory("airplay-standard-fault").toFile()
        val previous = DiagnosticLogPolicy.level
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            SessionLogFile(directory.resolve("diplay.log")).use { log ->
                val type = Class.forName("com.shilapi.xcertplay.web.AirPlayPlaybackDiagnostics")
                val sink: (String) -> Unit = log::append
                val debug: () -> Boolean = { false }
                var time = 0L
                val now: () -> Long = { time }
                val diagnostics = type.constructors.single { it.parameterCount == 3 }.newInstance(sink, debug, now)
                val accept = type.getMethod("event", Long::class.javaPrimitiveType, Map::class.java, Boolean::class.javaPrimitiveType)
                accept.invoke(diagnostics, 7L, fixture["event"] as Map<*, *>, true)
                time = 1
                accept.invoke(diagnostics, 7L, fixture["failureEvent"] as Map<*, *>, true)
                val failed = log.file.readLines()
                assertEquals(11, failed.size)
                assertTrue(failed.any { it.contains("event=error") && it.contains("errorType=EncodingError") &&
                    it.contains("errorText=Decoder failed for [url]") })
                assertTrue(failed.takeLast(5).any { it.contains("running=false") && it.contains("waitReason=buffering") && it.contains("recovered=false") })
                assertTrue(failed.takeLast(5).any { it.contains("codec=av01.0.08M.08.0.110.01.01.01.0") && it.contains("codedWidth=1920 codedHeight=1080") })
                accept.invoke(diagnostics, 7L, fixture["cleanupEvent"] as Map<*, *>, true)
                val terminal = log.file.readLines()
                assertEquals(16, terminal.size)
                assertTrue(terminal.takeLast(5).any { it.contains("waitReason=error running=false intentPlaying=false") })
                assertTrue(terminal.takeLast(5).any { it.contains("audioPacketQueueLength=0 videoPacketQueueLength=0") })
                assertTrue(terminal.takeLast(5).any { it.contains("videoFrameRenderCount=120") && it.contains("videoStutter=1") })
                assertTrue(terminal.takeLast(5).all { it.length <= 600 && it.contains("recovered=false") })
                assertFalse(terminal.joinToString("\n").contains("private.test"))
                assertFalse(terminal.joinToString("\n").contains("secret"))
                accept.invoke(diagnostics, 7L, fixture["cleanupEvent"] as Map<*, *>, true)
                assertEquals("Repeated terminal progress cannot flood Standard", terminal, log.file.readLines())
                assertTrue(log.integrityLine(), log.integrityLine().contains("privacyFiltered=0") && log.integrityLine().contains("filtered=0"))
            }
        } finally { DiagnosticLogPolicy.level = previous; directory.deleteRecursively() }
    }
    @Test fun actualBrowserEngineSnapshotSurvivesNativeParsingAndRealStandardStorageWithoutLosingTheCause() {
        val path = "shared/src/test/resources/AirPlay-playback-diagnostics-v1.json"
        val file = listOf(java.io.File(path), java.io.File("../$path")).first { it.isFile }
        val parser = Class.forName("com.shilapi.xcertplay.web.WebJson")
        val fixture = parser.getMethod("parse", String::class.java)
            .invoke(parser.getField("INSTANCE").get(null), file.readText()) as Map<*, *>
        val event = fixture["event"] as Map<*, *>
        val directory = java.nio.file.Files.createTempDirectory("airplay-standard-fixture").toFile()
        val previous = DiagnosticLogPolicy.level
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            SessionLogFile(directory.resolve("diplay.log")).use { log ->
                // Shared's Kotlin-internal class is public JVM bytecode; exercise its production emitter.
                val type = Class.forName("com.shilapi.xcertplay.web.AirPlayPlaybackDiagnostics")
                val sink: (String) -> Unit = log::append
                val debug: () -> Boolean = { false }
                var time = 0L
                val now: () -> Long = { time }
                val diagnostics = type.constructors.single { it.parameterCount == 3 }.newInstance(sink, debug, now)
                val accept = type.getMethod("event", Long::class.javaPrimitiveType, Map::class.java, Boolean::class.javaPrimitiveType)
                accept.invoke(diagnostics, 7L, event, true)
                val saved = log.file.readLines()
                assertEquals(5, saved.size)
                assertTrue(saved.all { it.length <= 600 && it.contains("stalled=true") })
                val state = saved.single { it.contains("stage=ENGINE_STATE") }
                assertTrue(state, state.contains("engine=libmedia-avplayer renderMode=canvas waitReason=buffering"))
                assertTrue(state, state.contains("running=false intentPlaying=true gestureRequired=false") && state.contains("generation=4"))
                assertTrue(saved.any { it.contains("stage=ENGINE_PIPELINE") && it.contains("audioPacketQueueLength=2 videoPacketQueueLength=5") &&
                    it.contains("audioFrameDecodeCount=441 videoFrameDecodeCount=123") })
                assertTrue(saved.any { it.contains("stage=ENGINE_RENDER") && it.contains("audioFrameRenderCount=440 videoFrameRenderCount=120") &&
                    it.contains("audioStutter=0 videoStutter=1") })
                assertTrue(saved.any { it.contains("stage=ENGINE_CODEC") && it.contains("codec=av01.0.08M.08.0.110.01.01.01.0") &&
                    it.contains("codedWidth=1920 codedHeight=1080") })
                assertTrue(saved.any { it.contains("stage=ENGINE_STARTUP") && it.contains("startupPhase=first-samples") &&
                    it.contains("openElapsedMs=5000") })
                val engine = event["engine"] as Map<*, *>
                val recovered = event + ("engine" to (engine + mapOf("running" to true, "waitReason" to "none",
                    "startupPhase" to "playing")))
                time = 1000; accept.invoke(diagnostics, 7L, recovered, true)
                val afterRecovery = log.file.readLines()
                assertEquals(10, afterRecovery.size)
                assertTrue(afterRecovery.takeLast(5).all { it.contains("stalled=false recovered=true") && it.length <= 600 })
                assertTrue(afterRecovery.takeLast(5).any { it.contains("running=true intentPlaying=true") && it.contains("waitReason=none") })
                time = 20000; accept.invoke(diagnostics, 7L, recovered, true)
                assertEquals("Standard healthy progress must not repeat the recovery", afterRecovery, log.file.readLines())
                val healthyProgress = recovered + ("engine" to ((recovered["engine"] as Map<*, *>) + mapOf(
                    "audioFrameRenderCount" to 900, "videoFrameRenderCount" to 999, "audioPacketQueueLength" to 3)))
                time = 26000; accept.invoke(diagnostics, 7L, healthyProgress, true)
                assertEquals("Healthy AVPlayer counter growth cannot flood Standard", afterRecovery, log.file.readLines())
                accept.invoke(diagnostics, Long.MAX_VALUE, fixture["maximumEvent"] as Map<*, *>, true)
                val maximum = log.file.readLines()
                assertEquals(15, maximum.size)
                assertTrue(maximum.joinToString("\n"), maximum.all { it.length <= 600 })
                assertFalse(maximum.joinToString("\n").contains("private.test"))
                assertFalse(maximum.joinToString("\n").contains("secret"))
                assertTrue(log.integrityLine(), log.integrityLine().contains("privacyFiltered=0") && log.integrityLine().contains("filtered=0"))
            }
        } finally { DiagnosticLogPolicy.level = previous; directory.deleteRecursively() }
    }
}
