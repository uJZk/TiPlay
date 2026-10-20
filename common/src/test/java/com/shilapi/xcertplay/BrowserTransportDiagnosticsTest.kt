package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class BrowserTransportDiagnosticsTest {
    @Test fun productionBrowserSummaryFixtureKeepsNestedRtcAndAudioFailuresInStandardMetadata() {
        val fixture = readFixture("shared/src/test/resources/Browser-standard-diagnostics-v1.json")
        assertEquals("st", fixture["k"])
        val selected = (fixture["v"] as Map<*, *>).entries.associate { (key, value) -> key as String to value }
        // Remote main uses nested ice/video stats and link failure evidence. Remove only the
        // parallel compatibility fields to prove that layout is independently observable.
        val nested = selected - setOf("transport.stage", "transport.reason", "transport.generation")
        val directory = java.nio.file.Files.createTempDirectory("browser-standard-fixture").toFile()
        val previous = DiagnosticLogPolicy.level
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            SessionLogFile(directory.resolve("diplay.log")).use { log ->
                val diagnostics = BrowserTransportDiagnostics(log::append)
                diagnostics.report(nested, false)
                val saved = log.file.readText()
                assertTrue(saved, saved.contains("reason=ice"))
                assertTrue(saved, saved.contains("stage=remote-ice"))
                assertTrue(saved, saved.contains("localUdpCandidates=2") && saved.contains("remoteUdpCandidates=1"))
                assertTrue(saved, saved.contains("selectedProtocol=udp") && saved.contains("rttMs=8"))
                assertTrue(saved, saved.contains("video.retainedBytes=1024") && saved.contains("video.receivedRecords=12"))
                assertTrue(saved, saved.contains("decodeStalls=1") && saved.contains("playbackProfile=carplay-touch"))
                assertTrue(saved, saved.contains("stage=AUDIO") && saved.contains("sourceDeadlineRejectedFrames=128"))
                assertTrue(saved, saved.contains("sourceDeadlineReason=source-deadline"))
                assertTrue(saved.lines().filter(String::isNotEmpty).all { it.length <= 600 })
                diagnostics.report(nested, false)
                assertEquals("Repeated identical failures must not replace earlier evidence with log flood", saved, log.file.readText())
            }
        } finally { DiagnosticLogPolicy.level = previous; directory.deleteRecursively() }
    }

    @Test fun productionLivePolicySelectorKeepsAppliedThresholdsAndClockEvidenceInActualStandardStorage() {
        val fixture = readFixture("shared/src/test/resources/Browser-live-policy-diagnostics-v1.json")
        val event = fixture["standard"] as Map<*, *>
        assertEquals("st", event["k"])
        val selected = (event["v"] as Map<*, *>).entries.associate { (key, value) -> key as String to value }
        val directory = java.nio.file.Files.createTempDirectory("browser-live-policy-fixture").toFile()
        val previous = DiagnosticLogPolicy.level
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            SessionLogFile(directory.resolve("diplay.log")).use { log ->
                val diagnostics = BrowserTransportDiagnostics(log::append)
                diagnostics.report(selected, false)
                val saved = log.file.readText()
                val policy = saved.lines().filter { it.contains("stage=POLICY") }.joinToString(" ")
                for (field in listOf("playbackProfile", "policyVideoReadinessMs", "policyVideoMarginMs", "policyVideoTargetMs",
                    "policyInteractionStarts", "policyInteractionReleases", "policyMaxDelayMs", "policyMaxVideoFrames", "policyMaxVideoBytes",
                    "sourceClockState", "sourceClockAgeMs", "sourceClockMaxAgeMs", "clockEstimatorState",
                    "clockEstimatorObservationAgeMs", "clockEstimatorSelectedAgeMs")) {
                    assertNotNull("Production selector must retain video.$field", selected["video.$field"])
                    assertTrue(policy, policy.contains("$field="))
                }
                assertTrue(policy, policy.contains("policyInteractionActive=false"))
                assertTrue(saved, saved.contains("stage=PIPELINE") && saved.contains("scheduledCapacityFrames="))
                assertTrue(saved.lines().filter(String::isNotEmpty).all { it.length <= 600 })
                assertTrue(log.integrityLine(), log.integrityLine().contains("privacyFiltered=0"))
                diagnostics.report(selected, false)
                assertEquals(saved, log.file.readText())
            }
        } finally { DiagnosticLogPolicy.level = previous; directory.deleteRecursively() }
    }

    @Test fun shortTouchEdgesAndAppliedProfileChangesRemainObservableWithoutMoveOrConvergenceFlood() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val baseline = policyStats()
        diagnostics.report(baseline, false)
        lines.clear()
        // The interaction began and ended between the ordinary four-second summaries.
        val released = baseline + mapOf("video.policyInteractionStarts" to 1, "video.policyInteractionReleases" to 1,
            "video.policyProfileSwitches" to 2, "video.policyPlanChanges" to 3)
        diagnostics.report(released, false)
        val touch = lines.filter { it.contains("stage=POLICY") }.joinToString(" ")
        assertTrue(touch, touch.contains("policyInteractionStarts=1") && touch.contains("policyInteractionReleases=1"))
        assertTrue(touch, touch.contains("policyInteractionActive=false") && touch.contains("playbackProfile=carplay"))
        assertTrue(lines.all { it.contains("stage=POLICY") })
        lines.clear()
        repeat(20) { move ->
            diagnostics.report(released + mapOf("video.policyVideoPlanRemainingMs" to 100 - move,
                "video.policyVideoLeadRemainingMs" to 80 - move, "video.sourceClockAgeMs" to move,
                "video.policyPlanChanges" to 3 + move, "video.touchMoves" to move), false)
        }
        assertTrue("Move, clock ages and convergence estimates must not create Standard summaries", lines.isEmpty())
        diagnostics.report(released + mapOf("video.playbackProfile" to "carplay-touch", "video.policyInteractionActive" to true,
            "video.policyInteractionStarts" to 2, "video.policyVideoTargetMs" to 70, "video.policyTargetReason" to "touch"), false)
        val active = lines.joinToString(" ")
        assertTrue(active, active.contains("playbackProfile=carplay-touch") && active.contains("policyVideoTargetMs=70"))
        assertTrue(active, active.contains("policyTargetReason=touch"))
    }

    @Test fun clockValidityEdgesRemainObservableButAgesMissingFieldsAndNewEpochsDoNotCreateFalsePolicyChanges() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val baseline = policyStats()
        diagnostics.report(baseline, false)
        lines.clear()
        val stale = baseline + mapOf("video.sourceClockState" to "stale", "video.sourceClockAgeMs" to 15_001)
        diagnostics.report(stale, false)
        assertTrue(lines.joinToString(" ").contains("sourceClockState=stale"))
        assertTrue(lines.joinToString(" ").contains("sourceClockMaxAgeMs=15000"))
        lines.clear()
        diagnostics.report(stale + ("video.sourceClockAgeMs" to 20_000), false)
        diagnostics.report(stale - setOf("video.sourceClockState", "video.policyInteractionStarts"), false)
        assertTrue(lines.isEmpty())
        diagnostics.report(baseline, false)
        assertTrue(lines.joinToString(" ").contains("sourceClockState=fresh"))
        lines.clear()
        // A new stream establishes its own baseline rather than interpreting a counter reset as a touch.
        diagnostics.report(stale + mapOf("video.epoch" to 8, "video.policyInteractionStarts" to 0), false)
        assertTrue(lines.isEmpty())
    }

    @Test fun capacityEvictionKeepsPolicyAndPipelineEvidenceThroughRealStandardStorageWithoutDebug() {
        val directory = java.nio.file.Files.createTempDirectory("browser-policy-standard").toFile()
        val previous = DiagnosticLogPolicy.level
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            SessionLogFile(directory.resolve("diplay.log")).use { log ->
                val diagnostics = BrowserTransportDiagnostics(log::append)
                val baseline = policyStats() + ("video.scheduledCapacityFrames" to 0)
                diagnostics.report(baseline, false)
                val before = log.file.readText()
                diagnostics.report(baseline + ("video.scheduledCapacityFrames" to 4), false)
                val saved = log.file.readText().removePrefix(before)
                assertTrue(saved, saved.contains("stage=PIPELINE") && saved.contains("scheduledCapacityFrames=4"))
                assertTrue(saved, saved.contains("stage=POLICY") && saved.contains("failed=true"))
                assertTrue(saved, saved.contains("policyMaxVideoFrames=12") && saved.contains("policyMaxVideoBytes=25165824"))
                assertTrue(saved, saved.contains("policyVideoTargetMs=180") && saved.contains("policyVideoReadinessMs=150"))
                assertTrue(saved, saved.contains("policyVideoMarginMs=30") && saved.contains("policySubmitMarginMs=12"))
                assertTrue(saved.lines().filter { it.contains("stage=POLICY") }.all { it.contains("streamGeneration=3 epoch=7") })
                assertTrue(saved.lines().filter(String::isNotEmpty).all { it.length <= 600 })
                val complete = log.file.readText()
                diagnostics.report(baseline + ("video.scheduledCapacityFrames" to 4), false)
                assertEquals(complete, log.file.readText())
                assertTrue(log.integrityLine(), log.integrityLine().contains("privacyFiltered=0"))
            }
        } finally { DiagnosticLogPolicy.level = previous; directory.deleteRecursively() }
    }

    @Test fun policyDebugSnapshotsAreBoundedAndRejectUnsafeEnumsInvalidNumbersAndExtraFields() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val hostile = policyStats() + mapOf("video.policyTargetReason" to "https://private.test/value", "video.sourceClockState" to "private-state",
            "video.policyVideoReadinessMs" to -1, "video.policyVideoMarginMs" to Double.NaN,
            "video.policyMaxVideoBytes" to Double.POSITIVE_INFINITY, "video.policyInteractionActive" to "secret",
            "video.policyInteractionStarts" to 1.5, "video.policyCredential" to "private-value")
        diagnostics.report(hostile, true)
        val policy = lines.filter { it.contains("stage=POLICY") }.joinToString(" ")
        assertTrue(policy, policy.contains("policyVideoTargetMs=180"))
        for (name in listOf("policyTargetReason", "sourceClockState", "policyVideoReadinessMs", "policyVideoMarginMs",
            "policyMaxVideoBytes", "policyInteractionActive", "policyInteractionStarts", "policyCredential")) {
            assertFalse(policy, policy.contains("$name="))
        }
        assertFalse(policy, policy.contains("private"))
        assertTrue(lines.all { it.length <= 600 })
        lines.clear()
        diagnostics.report(hostile, true)
        assertTrue(lines.isEmpty())
        diagnostics.report(hostile + mapOf("transport.generation" to Double.MAX_VALUE,
            "video.streamGeneration" to Double.MAX_VALUE, "video.epoch" to Double.NaN), true)
        assertFalse(lines.any { it.contains("stage=POLICY") })
        assertTrue(lines.all { it.length <= 600 })
    }

    @Test fun flatTelemetryBooleanNumbersKeepActualInteractionStateWithoutAcceptingArbitraryNumbers() {
        for ((value, expected) in listOf(0 to "false", 1 to "true")) {
            val lines = mutableListOf<String>()
            BrowserTransportDiagnostics(lines::add).report(policyStats() + ("video.policyInteractionActive" to value), true)
            assertTrue(lines.joinToString(" ").contains("policyInteractionActive=$expected"))
        }
        for (value in listOf(-1, 2, 0.5, Double.NaN)) {
            val lines = mutableListOf<String>()
            BrowserTransportDiagnostics(lines::add).report(policyStats() + ("video.policyInteractionActive" to value), true)
            assertFalse(lines.joinToString(" ").contains("policyInteractionActive="))
        }
    }

    @Test fun incompleteScopeCannotRetagPolicyOrPoisonTheNextCompleteSnapshot() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val baseline = policyStats()
        diagnostics.report(baseline, false)
        lines.clear()
        val active = baseline + mapOf("video.playbackProfile" to "carplay-touch", "video.policyInteractionStarts" to 1)
        diagnostics.report(active - "video.epoch", false)
        diagnostics.report(active - "video.streamGeneration", false)
        for (invalid in listOf(-1, 1.5, true, Double.NaN, Double.MAX_VALUE)) {
            diagnostics.report(active + ("video.epoch" to invalid), false)
            diagnostics.report(active + ("video.streamGeneration" to invalid), false)
        }
        assertTrue(lines.isEmpty())
        diagnostics.report(active, false)
        assertTrue(lines.any { it.contains("stage=POLICY") && it.contains("streamGeneration=3 epoch=7") })
        assertFalse(lines.joinToString(" ").contains("epoch=unknown"))
    }

    @Test fun capacityCounterRebasesPerVideoOwnerWithoutReplayingLifetimeDecoderErrors() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val baseline = policyStats() + mapOf("video.scheduledCapacityFrames" to 90, "video.decodeErrors" to 5)
        diagnostics.report(baseline, false)
        lines.clear()
        // A sparse payload cannot claim a drop on the previous owner or poison its baseline.
        diagnostics.report((baseline - "video.epoch") + ("video.scheduledCapacityFrames" to 999), false)
        assertTrue(lines.isEmpty())
        val next = baseline + mapOf("video.epoch" to 8, "video.scheduledCapacityFrames" to 1)
        diagnostics.report(next, false)
        assertTrue(lines.any { it.contains("stage=PIPELINE") && it.contains("scheduledCapacityFrames=1") })
        assertTrue(lines.any { it.contains("stage=POLICY") && it.contains("epoch=8") && it.contains("failed=true") })
        lines.clear()
        diagnostics.report(next, false)
        assertTrue(lines.isEmpty())
        // The decoder counter belongs to the pipeline lifetime and must not be reset per epoch.
        diagnostics.report(next + mapOf("video.epoch" to 9, "video.scheduledCapacityFrames" to 0), false)
        assertTrue(lines.isEmpty())
    }

    @Test fun invalidCapacitySamplesCannotCreateFailuresOrLowerTheValidCounterBaseline() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val baseline = policyStats() + ("video.scheduledCapacityFrames" to 0)
        diagnostics.report(baseline, false)
        lines.clear()
        for (invalid in listOf(-1, 1.5, true, Double.NaN, Double.POSITIVE_INFINITY, 9_007_199_254_740_992.0)) {
            diagnostics.report(baseline + ("video.scheduledCapacityFrames" to invalid), false)
        }
        assertTrue(lines.isEmpty())
        diagnostics.report(baseline + ("video.scheduledCapacityFrames" to 1), false)
        assertTrue(lines.any { it.contains("failed=true") && it.contains("scheduledCapacityFrames=1") })
        lines.clear()
        diagnostics.report(baseline + ("video.scheduledCapacityFrames" to -1), false)
        diagnostics.report(baseline + ("video.scheduledCapacityFrames" to 1), false)
        assertTrue(lines.isEmpty())
    }

    @Test fun estimatorStateEdgesDistinguishFreshObservationsFromOldSelectedMappingWithoutAgeFlood() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val baseline = policyStats()
        diagnostics.report(baseline, false)
        lines.clear()
        // This is the actual estimator result after admissible new probes leave an older selected mapping.
        val estimator = readFixture("tests/web/fixtures/clock-estimator-diagnostics.json").entries.associate { (key, value) -> "video.$key" to value }
        val stale = baseline + estimator
        diagnostics.report(stale, false)
        val policy = lines.joinToString(" ")
        assertTrue(policy, policy.contains("clockEstimatorState=selected-stale"))
        assertTrue(policy, policy.contains("clockEstimatorObservationAgeMs=0") && policy.contains("clockEstimatorSelectedAgeMs=20009"))
        lines.clear()
        diagnostics.report(stale + mapOf("video.clockEstimatorObservationAgeMs" to 500, "video.clockEstimatorSelectedAgeMs" to 18_758), false)
        assertTrue(lines.isEmpty())
    }

    private fun readFixture(path: String): Map<*, *> {
        val file = listOf(java.io.File(path), java.io.File("../$path")).first { it.isFile }
        // Use the actual shared/server JSON reader across its Kotlin internal module boundary.
        val parser = Class.forName("com.shilapi.xcertplay.web.WebJson")
        return parser.getMethod("parse", String::class.java)
            .invoke(parser.getField("INSTANCE").get(null), file.readText()) as Map<*, *>
    }

    private fun policyStats(): Map<String, Any?> = mapOf(
        "transport.generation" to 2, "transport.state" to "connected", "video.streamGeneration" to 3, "video.epoch" to 7,
        "video.playbackProfile" to "carplay", "video.policyVideoReadinessMs" to 150, "video.policyVideoMarginMs" to 30,
        "video.policyVideoTargetMs" to 180, "video.policyVideoPlanFromMs" to 70, "video.policyVideoPlanDurationMs" to 300,
        "video.policyVideoPlanRemainingMs" to 120, "video.policyVideoLeadRemainingMs" to 20, "video.policyHoldRemainingMs" to 90,
        "video.policyInteractionStarts" to 0, "video.policyInteractionReleases" to 0, "video.policyProfileSwitches" to 0,
        "video.policyPlanChanges" to 0, "video.policyInteractionActive" to false, "video.policyTargetReason" to "initial",
        "video.policyMaxDelayMs" to 500, "video.policyMaxVideoFrames" to 12, "video.policyMaxVideoBytes" to 25_165_824,
        "video.policySubmitMarginMs" to 12, "video.sourceClockState" to "fresh", "video.sourceClockAgeMs" to 10,
        "video.sourceClockGeneration" to 1, "video.sourceClockMaxAgeMs" to 15_000, "video.stageClockUncertaintyMs" to 5,
        "video.clockEstimatorState" to "fresh", "video.clockEstimatorObservationAgeMs" to 10, "video.clockEstimatorSelectedAgeMs" to 20,
    )

    @Test fun standardAudioDeadlineSchemaKeepsTheActualRejectionReasonWithoutVideoOrDebugFields() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        // Matches createBrowserAudio.stats -> browserDiagnosticEvents in audio.test.mjs.
        val stats = mapOf("audio.sourceDeadlineState" to "violated", "audio.sourceDeadlineReason" to "source-deadline",
            "audio.sourceDeltaUpperMs" to 305, "audio.sourceDeadlineRejectedFrames" to 128,
            "audio.sourceDeadlineStream" to "carplay-0", "audio.sourceDeadlineEpoch" to 1)
        diagnostics.report(stats, false)
        val fault = lines.single()
        assertTrue(fault, fault.contains("stage=AUDIO") && fault.contains("failed=true reason=source-deadline"))
        assertTrue(fault, fault.contains("sourceDeltaUpperMs=305") && fault.contains("sourceDeadlineRejectedFrames=128"))
        assertTrue(fault, fault.contains("sourceDeadlineStream=carplay-0") && fault.contains("sourceDeadlineEpoch=1"))
        assertTrue(DiagnosticLogPolicy.shouldRecord(fault, DiagnosticLogLevel.STANDARD))
        assertEquals(fault, DiagnosticRedactor.redact(fault))
        diagnostics.report(stats, false)
        assertEquals(1, lines.size)
        diagnostics.report(stats + mapOf("transport.generation" to 7), false)
        assertEquals(1, lines.count { it.contains("stage=AUDIO") && it.contains("reason=source-deadline") })
    }

    @Test fun immediateFaultBypassesHealthyPeriodicLimitsAndKeepsStageAndResourceEvidence() {
        val lines = mutableListOf<String>()
        var now = 1L
        val diagnostics = BrowserTransportDiagnostics(lines::add) { now }
        val healthy = mapOf("transport.transport" to "webrtc-datachannel-v1", "transport.state" to "connected",
            "transport.stage" to "connected", "transport.generation" to 7, "transport.localUdpCandidates" to 2,
            "transport.remoteUdpCandidates" to 1, "transport.queuedBytes" to 512,
            "transport.reassemblyErrors" to 0, "video.playbackProfile" to "carplay-touch", "video.decodedQueueBytes" to 12_000_000)
        diagnostics.report(healthy, false)
        assertTrue(lines.any { it.contains("stage=CANDIDATES") && it.contains("localUdpCandidates=2") })
        assertFalse(lines.any { it.contains("stage=FLOW") })
        lines.clear()
        now++
        val failed = healthy + mapOf("transport.state" to "failed", "transport.reason" to "fragment-order", "transport.reassemblyErrors" to 1)
        diagnostics.report(failed, false)
        assertTrue(lines.any { it.contains("failed=true") && it.contains("reason=fragment-order") })
        assertTrue(lines.any { it.contains("stage=FLOW") && it.contains("queuedBytes=512") })
        assertTrue(lines.any { it.contains("stage=PIPELINE") && it.contains("playbackProfile=carplay-touch") })
        assertTrue(lines.all { it.length <= 600 && DiagnosticLogPolicy.shouldRecord(it, DiagnosticLogLevel.STANDARD) })
        val count = lines.size
        diagnostics.report(failed, false)
        assertEquals(count, lines.size)
        diagnostics.report(healthy, false)
        lines.clear()
        diagnostics.report(failed, false)
        assertTrue(lines.any { it.contains("failed=true") })
    }

    @Test fun missingCountersDoNotCreateRepeatedFaultsAndNewGenerationsHaveIndependentCounters() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val stats = mapOf("transport.generation" to 2, "transport.state" to "connected", "transport.reassemblyErrors" to 1)
        diagnostics.report(stats, false)
        diagnostics.report(mapOf("transport.generation" to 2, "transport.state" to "connected"), false)
        lines.clear()
        diagnostics.report(stats, false)
        assertTrue(lines.isEmpty())
        diagnostics.report(stats + mapOf("transport.generation" to 3), false)
        assertTrue(lines.any { it.contains("generation=3 failed=true") })
    }

    @Test fun debugIsBoundedAndRejectsArbitraryFieldsUnsafeTextAndNonfiniteNumbers() {
        val lines = mutableListOf<String>()
        var now = 1L
        val diagnostics = BrowserTransportDiagnostics(lines::add) { now }
        val stats = mapOf("transport.state" to "connected", "transport.stage" to "connected", "transport.generation" to 9,
            "transport.sdp" to "private-sdp", "transport.candidate" to "private-candidate", "transport.reason" to "private password=secret",
            "transport.queuedBytes" to "private-value", "transport.rttMs" to Double.NaN,
            "video.playbackProfile" to "airplay-mirror", "video.decodedQueueBytes" to 10_000_000)
        diagnostics.report(stats, true)
        assertTrue(lines.any { it.contains("stage=PIPELINE") })
        assertFalse(lines.joinToString().contains("private"))
        assertFalse(lines.joinToString().contains("NaN"))
        assertTrue(lines.all { it.length <= 600 })
        lines.clear()
        diagnostics.report(stats, true)
        assertTrue(lines.isEmpty())
        now += 10_000
        diagnostics.report(stats, true)
        assertTrue(lines.isNotEmpty())
    }
}
