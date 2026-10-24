package com.shilapi.xcertplay

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class AirPlayReceiverStateTest {
    @Test fun repeatedFailuresHaveDistinctRevisionsWithoutChangingThePhoneState() {
        TeslaBrowserLink.resetForTest()
        try {
            AirPlayReceiverService.publish("playback-failed")
            val oldFailure = AirPlayReceiverService.stateSnapshot()
            AirPlayReceiverService.publish("playback-failed")
            val newFailure = AirPlayReceiverService.stateSnapshot()
            val browser = TeslaBrowserLink.status().receivers["airplay"] as Map<*, *>
            assertEquals("playback-failed", AirPlayReceiverService.state)
            assertEquals(oldFailure.revision + 1, newFailure.revision)
            assertEquals(newFailure.state, browser["state"])
            assertEquals(newFailure.revision, browser["revision"])

            AirPlayReceiverService.publish("playing")
            assertEquals("playback-failed", oldFailure.state)
            assertEquals("playback-failed", newFailure.state)
            assertEquals("playing", AirPlayReceiverService.state)
        } finally { AirPlayReceiverService.publish("stopped"); TeslaBrowserLink.resetForTest() }
    }

    @Test fun concurrentStatusReadsNeverMixAStateWithAnotherEventsRevision() {
        TeslaBrowserLink.resetForTest()
        val before = AirPlayReceiverService.stateSnapshot().revision
        val start = CountDownLatch(1)
        val first = CountDownLatch(1)
        val writer = Thread {
            check(start.await(5, TimeUnit.SECONDS))
            for (event in 1..5_000) {
                AirPlayReceiverService.publish("event-$event")
                first.countDown()
            }
        }
        writer.start()
        try {
            start.countDown()
            assertTrue(first.await(5, TimeUnit.SECONDS))
            repeat(5_000) {
                val browser = TeslaBrowserLink.status().receivers["airplay"] as Map<*, *>
                val event = (browser["revision"] as Number).toLong() - before
                assertEquals("event-$event", browser["state"])
            }
            writer.join(5_000)
            assertFalse(writer.isAlive)
            assertEquals(before + 5_000, AirPlayReceiverService.stateSnapshot().revision)
        } finally {
            writer.join(5_000)
            AirPlayReceiverService.publish("stopped")
            TeslaBrowserLink.resetForTest()
        }
    }
}
