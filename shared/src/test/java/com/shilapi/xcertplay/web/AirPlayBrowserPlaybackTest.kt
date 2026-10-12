package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayBrowserPlaybackTest {
    private val state = AirPlayBrowserPlayback.State(100.0, 5.0, true, true, false, true)

    @Test fun staleCommandsAndStaleCloseCannotAffectANewItem() {
        val first = AirPlayBrowserPlayback.register({ state }) { _, _ -> fail("stale item controlled") }
        val oldId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        val commands = mutableListOf<String>()
        val second = AirPlayBrowserPlayback.register({ state }) { action, _ -> commands.add(action) }
        try {
            first.close()
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            assertFalse(AirPlayBrowserPlayback.command(oldId, "stop"))
            assertTrue(AirPlayBrowserPlayback.command(id, "pause"))
            assertEquals(listOf("pause"), commands)
        } finally { second.close(); first.close() }
        assertNull(AirPlayBrowserPlayback.snapshot())
    }

    @Test fun seekRejectsInvalidValuesAndNonSeekableMedia() {
        var current = state
        val binding = AirPlayBrowserPlayback.register({ current }) { _, _ -> }
        try {
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            listOf(null, Double.NaN, Double.POSITIVE_INFINITY, -1.0, 101.0).forEach {
                assertFalse(AirPlayBrowserPlayback.command(id, "seek", it))
            }
            assertTrue(AirPlayBrowserPlayback.command(id, "seek", 100.0))
            current = state.copy(seekable = false)
            assertFalse(AirPlayBrowserPlayback.command(id, "seek", 10.0))
            assertFalse(AirPlayBrowserPlayback.command(id, "pause", 1.0))
        } finally { binding.close() }
    }
}
