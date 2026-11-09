package com.shilapi.xcertplay

import org.junit.Assert.assertEquals
import org.junit.Test

class BrowserCarPlayRetryTest {
    @Test fun bluetoothArrivalGetsABoundedBurstAndRepeatedAclEventsDoNotResetIt() {
        val retry = BrowserCarPlayRetry()
        assertEquals(16_000L, retry.nextDelayMillis())
        retry.bluetoothConnected()
        for (delay in listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 16_000L)) {
            retry.bluetoothConnected()
            assertEquals(delay, retry.nextDelayMillis())
        }
    }

    @Test fun aLostWorkingSessionGetsOneBurstWithoutAnotherBluetoothArrival() {
        val retry = BrowserCarPlayRetry()
        retry.sessionConnected()
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 16_000L),
            List(6) { retry.nextDelayMillis() })
        // Failed attempts and duplicate ACL events cannot replenish the burst. A
        // new working session can, even after the original retry budget was spent.
        retry.bluetoothConnected()
        assertEquals(16_000L, retry.nextDelayMillis())
        retry.sessionConnected()
        assertEquals(1_000L, retry.nextDelayMillis())
    }
}
