package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class BrowserVideoDiagnosticsSchemaTest {
    private fun sample() = linkedMapOf<String, Any?>("schema" to 1, "pageVersion" to "v71", "sample" to 1, "streamGeneration" to 2, "epoch" to 3)

    @Test fun currentRtpReceiverEvidenceKeepsMissingCountersDistinctFromZeroAndRejectsIdentities() {
        val input = sample() + mapOf("transport.rtpVideo.state" to "selected", "transport.rtpVideo.generation" to 2,
            "transport.rtpVideo.sampleAgeMs" to 125.5, "transport.rtpVideo.packetsLost" to -1,
            "transport.rtpVideo.framesReceived" to 100, "transport.rtpVideo.framesDecoded" to 80,
            "transport.rtpVideo.packetsDiscarded" to 2, "transport.rtpVideo.framesAssembledFromMultiplePackets" to 90,
            "transport.rtpVideo.totalAssemblyTimeMs" to 500, "transport.rtpVideo.totalProcessingDelayMs" to 800,
            "transport.rtpVideo.totalInterFrameDelayMs" to 1000,
            "transport.rtpVideo.framesDropped" to 20, "transport.rtpVideo.jitterBufferDelayMs" to 900,
            "transport.rtpVideo.jitterBufferEmittedCount" to 80, "transport.rtpVideo.powerEfficientDecoder" to false)
        assertEquals(input, BrowserVideoDiagnosticsSchema.parse(input))
        assertFalse(input.containsKey("transport.rtpVideo.nackCount"))
        for (bad in listOf("trackIdentifier" to "private-track", "decoderImplementation" to "private-decoder",
            "sampleAgeMs" to -1, "generation" to 1.5, "framesReceived" to -1, "state" to "private-state",
            "powerEfficientDecoder" to 1))
            assertNull(bad.first, BrowserVideoDiagnosticsSchema.parse(sample() + ("transport.rtpVideo.${bad.first}" to bad.second)))
    }

    @Test fun decoderSampleAgeRareSupplyGapAndOutstandingOutputHaveNonnegativeBounds() {
        val input = sample() + mapOf("raw.decoderStatsAgeMs" to 250.5,
            "raw.readFrameIntervalMsMax" to 190, "raw.decodeOldestInFlightMs" to 284)
        assertEquals(input, BrowserVideoDiagnosticsSchema.parse(input))
        for (key in listOf("raw.decoderStatsAgeMs", "raw.readFrameIntervalMsMax", "raw.decodeOldestInFlightMs"))
            assertNull(key, BrowserVideoDiagnosticsSchema.parse(sample() + (key to -1)))
        assertNull(BrowserVideoDiagnosticsSchema.parse(sample() + ("raw.decoderStatsSampledAtMs" to 10000)))
    }

    @Test fun decoderResourceAndIntentionalDecodeOnlyEvidenceRemainDistinctFromDropTotals() {
        val input = sample() + mapOf("raw.decodeStalls" to 2, "interval.decodeStalls" to 1,
            "raw.decodeBackpressureWaits" to 3, "interval.decodeBackpressureWaits" to 2,
            "raw.decoderAbortedFrames" to 4, "interval.decoderAbortedFrames" to 3,
            "raw.decodeOnlyFrames" to 5, "interval.decodeOnlyFrames" to 4,
            "raw.decodedResourceDroppedFrames" to 6, "interval.decodedResourceDroppedFrames" to 5,
            "raw.untimedScheduledFrames" to 7, "interval.untimedScheduledFrames" to 6,
            "raw.decodeBackpressureMs" to 18.5, "raw.decodedQueueFrames" to 3,
            "raw.decodedQueueBytes" to 12_000_000, "raw.decodeInFlightFrames" to 2,
            "raw.decodeInFlightBytes" to 120_000, "raw.playbackProfile" to "carplay-touch")
        assertEquals(input, BrowserVideoDiagnosticsSchema.parse(input))
        assertFalse(input.containsKey("raw.droppedFrames"))
        assertNull(BrowserVideoDiagnosticsSchema.parse(sample() + ("raw.playbackProfile" to "unbounded-private-profile")))
    }

    @Test fun actualBrowserSelectorFixtureKeepsEverySchemaFieldAndSurvivesValidationWithoutTruncation() {
        val fixture = javaClass.getResourceAsStream("/Browser-video-diagnostics-v1.json")!!.bufferedReader().use { it.readText() }
        val event = WebJson.parse(fixture) as Map<*, *>
        val input = event["v"] as Map<*, *>
        val valid = requireNotNull(BrowserVideoDiagnosticsSchema.parse(input))
        assertTrue("Historical captures remain an accepted subset", BrowserVideoDiagnosticsSchema.fields.containsAll(valid.keys))
        assertEquals(input, valid)
        assertTrue(WebJson.write(valid).toByteArray(Charsets.UTF_8).size <= 16 * 1024)
    }

    @Test fun actualLivePolicySelectorSharesTheExactAllowlistAndRetainsPrioritiesWithoutIncreasingTheWireBudget() {
        val fixture = javaClass.getResourceAsStream("/Browser-live-policy-diagnostics-v1.json")!!.bufferedReader().use { it.readText() }
        val event = WebJson.parse(fixture) as Map<*, *>
        val debug = event["debug"] as Map<*, *>
        val input = debug["v"] as Map<*, *>
        val valid = requireNotNull(BrowserVideoDiagnosticsSchema.parse(input))
        assertEquals(BrowserVideoDiagnosticsSchema.fields, (event["schemaFields"] as List<*>).toSet())
        assertEquals(256, valid.size); assertEquals(5.0, (valid["omittedFields"] as Number).toDouble(), 0.0)
        assertEquals(input, valid)
        for (key in listOf("raw.policyVideoTargetMs", "raw.policyVideoReadinessMs", "raw.policyVideoMarginMs",
            "raw.policyInteractionStarts", "raw.policyProfileSwitches", "raw.policyVideoPlanDurationMs",
            "raw.sourceClockState", "raw.sourceClockAgeMs", "raw.clockEstimatorState", "raw.clockEstimatorSelectedAgeMs",
            "raw.decoderStatsAgeMs", "raw.readFrameIntervalMsMax", "raw.decodeOldestInFlightMs"))
            assertTrue(key, valid.containsKey(key))
        assertTrue(WebJson.write(valid).toByteArray(Charsets.UTF_8).size <= BrowserVideoDiagnosticsSchema.MAX_BYTES)
        for (bad in listOf("raw.policyVideoTargetMs" to -1, "raw.policyInteractionStarts" to 1.5,
            "raw.policyInteractionActive" to 1, "raw.sourceClockState" to "private-state",
            "raw.clockEstimatorState" to "private-state", "raw.clockEstimatorSelectedAgeMs" to -1))
            assertNull(bad.first, BrowserVideoDiagnosticsSchema.parse(sample() + bad))
    }

    @Test fun unknownSchemaCredentialsNestedOrMistypedFieldsCannotEnterTheJournal() {
        val invalid = listOf(
            sample() + ("schema" to 2), sample() + ("code" to "1234"), sample() + ("location" to 1),
            sample() + ("raw.readFrames" to "169.254.111.111"), sample() + ("raw.readFrames" to true),
            sample() + ("raw.readFrames" to mapOf("secret" to "hidden")),
            sample() + ("raw.touchCatchUpActive" to 1), sample() + ("raw.codec" to "https://private.test"),
            sample() + ("sender.iceConnectionState" to "private-message"),
            sample() + ("raw.currentDelta" to Double.NaN), sample() + ("raw.currentDelta" to Double.POSITIVE_INFINITY),
            sample() + ("sample" to 1.5), sample() + ("sample" to 0), sample() + ("epoch" to -1),
            sample() + ("pageVersion" to "v".repeat(20_000)),
            sample() + (0..256).associate { "unknown$it" to it },
        )
        invalid.forEachIndexed { index, values -> assertNull("Invalid report $index must be rejected intact", BrowserVideoDiagnosticsSchema.parse(values)) }
        val signed = sample() + mapOf("raw.currentDelta" to -123.5, "raw.touchCatchUpActive" to false, "raw.decodeMsP95" to null)
        assertEquals(signed, BrowserVideoDiagnosticsSchema.parse(signed))
    }
}
