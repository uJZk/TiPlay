package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayPlaybackDiagnosticsTest {
    @Test fun sharedTempoRetainsManualIntentAndSignedVideoWindowWithinTheLineBudget() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val lines = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(lines::add, debug = { true }, nowMillis = { 0L }).event(7,
            fixture + ("engine" to (original + mapOf("manualPlaybackRate" to 2, "automaticPlaybackRate" to .98,
                "effectivePlaybackRate" to 1.96, "audioAppliedTempo" to 2, "audioVideoSyncErrorMs" to -46,
                "audioVideoSyncMinimumMs" to -45, "audioVideoSyncMaximumMs" to 125,
                "audioVideoSyncState" to "native-output-and-video-frame", "audioSyncControlDelayMs" to 2500,
                "audioSyncResponseMs" to 5000))), true)
        val tempo = lines.single { it.contains("stage=ENGINE_PCM") }
        val sync = lines.single { it.contains("stage=ENGINE_RENDER") }
        assertTrue(tempo, tempo.contains("manualPlaybackRate=2") && tempo.contains("effectivePlaybackRate=1.96"))
        assertTrue(sync, sync.contains("audioVideoSyncErrorMs=-46") && sync.contains("audioVideoSyncMinimumMs=-45"))
        assertTrue(lines.all { it.length <= 600 })
    }

    @Test fun tempoBackendsRetainOnlyFixedValuesWithinThePcmLineBudget() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val backends = listOf("none", "wasm-simd", "wasm", "soundtouchjs")
        for (backend in backends + listOf("https://private.invalid/?token=secret", "wasm\nsecret", "", "OTHER")) {
            val lines = mutableListOf<String>()
            AirPlayPlaybackDiagnostics(lines::add, debug = { true }, nowMillis = { 0L }).event(7,
                fixture + ("engine" to (original + ("audioTempoBackend" to backend))), true)
            val expected = backend.takeIf { it in backends } ?: "unknown"
            val pcm = lines.single { it.contains("stage=ENGINE_PCM") }
            assertTrue(pcm, pcm.contains("audioTempoBackend=$expected "))
            assertTrue(lines.all { it.length <= 600 && !it.contains("secret") && !it.contains('\n') })
        }
    }

    @Test fun browserRendererCountersUseTheirOwnBoundedGroupAndUnavailableDoesNotBecomeZero() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val lines = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(lines::add, debug = { true }, nowMillis = { 0L }).event(7, fixture, true)
        val render = lines.single { it.contains("stage=ENGINE_RENDER") }
        assertTrue(render, render.contains("renderStatsState=available") && render.contains("renderUnderrunEvents=1"))
        assertTrue(render, render.contains("renderUnderrunDurationMs=4.125") && render.contains("renderTotalDurationMs=12500.5"))
        assertTrue(lines.all { it.length <= 600 })
        for (state in listOf("unavailable", "invalid", "failed")) {
            val unknown = mutableListOf<String>()
            val source = original.filterKeys { it !in setOf("renderUnderrunEvents", "renderUnderrunDurationMs", "renderTotalDurationMs") } +
                ("renderStatsState" to state)
            AirPlayPlaybackDiagnostics(unknown::add, debug = { true }, nowMillis = { 0L }).event(7,
                fixture + ("engine" to source), true)
            val missing = unknown.single { it.contains("stage=ENGINE_RENDER") }
            assertTrue(missing, missing.contains("renderStatsState=$state") && missing.contains("renderUnderrunEvents=unknown") &&
                missing.contains("renderUnderrunDurationMs=unknown") && missing.contains("renderTotalDurationMs=unknown"))
        }
        val invalid = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(invalid::add, debug = { true }, nowMillis = { 0L }).event(7,
            fixture + ("engine" to (original + mapOf("renderStatsState" to "https://private.invalid/?token=secret",
                "renderUnderrunEvents" to 1.5, "renderUnderrunDurationMs" to -1, "renderTotalDurationMs" to Double.NaN))), true)
        assertTrue(invalid.single { it.contains("stage=ENGINE_RENDER") }.let {
            it.contains("renderStatsState=unknown") && it.contains("renderUnderrunEvents=unknown") &&
                it.contains("renderUnderrunDurationMs=unknown") && it.contains("renderTotalDurationMs=unknown") })
        assertTrue(invalid.all { !it.contains("secret") && it.length <= 600 })
    }

    @Test fun rendererCounterGrowthDoesNotAddPeriodicStandardSnapshots() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        repeat(4) { index ->
            diagnostics.event(7, fixture + ("engine" to (original + mapOf("startupPhase" to "playing", "running" to true,
                "intentPlaying" to true, "waitReason" to "none", "renderUnderrunEvents" to index,
                "renderUnderrunDurationMs" to index * 2.5, "renderTotalDurationMs" to now))), true)
            now += 10_000
        }
        assertEquals(12, lines.size)
    }

    @Test fun outputTimestampContradictionsRemainSignedAndBoundedWithoutOpeningOtherNumberFields() {
        val fixture = engineFixture("continuityEvent")
        val original = fixture["engine"] as Map<*, *>
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { true }, nowMillis = { 0L })
        diagnostics.event(7, fixture, true)
        val audio = lines.single { it.contains("stage=ENGINE_AUDIO") }
        assertTrue(audio, audio.contains("audioOutputTimestampState=future"))
        assertTrue(audio, audio.contains("audioOutputTimestampAgeMs=-20.125"))
        assertTrue(audio, audio.contains("audioOutputContextLagMs=-10.5"))
        assertTrue(lines.all { it.length <= 600 })
        val hostile = original + mapOf("audioOutputTimestampState" to "https://private.invalid/?token=secret",
            "audioOutputTimestampAgeMs" to Double.NEGATIVE_INFINITY,
            "audioOutputContextLagMs" to -9_007_199_254_740_992.0,
            "audioBaseLatencyMs" to -1, "audioScheduleGapUs" to -1)
        val invalid = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(invalid::add, debug = { true }, nowMillis = { 0L }).event(7,
            fixture + ("engine" to hostile), true)
        val unknown = invalid.single { it.contains("stage=ENGINE_AUDIO") }
        assertTrue(unknown, unknown.contains("audioOutputTimestampState=unknown") &&
            unknown.contains("audioOutputTimestampAgeMs=unknown") && unknown.contains("audioOutputContextLagMs=unknown"))
        assertTrue(unknown, unknown.contains("audioBaseLatencyMs=unknown"))
        assertTrue(invalid.last().contains("audioScheduleGapUs=unknown"))
        assertTrue(invalid.all { it.length <= 600 && !it.contains("secret") })
    }

    @Test fun outputTimestampStatesAreFixedAndDoNotAddHealthyStandardSummaries() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val states = listOf("unavailable", "closed", "format-mismatch", "startup", "invalid", "future", "context-ahead", "valid", "failed")
        for (state in states) {
            val lines = mutableListOf<String>()
            AirPlayPlaybackDiagnostics(lines::add, debug = { true }, nowMillis = { 0L }).event(7,
                fixture + ("engine" to (original + ("audioOutputTimestampState" to state))), true)
            assertTrue(lines.single { it.contains("stage=ENGINE_AUDIO") }.contains("audioOutputTimestampState=$state "))
        }
        val standard = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(standard::add, debug = { false }, nowMillis = { now })
        for (state in states) {
            diagnostics.event(7, fixture + ("engine" to (original + mapOf("audioOutputTimestampState" to state,
                "startupPhase" to "playing", "running" to true, "intentPlaying" to true, "waitReason" to "none"))), true)
            now += 10_000
        }
        assertEquals("Native timestamp jitter alone must not add periodic Standard reports", 12, standard.size)
    }

    @Test fun startupEdgesAndRealRebufferGapsReachStandardWithoutMediaPayloadsOrPeriodicFlooding() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        fun event(phase: String, extra: Map<String, Any> = emptyMap()) = diagnostics.event(7,
            fixture + ("engine" to (original + mapOf("startupPhase" to phase, "running" to false,
                "intentPlaying" to false, "waitReason" to "paused", "openElapsedMs" to 5000,
                "phaseElapsedMs" to 4000) + extra)), true)
        event("audio-menu")
        assertTrue(lines.single { it.contains("stage=ENGINE_STARTUP") }.contains("startupPhase=audio-menu openElapsedMs=5000 phaseElapsedMs=4000"))
        now = 250; event("metadata")
        assertEquals(24, lines.size)
        now = 10_000; event("metadata")
        assertEquals("Healthy paused preparation cannot become periodic Standard detail", 24, lines.size)
        event("playing", mapOf("running" to true, "intentPlaying" to true, "waitReason" to "none", "phaseElapsedMs" to 0))
        now = 15_000
        event("playing", mapOf("running" to true, "intentPlaying" to true, "waitReason" to "none",
            "audioScheduleUnderruns" to 1, "audioScheduleUnderrunMs" to 5.034,
            "audioScheduleUnderrunMaxMs" to 5.034, "audioRebufferStops" to 1))
        assertTrue(lines.last().contains("audioScheduleUnderruns=1") && lines.last().contains("audioRebufferStops=1"))
        assertTrue(lines.all { it.length <= 600 && !it.contains("http") })
    }
    @Test fun changedPcmContinuitySurvivesStandardAtFiveSecondsWithoutLabelingSilenceAsAnError() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val healthy = fixture + ("engine" to (original + mapOf("startupPhase" to "playing", "running" to true, "waitReason" to "none")))
        val continuity = engineFixture("continuityEvent")
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        diagnostics.event(7, fixture, true)
        now = 1000; diagnostics.event(7, healthy, true)
        assertEquals(24, lines.size)
        now = 5999; diagnostics.event(7, continuity, true)
        assertEquals(24, lines.size)
        now = 6000; diagnostics.event(7, continuity, true)
        assertEquals(36, lines.size)
        assertTrue(lines.takeLast(12).all { it.contains("stalled=false recovered=false") && it.length <= 600 })
        assertTrue(lines.last().contains("audioScheduleGapUs=22.676"))
        assertTrue(lines.any { it.contains("stage=ENGINE_CONTINUITY") && it.contains("audioSilenceFrames=1") })
        now = 12000; diagnostics.event(7, continuity, true)
        val engine = continuity["engine"] as Map<*, *>
        diagnostics.event(7, continuity + ("engine" to (engine + mapOf("audioDecodedFrames" to 882000,
            "audioAlignedPackets" to 100, "audioSeekTrimmedFrames" to 1))), true)
        assertEquals("Unchanged continuity or normal PCM growth cannot produce Standard summaries", 36, lines.size)
        now = 13000
        diagnostics.event(7, continuity + ("engine" to (engine + ("audioScheduleOverlapUs" to 22.676))), false)
        assertEquals("An inactive player cannot add PCM details", 36, lines.size)
    }
    @Test fun actualFaultAndChangedCleanupSnapshotsBypassThePeriodicGateWithoutRepeatingErrorProgress() {
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        diagnostics.event(7, engineFixture(), true)
        now = 1
        diagnostics.event(7, engineFixture("failureEvent"), true)
        assertEquals("A running decoder failure cannot be discarded after a recent stall snapshot", 25, lines.size)
        assertTrue(lines.takeLast(12).all { it.contains("stalled=false recovered=false") })
        assertTrue(lines.takeLast(12).any { it.contains("codec=vp09.00.10.08.01.01.01.01.00") })
        val cleanup = engineFixture("cleanupEvent")
        diagnostics.event(7, cleanup, true)
        assertEquals("The synchronous cleanup state must survive the 250 ms gate", 37, lines.size)
        assertTrue(lines.takeLast(12).any { it.contains("videoOwnedFrames=1") && it.contains("samplesClosed=56") })
        diagnostics.event(7, cleanup, true)
        val engine = cleanup["engine"] as Map<*, *>
        diagnostics.event(7, cleanup + ("engine" to (engine + ("clockTime" to 999))), true)
        now = 4999; diagnostics.event(7, cleanup, true)
        assertEquals("A periodic error state or changing clock must not force repeated snapshots", 37, lines.size)
        now = 5001; diagnostics.event(7, cleanup, true)
        assertEquals(49, lines.size)
        diagnostics.event(7, engineFixture("failureEvent"), false)
        assertEquals("A retired player can only emit its existing inactive EVENT, never an engine snapshot", 50, lines.size)
    }

    @Test fun semanticFailureSnapshotsSurviveEvenWhenNoPlayingIntentOrErrorWaitReasonExists() {
        val fixture = engineFixture()
        val engine = (fixture["engine"] as Map<*, *>) + mapOf("running" to false, "intentPlaying" to false, "waitReason" to "paused")
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { 0L })
        for (event in listOf("error", "open-error", "canvas-error", "play-rejected")) {
            diagnostics.event(7, fixture + mapOf("event" to event, "engine" to engine), true)
        }
        assertEquals(52, lines.size)
        assertEquals(4, lines.count { it.contains("stage=ENGINE_CODEC") })
        assertTrue(lines.all { it.length <= 600 })
    }
    @Test fun fullNineComponentAv1CodecIsRetainedButAdditionalComponentsAreRejected() {
        val fixture = engineFixture()
        val engine = fixture["engine"] as Map<*, *>
        val codec = "av01.0.08M.08.0.110.01.01.01.0"
        assertEquals(9, codec.count { it == '.' })
        fun record(value: String): String {
            val lines = mutableListOf<String>()
            AirPlayPlaybackDiagnostics(lines::add, debug = { false }).event(7,
                fixture + ("engine" to (engine + ("codec" to value))), true)
            return lines.single { it.contains("stage=ENGINE_CODEC") }
        }
        assertTrue(record(codec).contains("codec=$codec "))
        assertTrue(record("$codec.0").contains("codec=unknown "))
    }
    @Test fun productionBrowserEngineFixtureKeepsThePendingResumeCauseAndQueueBudgetInBoundedLines() {
        val fields = engineFixture()
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        diagnostics.event(7, fields, true)
        assertEquals(12, lines.size)
        assertTrue(lines.all { it.length <= 600 && it.contains("id=7 revision=3 generation=4 active=true stalled=true") })
        assertTrue(lines[0], lines[0].contains("waitReason=audio-context-resume") && lines[0].contains("resumePending=true"))
        assertTrue(lines[0], lines[0].contains("contextState=suspended") && lines[0].contains("stallElapsedMs=5000"))
        assertTrue(lines[1], lines[1].contains("playableEnd=12.7") && lines[1].contains("limitingTrack=audio"))
        assertTrue(lines[2], lines[2].contains("videoBytes=24883200") && lines[2].contains("audioReadPending=true"))
        assertTrue(lines[2], lines[2].contains("videoCapacityFrames=32") && lines[2].contains("videoCapacityBytes=100663296"))
        diagnostics.event(7, fields, true)
        now = 4999; diagnostics.event(7, fields, true)
        assertEquals(12, lines.size)
        now = 5000; diagnostics.event(7, fields, true)
        assertEquals(24, lines.size)
        now = 10000; diagnostics.event(7, fields, false)
        assertEquals("Retired players cannot replace the active engine snapshot", 24, lines.size)
        assertTrue(lines[3], lines[3].contains("codec=vp09.00.10.08.01.01.01.01.00") && lines[3].contains("actualHardware=unknown"))
        assertTrue(lines[4], lines[4].contains("samplesReceived=57") && lines[4].contains("samplesClosed=53"))
        assertTrue(lines[5], lines[5].contains("userActivationHasBeenActive=false") && lines[5].contains("audioResumeCompleted=0"))
        assertTrue(lines[6], lines[6].contains("resourceLastResult=eof") && lines[6].contains("resourceLastStatus=206"))
    }

    @Test fun healthyPeriodicDetailsAreDebugOnlyAndUnknownValuesCannotLeakOrExceedTheLineBudget() {
        val fixture = engineFixture()
        val original = fixture["engine"] as Map<*, *>
        val healthy = fixture + ("engine" to (original + mapOf("running" to true, "waitReason" to "none")))
        val standard = mutableListOf<String>()
        val standardDiagnostics = AirPlayPlaybackDiagnostics(standard::add, debug = { false })
        standardDiagnostics.event(7, healthy, true)
        assertEquals("The first startup phase is a retained boundary", 12, standard.size)
        standardDiagnostics.event(7, healthy, true)
        assertEquals("Healthy periodic progress cannot repeat that boundary", 12, standard.size)
        val lines = mutableListOf<String>()
        val hostile = original.mapValues { (_, value) -> if (value is Number) 9_007_199_254_740_991L else value } +
            mapOf("waitReason" to "https://private.test/?token=secret", "contextState" to "password=secret",
                "url" to "secret", "videoFrames" to 1.5, "audioBytes" to Double.NaN, "clockTime" to Double.POSITIVE_INFINITY)
        AirPlayPlaybackDiagnostics(lines::add, debug = { false }).event(Long.MAX_VALUE,
            fixture + mapOf("revision" to 9_007_199_254_740_991L, "engine" to hostile), true)
        assertEquals(12, lines.size)
        assertTrue(lines.all { it.length <= 600 && !it.contains("secret") && !it.contains('\n') })
        assertTrue(lines[0].contains("waitReason=unknown") && lines[0].contains("clockTime=unknown"))
        assertTrue(lines[2].contains("videoFrames=unknown") && lines[2].contains("audioBytes=unknown"))
        val debug = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(debug::add, debug = { true }).event(7, healthy, true)
        assertEquals(12, debug.size)
        val maximum = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(maximum::add, debug = { false }).event(Long.MAX_VALUE, engineFixture("maximumEvent"), true)
        assertEquals(12, maximum.size)
        assertTrue(maximum.joinToString("\n"), maximum.all { it.length <= 600 })
    }

    @Test fun oneRecoveryRequiresTheSameAcceptedStallIdentityAndSourceReplacementsClearIt() {
        val fixture = engineFixture()
        val engine = fixture["engine"] as Map<*, *>
        val recovered = fixture + ("engine" to (engine + mapOf("running" to true, "waitReason" to "none",
            "startReason" to "read-progress-fallback", "readProgressFallbacks" to 1)))
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        diagnostics.event(7, fixture, true)
        now = 1000
        diagnostics.event(7, recovered, true)
        assertEquals(24, lines.size)
        assertTrue(lines.takeLast(12).all { it.contains("recovered=true") && it.contains("stalled=false") })
        assertTrue(lines.any { it.contains("startReason=read-progress-fallback") && it.contains("readProgressFallbacks=1") })
        now = 20000; diagnostics.event(7, recovered, true)
        assertEquals("Healthy Standard progress cannot repeat a recovery", 24, lines.size)
        diagnostics.event(7, fixture, true)
        now = 21000; diagnostics.event(7, recovered + ("revision" to 4), true)
        diagnostics.event(7, recovered + ("engine" to (engine + mapOf("generation" to 5, "running" to true))), true)
        diagnostics.event(7, recovered, true)
        assertEquals("A newer command/generation retires the old stall identity", 36, lines.size)
        now = 30000; diagnostics.event(7, fixture, true)
        diagnostics.event(7, mapOf("revision" to 3, "event" to "open"), true)
        val afterOpen = lines.size
        now = 31000; diagnostics.event(7, recovered, true)
        assertEquals("A rebuilt source retains its own startup boundary", afterOpen + 12, lines.size)
        assertTrue("A new source cannot claim the retired source's recovery",
            lines.takeLast(12).all { it.contains("recovered=false") })
    }

    private fun engineFixture(key: String = "event"): Map<*, *> {
        val text = checkNotNull(javaClass.classLoader?.getResource("AirPlay-playback-diagnostics-v1.json")).readText()
        return (WebJson.parse(text) as Map<*, *>)[key] as Map<*, *>
    }
    @Test fun rateChangesReportImmediatelyWithoutLoggingUntrustedRateOrActionText() {
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add) { 0L }
        val fields = mapOf("revision" to 0L, "playing" to true, "rate" to 1.0)
        diagnostics.report(1, fields, true)
        diagnostics.report(1, fields + ("rate" to 1.5), true)
        diagnostics.report(1, fields + ("rate" to 1.5), true)
        assertEquals(2, lines.size)
        assertTrue(lines.last().contains("rate=1.5"))
        diagnostics.command(1, "rate", 1.5, true)
        assertTrue(lines.last().contains("action=rate target=1.5 accepted=true"))
        diagnostics.report(1, fields + ("rate" to "password=secret"), false)
        assertTrue(lines.last().contains("rate=unknown"))
        assertFalse(lines.joinToString().contains("secret"))
    }
    @Test fun reportsTransitionsImmediatelyAndStablePlaybackAtMostEveryFiveSeconds() {
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add) { now }
        val fields = mapOf("revision" to 0L, "position" to 1.0, "duration" to 10.0,
            "playing" to true, "ready" to true, "buffering" to false, "seekable" to true,
            "ended" to false, "failed" to false)
        diagnostics.report(1, fields, true)
        now = 400
        diagnostics.report(1, fields + ("position" to 2.0), true)
        assertEquals(1, lines.size)
        now = 5_000
        diagnostics.report(1, fields + ("position" to 6.0), true)
        assertEquals(2, lines.size)
        diagnostics.report(1, fields + ("ended" to true), true)
        diagnostics.report(1, fields + ("ended" to true), false)
        assertEquals(4, lines.size)
        assertTrue(lines[1].contains("position=6.0"))
        assertTrue(lines[2].contains("ended=true"))
        assertTrue(lines[3].contains("accepted=false"))
    }

    @Test fun untrustedBrowserDataCannotAddSecretsOrLinesToDiagnostics() {
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add)
        val hostile = mapOf("revision" to "token=secret", "position" to Double.NaN,
            "duration" to Double.POSITIVE_INFINITY, "paused" to "secret",
            "readyState" to 100, "networkState" to -1, "errorCode" to 1.5,
            "errorName" to "NotAllowedError\npassword=secret", "message" to "secret",
            "url" to "https://private.test/secret", "session" to "secret")
        diagnostics.event(1, hostile + ("event" to "play-rejected\nsecret"), true)
        assertTrue(lines.isEmpty())
        diagnostics.event(1, hostile + ("event" to "play-rejected"), true)
        diagnostics.command(1, "stop\nsecret", Double.NaN, false)
        diagnostics.report(1, hostile, false)
        assertEquals(3, lines.size)
        lines.forEach { assertFalse(it.contains("secret")); assertFalse(it.contains('\n')) }
        assertTrue(lines[0].contains("errorType=OTHER"))
        assertTrue(lines[0].contains("readyState=unknown"))
        assertTrue(lines[1].contains("action=OTHER target=unknown"))
    }

    @Test fun reportsTheActualBrowserFailureClassificationWithoutChangingPlayback() {
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add)
        diagnostics.event(2, mapOf("revision" to 3L, "event" to "play-rejected", "position" to 0.0,
            "duration" to 120.0, "paused" to true, "ended" to false, "seeking" to false,
            "dragging" to false, "readyState" to 4, "networkState" to 1, "errorCode" to 0,
            "errorName" to "NotAllowedError", "errorText" to "play() failed for https://private.test/video?token=hidden"), true)
        assertTrue(lines.single().contains("event=play-rejected active=true"))
        assertTrue(lines.single().contains("errorType=NotAllowedError"))
        assertTrue(lines.single().contains("duration=120.0"))
        assertTrue(lines.single().contains("errorText=play() failed for [url]"))
        assertFalse(lines.single().contains("private.test"))
        assertFalse(lines.single().contains("hidden"))
        AirPlayPlaybackDiagnostics({ error("unavailable log sink") }).report(2, emptyMap<String, Any>(), false)
    }
}
