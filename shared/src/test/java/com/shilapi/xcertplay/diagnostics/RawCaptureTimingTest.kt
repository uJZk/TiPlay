package com.shilapi.xcertplay.diagnostics

import org.junit.Assert.*
import org.junit.Test

class RawCaptureTimingTest {
    @Test fun separateWaitAndAppendTotalsRetainTheirOwnHighWaterSources() {
        val timing = RawCaptureTiming()
        timing.completed("iphone/private-peer/in", 12_000_000, 2_000_000)
        timing.completed("browser/private-peer/out", 1_000_000, 25_000_000)
        timing.completed("arbitrary-private-value/secret", 2_000_000, 3_000_000)
        val state = timing.snapshot()
        assertEquals(3L, state["completedCalls"])
        assertEquals(15.0, state["lockWaitTotalMs"])
        assertEquals(30.0, state["appendTotalMs"])
        assertEquals(12.0, state["lockWaitMaxMs"])
        assertEquals(25.0, state["appendMaxMs"])
        assertEquals("iphone", state["lockWaitMaxSource"])
        assertEquals("browser", state["appendMaxSource"])
        assertFalse(state.toString().contains("private"))
        assertFalse(state.toString().contains("secret"))
    }

    @Test fun unknownSourcesAreBoundedAndInvalidDurationsCannotReduceTotals() {
        val timing = RawCaptureTiming()
        timing.completed("not-an-allowed-source/anything", 500, 1000)
        timing.completed("iphone/anything", -100, -1000)
        val state = timing.snapshot()
        assertEquals(2L, state["completedCalls"])
        assertEquals(0.0005, state["lockWaitTotalMs"])
        assertEquals(0.001, state["appendTotalMs"])
        assertEquals("other", state["lockWaitMaxSource"])
        assertEquals("other", state["appendMaxSource"])
        assertEquals(0L, RawCaptureTiming().snapshot()["completedCalls"])
    }
}
