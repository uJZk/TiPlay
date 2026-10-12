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
        retry.sessionConnected()
        assertEquals(16_000L, retry.nextDelayMillis())
        retry.bluetoothConnected()
        assertEquals(1_000L, retry.nextDelayMillis())
    }
}
