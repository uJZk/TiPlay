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
                assertEquals(15, failed.size)
                assertTrue(failed.any { it.contains("event=error") && it.contains("errorType=EncodingError") })
                assertTrue(failed.takeLast(7).any { it.contains("running=true") && it.contains("waitReason=error") && it.contains("recovered=false") })
                assertTrue(failed.takeLast(7).any { it.contains("codec=vp09.00.10.08.01.01.01.01.00") && it.contains("hardwareSupportProbe=supported") })
                accept.invoke(diagnostics, 7L, fixture["cleanupEvent"] as Map<*, *>, true)
                val terminal = log.file.readLines()
                assertEquals(22, terminal.size)
                assertTrue(terminal.takeLast(7).any { it.contains("videoOwnedFrames=1") && it.contains("samplesClosed=56") })
                assertTrue(terminal.takeLast(7).all { it.length <= 600 && it.contains("recovered=false") })
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
                assertEquals(7, saved.size)
                assertTrue(saved.all { it.length <= 600 && it.contains("stalled=true") })
                val state = saved.single { it.contains("stage=ENGINE_STATE") }
                assertTrue(state, state.contains("waitReason=audio-context-resume") && state.contains("resumePending=true"))
                assertTrue(state, state.contains("contextState=suspended") && state.contains("generation=4"))
                assertTrue(saved.any { it.contains("stage=ENGINE_BUFFER") && it.contains("targetMs=1000") && it.contains("limitingTrack=audio") })
                assertTrue(saved.any { it.contains("stage=ENGINE_PIPELINE") && it.contains("videoBudgetBlocked=true") && it.contains("audioReadPending=true") })
                assertTrue(saved.any { it.contains("videoCapacityFrames=32") && it.contains("audioCapacityBytes=12582912") })
                assertTrue(saved.any { it.contains("codec=vp09.00.10.08.01.01.01.01.00") && it.contains("actualHardware=unknown") })
                assertTrue(saved.any { it.contains("samplesReceived=57") && it.contains("samplesClosed=53") && it.contains("bytes=app-rgba8-estimate") })
                assertTrue(saved.any { it.contains("userActivationHasBeenActive=false") && it.contains("gestureRequired=true") })
                assertTrue(saved.any { it.contains("resourceLastResult=eof") && it.contains("resourceLastStatus=206") })
                val engine = event["engine"] as Map<*, *>
                val recovered = event + ("engine" to (engine + mapOf("running" to true, "waitReason" to "none",
                    "contextState" to "running", "resumePending" to false, "audioResumeCompleted" to 1,
                    "startReason" to "read-progress-fallback", "readProgressFallbacks" to 1)))
                time = 1000; accept.invoke(diagnostics, 7L, recovered, true)
                val afterRecovery = log.file.readLines()
                assertEquals(14, afterRecovery.size)
                assertTrue(afterRecovery.takeLast(7).all { it.contains("stalled=false recovered=true") && it.length <= 600 })
                assertTrue(afterRecovery.any { it.contains("startReason=read-progress-fallback") && it.contains("readProgressFallbacks=1") })
                time = 20000; accept.invoke(diagnostics, 7L, recovered, true)
                assertEquals("Standard healthy progress must not repeat the recovery", afterRecovery, log.file.readLines())
                accept.invoke(diagnostics, Long.MAX_VALUE, fixture["maximumEvent"] as Map<*, *>, true)
                assertEquals(21, log.file.readLines().size)
                assertTrue(log.file.readLines().joinToString("\n"), log.file.readLines().all { it.length <= 600 })
                assertTrue(log.integrityLine(), log.integrityLine().contains("privacyFiltered=0") && log.integrityLine().contains("filtered=0"))
            }
        } finally { DiagnosticLogPolicy.level = previous; directory.deleteRecursively() }
    }
}
