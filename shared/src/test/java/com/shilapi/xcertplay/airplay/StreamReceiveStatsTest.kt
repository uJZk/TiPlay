package com.shilapi.xcertplay.airplay

import org.junit.Assert.*
import org.junit.Test

class StreamReceiveStatsTest {
    @Test fun linksSequenceGapsToTheSameLongReadAndResetsOnlyWindowCounters() {
        var clock = 1L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("audio", output::add) { clock }
        fun packet(sequence: Int, readMs: Long) {
            stats.reading()
            clock += readMs * 1_000_000L
            stats.received(100, sequence)
            stats.processed()
        }
        packet(1, 10)
        packet(4, 300) // Two missing packets follow this long socket wait.
        packet(7, 10) // Two more missing packets follow a short socket wait.
        packet(8, 400) // A long read alone does not imply packet loss.
        stats.flush(ended = true)
        assertEquals(1, output.size)
        assertTrue(output.single().contains("windowMs=720 readsOver250Ms=2 seqGapAfterReadOver250Ms=1 seqMissingAfterReadOver250Ms=2"))
        packet(9, 10)
        stats.flush(ended = true)
        assertTrue(output.last().contains("windowMs=10 readsOver250Ms=0 seqGapAfterReadOver250Ms=0 seqMissingAfterReadOver250Ms=0"))
        assertTrue(output.last().contains("seqForwardGaps=0"))
    }

    @Test fun separatesSocketWaitFromLocalProcessingAndTracksSequenceWrap() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("audio", output::add) { clock }
        fun packet(sequence: Int) {
            stats.reading()
            clock += 400_000_000L
            stats.received(100, sequence)
            clock += 200_000L
            stats.processed()
        }
        packet(65535)
        packet(0)
        packet(3) // two missing, then one late packet arrives
        packet(2)
        packet(4)
        stats.flush(ended = true)
        assertEquals(1, output.size)
        assertTrue(output.single().contains("readMaxMs=400 processMaxUs=200 seqForwardGaps=2 lateOrDuplicate=1"))
        assertTrue(output.single().contains("packets=5 bytes=500"))
    }

    @Test fun reportResetsWindowButRetainsSequenceContinuity() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("audio", output::add) { clock }
        stats.reading()
        clock = 5_000_000_000L
        stats.received(10, 1)
        stats.processed()
        stats.reading()
        stats.received(20, 3)
        stats.processed()
        stats.flush(true)
        assertEquals(2, output.size)
        assertTrue(output.last().contains("packets=1 bytes=20 readMaxMs=0"))
        assertTrue(output.last().contains("seqForwardGaps=1"))
    }

    @Test fun decryptTimingIsReportedOnlyWhenRecordedAndThenReset() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        stats.received(1_000)
        stats.decrypted(2_000_000, 500_000)
        stats.decrypted(500_000, 250_000)
        stats.processed()
        clock = 5_000_000_000L
        stats.flush()
        assertTrue(output.last { it.startsWith("Receive:") }.endsWith(" decryptAvgUs=1250 decryptMaxUs=2000 decryptMBps=300"))
        clock = 10_000_000_000L
        stats.flush()
        assertTrue(!output.last().contains("decrypt"))
    }

    @Test fun videoFramesExcludeConfigAndKeepalivesAndReportActualLowFps() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        // Config/keepalive messages remain ordinary received packets, not video frames.
        repeat(8) { stats.received(128); stats.processed() }
        clock = 1_000_000_000L
        stats.received(1000); stats.videoFrame(3_900_000_000_000_000_000L, clock); stats.processed()
        clock = 3_500_000_000L
        stats.received(1000); stats.videoFrame(3_900_000_002_500_000_000L, clock); stats.processed()
        assertTrue(output.isEmpty()) // No per-frame or per-packet source log.
        clock = 5_000_000_000L
        stats.flush()
        val source = sourceFields(output.last { it.startsWith("Video source: ") })
        assertTrue(output.first().contains("packets=10 bytes=3024"))
        assertEquals("2", source["frames"])
        assertEquals("0.4", source["fps"])
        assertEquals("1", source["firstFrame"])
        assertEquals("2", source["lastFrame"])
        assertEquals("1", source["ptsPositiveSteps"])
        assertEquals("2500000", source["ptsMeanUs"])
        assertEquals("2500", source["arrivalMaxMs"])
        assertTrue(output.last().length < 600)
    }

    @Test fun videoPtsStepsRepeatAndRollbackStaySeparateFromArrivalIntervals() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        val origin = 3_900_000_000_000_000_000L // NTP-derived domain deliberately unlike monotonic arrival.
        val ptsOffsets = longArrayOf(0, 16_666_666, 83_333_330, 83_333_330, 74_999_997, 91_666_663)
        val arrivals = longArrayOf(0, 20, 70, 320, 330, 360)
        ptsOffsets.indices.forEach { index ->
            clock = arrivals[index] * 1_000_000L
            stats.videoFrame(origin + ptsOffsets[index], clock)
        }
        clock = 5_000_000_000L
        stats.flush(true)
        val source = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("6", source["frames"])
        assertEquals("3", source["ptsPositiveSteps"])
        assertEquals("1", source["ptsRepeat"])
        assertEquals("1", source["ptsBackwards"])
        assertEquals("16666", source["ptsMinUs"])
        assertEquals("33333", source["ptsMeanUs"])
        assertEquals("66666", source["ptsMaxUs"])
        assertEquals("5", source["arrivalSteps"])
        assertEquals("250", source["arrivalMaxMs"])
        assertEquals("2", source["arrivalOver50Ms"])
        assertEquals("1", source["arrivalOver250Ms"])
        assertFalse(output.last().contains(origin.toString()))
    }

    @Test fun missingVideoPtsBreaksAdjacencyWithoutInventingAClockOrigin() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        listOf(1_000_000_000L, 0L, 2_000_000_000L, 2_020_000_000L).forEach { sender ->
            stats.videoFrame(sender, clock)
            clock += 20_000_000L
        }
        stats.flush(true)
        val source = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("1", source["ptsMissing"])
        assertEquals("1", source["ptsPositiveSteps"])
        assertEquals("20000", source["ptsMinUs"])
        assertEquals("20000", source["ptsMaxUs"])
        assertEquals("3", source["arrivalSteps"])
    }

    @Test fun absentVideoSourceTimeAndFirstFrameIntervalsStayUnknown() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        stats.videoFrame(0L, clock)
        stats.flush(true)
        val first = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("unknown", first["fps"])
        assertEquals("unknown", first["arrivalMaxMs"])
        assertEquals("unknown", first["ptsMeanUs"])
        clock = 5_000_000_000L
        stats.videoFrame(0L, clock)
        stats.flush(true)
        val next = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("1", next["ptsMissing"])
        assertEquals("0", next["ptsPositiveSteps"])
        for (key in listOf("ptsMinUs", "ptsMeanUs", "ptsMaxUs")) assertEquals("unknown", next[key])
        assertEquals("5000", next["arrivalMaxMs"])
    }

    @Test fun videoWindowBoundaryRetainsAdjacentPtsAndArrivalsButNotWindowCounters() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        val origin = 3_900_000_000_000_000_000L
        clock = 4_980_000_000L; stats.videoFrame(origin, clock)
        clock = 5_000_000_000L; stats.flush()
        val first = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("1", first["window"])
        assertEquals("1", first["frames"])
        assertEquals("0", first["arrivalSteps"])
        clock = 5_020_000_000L; stats.videoFrame(origin + 40_000_000L, clock)
        clock = 5_300_000_000L; stats.videoFrame(origin + 320_000_000L, clock)
        clock = 5_500_000_000L; stats.flush(true)
        val last = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals(first["stream"], last["stream"])
        assertEquals("2", last["window"])
        assertEquals("2", last["firstFrame"])
        assertEquals("3", last["lastFrame"])
        assertEquals("2", last["frames"])
        assertEquals("4.0", last["fps"])
        assertEquals("2", last["ptsPositiveSteps"])
        assertEquals("40000", last["ptsMinUs"])
        assertEquals("280000", last["ptsMaxUs"])
        assertEquals("2", last["arrivalSteps"])
        assertEquals("280", last["arrivalMaxMs"])
        assertEquals("true", last["ended"])
        stats.flush(true)
        val emptyEnd = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("3", emptyEnd["window"])
        assertEquals("0", emptyEnd["frames"])
        assertEquals("unknown", emptyEnd["firstFrame"])
        assertEquals("unknown", emptyEnd["ptsMeanUs"])
    }

    @Test fun newVideoStreamsHaveDistinctIdentityAndNoCrossStreamIntervals() {
        var clock = 0L
        val output = mutableListOf<String>()
        val first = StreamReceiveStats("video", output::add) { clock }
        first.videoFrame(4_000_000_000_000_000_000L, clock)
        clock = 10_000_000L; first.flush(true)
        val previous = sourceFields(output.last { it.startsWith("Video source: ") })
        val next = StreamReceiveStats("video", output::add) { clock }
        clock += 50_000_000L
        next.videoFrame(1L, clock); next.flush(true)
        val current = sourceFields(output.last { it.startsWith("Video source: ") })
        assertNotEquals(previous["stream"], current["stream"])
        assertEquals("1", current["window"])
        assertEquals("1", current["firstFrame"])
        assertEquals("0", current["ptsBackwards"])
        assertEquals("0", current["arrivalSteps"])
        assertEquals("unknown", current["ptsMaxUs"])
    }

    @Test fun emptyVideoWindowReportsZeroFpsAndNoMeasuredIntervals() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        repeat(20) { stats.received(128) }
        clock = 5_000_000_000L; stats.flush()
        val source = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("0", source["frames"])
        assertEquals("0.0", source["fps"])
        assertEquals("unknown", source["firstFrame"])
        assertEquals("unknown", source["arrivalMaxMs"])
        assertEquals("unknown", source["ptsMinUs"])
        assertTrue(output.last().length < 600)
    }

    @Test fun videoPtsWrapLikeRollbackIsObservedWithoutInventingMissingFrames() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        for (pts in listOf(4_294_967_295_900_000_000L, 100_000_000L, 116_666_666L)) {
            stats.videoFrame(pts, clock)
            clock += 20_000_000L
        }
        stats.flush(true)
        val source = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals("3", source["frames"])
        assertEquals("1", source["ptsBackwards"])
        assertEquals("1", source["ptsPositiveSteps"])
        assertEquals("16666", source["ptsMaxUs"])
        assertFalse(output.last().contains("missingFrames"))
    }

    @Test fun sourceAndArrivalMaximaKeepTheirOwnFramePairInsteadOfBeingMispaired() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        val pts = longArrayOf(1_000_000_000L, 2_000_000_000L, 2_016_000_000L)
        val arrivals = longArrayOf(1_000_000_000L, 1_016_000_000L, 2_016_000_000L)
        pts.indices.forEach { index -> stats.videoFrame(pts[index], arrivals[index]) }
        clock = 5_000_000_000L; stats.flush(true)
        val gap = gapFields(output.last())
        val summary = sourceFields(output.last { it.startsWith("Video source: ") })
        assertEquals(summary["stream"], gap["stream"])
        assertEquals(summary["window"], gap["window"])
        assertEquals("1", gap["maxPtsFrom"]); assertEquals("2", gap["maxPtsTo"])
        assertEquals("1000000", gap["maxPtsGapUs"])
        assertEquals("16000", gap["maxPtsArrivalGapUs"])
        assertEquals("2", gap["maxArrivalFrom"]); assertEquals("3", gap["maxArrivalTo"])
        assertEquals("16000", gap["maxArrivalPtsGapUs"])
        assertEquals("1000000", gap["maxArrivalGapUs"])
    }

    @Test fun arrivalMaximumRetainsUnknownBackwardAndRepeatedPtsStates() {
        for ((pts, expectedState, expectedGap) in listOf(
            Triple(0L, "unknown", "unknown"), Triple(500_000_000L, "backwards", "-500000"),
            Triple(1_000_000_000L, "repeat", "0"))) {
            var clock = 0L
            val output = mutableListOf<String>()
            val stats = StreamReceiveStats("video", output::add) { clock }
            stats.videoFrame(1_000_000_000L, clock)
            clock = 1_000_000_000L; stats.videoFrame(pts, clock); stats.flush(true)
            val gap = gapFields(output.last())
            assertEquals("1", gap["maxArrivalFrom"]); assertEquals("2", gap["maxArrivalTo"])
            assertEquals(expectedState, gap["maxArrivalPtsState"])
            assertEquals(expectedGap, gap["maxArrivalPtsGapUs"])
            assertEquals("1000000", gap["maxArrivalGapUs"])
            assertEquals("unknown", gap["maxPtsGapUs"])
        }
    }

    @Test fun sourceGapPairsRemainAdjacentAcrossWindowsAndResetWindowMaxima() {
        var clock = 0L
        val output = mutableListOf<String>()
        val stats = StreamReceiveStats("video", output::add) { clock }
        clock = 4_980_000_000L; stats.videoFrame(1_000_000_000L, clock)
        clock = 5_000_000_000L; stats.flush()
        val first = gapFields(output.last())
        assertEquals("unknown", first["maxArrivalFrom"])
        assertEquals("unknown", first["maxArrivalGapUs"])
        clock = 5_020_000_000L; stats.videoFrame(1_020_000_000L, clock)
        clock = 5_100_000_000L; stats.flush(true)
        val next = gapFields(output.last())
        assertEquals(first["stream"], next["stream"])
        assertEquals("2", next["window"])
        assertEquals("1", next["maxPtsFrom"]); assertEquals("2", next["maxPtsTo"])
        assertEquals("20000", next["maxPtsGapUs"])
        assertEquals("40000", next["maxPtsArrivalGapUs"])
        assertEquals("20000", next["maxArrivalPtsGapUs"])
        assertEquals("40000", next["maxArrivalGapUs"])
        clock = 5_200_000_000L; stats.flush(true)
        val empty = gapFields(output.last())
        assertEquals("3", empty["window"])
        assertEquals("unknown", empty["maxPtsFrom"])
        assertEquals("unknown", empty["maxArrivalFrom"])
    }

    private fun gapFields(line: String): Map<String, String> {
        assertTrue(line.startsWith("Video source gap: "))
        assertTrue("Paired source summary must remain short", line.length < 600)
        return line.removePrefix("Video source gap: ").split(' ').associate { field ->
            val parts = field.split('=', limit = 2)
            parts[0] to parts[1]
        }
    }

    private fun sourceFields(line: String): Map<String, String> {
        assertTrue(line.startsWith("Video source: "))
        assertTrue("Source summary must not be truncated by the session log", line.length < 600)
        return line.removePrefix("Video source: ").split(' ').associate { field ->
            val parts = field.split('=', limit = 2)
            parts[0] to parts[1]
        }
    }

}
