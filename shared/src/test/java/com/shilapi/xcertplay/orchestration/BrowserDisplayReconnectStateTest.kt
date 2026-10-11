package com.shilapi.xcertplay.orchestration

import com.shilapi.xcertplay.airplay.*
import java.net.Socket
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BrowserDisplayReconnectStateTest {
    @Test fun onlyAReplacementFrameCompletesPendingReconnectAndCancellationAllowsRetry() {
        val state = BrowserDisplayReconnect()
        val source = session()
        val replacement = session()
        try {
            assertTrue(state.begin(source, null))
            assertFalse(state.begin(source, null))
            state.completed(source)
            assertTrue(state.pending)
            state.completed(replacement)
            assertFalse(state.pending)
            assertTrue(state.begin(replacement, null))
            state.cancelPending()
            assertFalse(state.pending)
            assertTrue(state.begin(replacement, null))
        } finally { source.close(); replacement.close() }
    }

    private fun session() = AirPlaySession(Socket(),
        AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480)),
        AirPlayIdentity(ByteArray(32), ByteArray(32), "test"), PairingStore(), null,
        object : AirPlaySessionListener {}, object : AirPlayMediaHandler {})
}
