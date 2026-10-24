package com.shilapi.xcertplay.airplay

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test

class VideoPlaybackAvailabilityTest {
    @Test fun sameValueReentryQueuesWithoutRecursing() {
        val sent = mutableListOf<Boolean>()
        lateinit var availability: VideoPlaybackAvailability
        availability = VideoPlaybackAvailability {
            sent += it
            assertEquals(VideoPlaybackDelivery.QUEUED, availability.setDesired(it))
            true
        }
        ready(availability)
        assertEquals(VideoPlaybackDelivery.SENT, availability.setDesired(true))
        assertEquals(listOf(true), sent)
        assertEquals(VideoPlaybackDelivery.UNCHANGED, availability.setDesired(true))
    }

    @Test fun changedDesireDuringDeliveryIsDrainedAfterTheCurrentWrite() {
        val sent = mutableListOf<Boolean>()
        lateinit var availability: VideoPlaybackAvailability
        availability = VideoPlaybackAvailability {
            sent += it
            if (it) assertEquals(VideoPlaybackDelivery.QUEUED, availability.setDesired(false))
            true
        }
        ready(availability)
        assertEquals(VideoPlaybackDelivery.SENT, availability.setDesired(true))
        assertEquals(listOf(true, false), sent)
        assertEquals(VideoPlaybackDelivery.UNCHANGED, availability.setDesired(false))
    }

    @Test fun retiredChannelCannotCommitItsCompletedWrite() {
        val sent = mutableListOf<Boolean>()
        lateinit var availability: VideoPlaybackAvailability
        availability = VideoPlaybackAvailability {
            sent += it
            if (sent.size == 1) availability.setEventReady(false)
            true
        }
        ready(availability)
        assertEquals(VideoPlaybackDelivery.QUEUED, availability.setDesired(true))
        assertEquals(VideoPlaybackDelivery.SENT, availability.setEventReady(true))
        assertEquals(listOf(true, true), sent)
    }

    @Test fun replacementDuringAWriteResendsRegardlessOfItsOldResult() {
        for (oldResult in listOf(false, true)) {
            val sent = mutableListOf<Boolean>()
            lateinit var availability: VideoPlaybackAvailability
            availability = VideoPlaybackAvailability {
                sent += it
                if (sent.size == 1) {
                    availability.setEventReady(false)
                    assertEquals(VideoPlaybackDelivery.QUEUED, availability.setEventReady(true))
                    oldResult
                } else true
            }
            ready(availability)
            assertEquals(VideoPlaybackDelivery.SENT, availability.setDesired(true))
            assertEquals(listOf(true, true), sent)
            assertEquals(VideoPlaybackDelivery.UNCHANGED, availability.setDesired(true))
        }
    }

    @Test fun featureRetirementDuringAWriteDoesNotRememberThatDelivery() {
        var writes = 0
        lateinit var availability: VideoPlaybackAvailability
        availability = VideoPlaybackAvailability {
            if (++writes == 1) availability.setFeatureEnabled(false)
            true
        }
        ready(availability)
        assertEquals(VideoPlaybackDelivery.QUEUED, availability.setDesired(true))
        assertEquals(VideoPlaybackDelivery.SENT, availability.setFeatureEnabled(true))
        assertEquals(2, writes)
    }

    @Test fun channelRetirementCanCompleteWhileAnotherThreadWaitsForTheTransport() {
        val transport = Any()
        val transportHeld = CountDownLatch(1)
        val sending = CountDownLatch(1)
        val retirement = CountDownLatch(1)
        val failed = AtomicReference<Throwable>()
        val delivered = AtomicReference<VideoPlaybackDelivery>()
        val availability = VideoPlaybackAvailability {
            sending.countDown()
            synchronized(transport) { true }
        }
        ready(availability)
        val closer = Thread {
            try {
                synchronized(transport) {
                    transportHeld.countDown()
                    assertTrue(sending.await(2, TimeUnit.SECONDS))
                    assertEquals(VideoPlaybackDelivery.QUEUED, availability.setEventReady(false))
                    availability.setFeatureEnabled(false)
                    retirement.countDown()
                }
            } catch (error: Throwable) { failed.set(error) }
        }.apply { isDaemon = true; start() }
        assertTrue(transportHeld.await(2, TimeUnit.SECONDS))
        val sender = Thread {
            try { delivered.set(availability.setDesired(true)) }
            catch (error: Throwable) { failed.set(error) }
        }.apply { isDaemon = true; start() }
        try {
            assertTrue("retiring state must not wait for the blocked transport", retirement.await(2, TimeUnit.SECONDS))
            sender.join(2_000)
            closer.join(2_000)
            assertFalse(sender.isAlive)
            assertFalse(closer.isAlive)
            assertNull(failed.get())
            assertEquals(VideoPlaybackDelivery.QUEUED, delivered.get())
        } finally { sender.interrupt(); closer.interrupt() }
    }

    @Test fun aThrowingTransportDoesNotStrandFutureDelivery() {
        var writes = 0
        val availability = VideoPlaybackAvailability {
            if (++writes == 1) throw IllegalStateException("transport failed")
            true
        }
        ready(availability)
        assertTrue(runCatching { availability.setDesired(true) }.exceptionOrNull() is IllegalStateException)
        assertEquals(VideoPlaybackDelivery.SENT, availability.setEventReady(true))
        assertEquals(2, writes)
    }

    private fun ready(availability: VideoPlaybackAvailability) {
        availability.setFeatureEnabled(true)
        availability.setEventReady(true)
    }
}
