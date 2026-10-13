package com.shilapi.xcertplay.media

import org.junit.Assert.assertEquals
import org.junit.Test

class BluetoothMicrophoneRecoveryTest {
    @Test fun emptyReadsWaitAndRecoveryStopsAfterThreeAttempts() {
        var time = 0L
        val recovery = BluetoothMicrophoneRecovery { time }
        repeat(3) { attempt ->
            time += 999_000_000L
            assertEquals(BluetoothMicrophoneRecovery.Action.WAIT, recovery.read(0))
            time += 1_000_000L
            assertEquals(BluetoothMicrophoneRecovery.Action.RESTART, recovery.read(0))
            assertEquals(attempt + 1, recovery.restarts)
        }
        time += 1_000_000_000L
        assertEquals(BluetoothMicrophoneRecovery.Action.FAIL, recovery.read(0))
    }

    @Test fun pcmResetsTheNoDataDeadlineAndReadFailuresRecoverImmediately() {
        var time = 0L
        val recovery = BluetoothMicrophoneRecovery { time }
        time = 900_000_000L
        assertEquals(BluetoothMicrophoneRecovery.Action.CONTINUE, recovery.read(320))
        time = 1_000_000_000L
        assertEquals(BluetoothMicrophoneRecovery.Action.WAIT, recovery.read(0))
        repeat(3) { assertEquals(BluetoothMicrophoneRecovery.Action.RESTART, recovery.read(-3)) }
        assertEquals(BluetoothMicrophoneRecovery.Action.FAIL, recovery.read(-3))
    }
}
