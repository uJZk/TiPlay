package com.shilapi.xcertplay.airplay

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.*
import org.junit.Test

class CurrentAudioListenerTest {
    @Test fun decryptedCallbacksOfARetiredStreamCannotChangeItsSuccessor() {
        val lock = Any()
        var current = true
        val events = mutableListOf<String>()
        val listener = currentAudioListener(lock, object : AudioStream.Listener {
            override fun onStarted(firstSample: Int) { events += "start" }
            override fun onRtp(rtp: ByteArray, sample: Int) { events += "rtp" }
            override fun onPacket(wire: ByteArray, rtp: ByteArray?, sample: Int?, error: Throwable?) { events += "capture" }
        }) { current }
        listener.onStarted(1)
        synchronized(lock) { current = false }
        listener.onStarted(2)
        listener.onRtp(byteArrayOf(1), 2)
        listener.onPacket(byteArrayOf(1), null, null, null)
        assertEquals(listOf("start"), events)
    }

    @Test fun replacementWaitsForDeliveryThenRejectsEveryOldCallback() {
        val lock = Any()
        var current = true
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val replacing = CountDownLatch(1)
        val replaced = CountDownLatch(1)
        var deliveries = 0
        val listener = currentAudioListener(lock, object : AudioStream.Listener {
            override fun onRtp(rtp: ByteArray, sample: Int) {
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                deliveries++
            }
        }) { current }
        val delivery = thread { listener.onRtp(byteArrayOf(1), 1) }
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        val replacement = thread {
            replacing.countDown()
            synchronized(lock) { current = false; replaced.countDown() }
        }
        try {
            assertTrue(replacing.await(5, TimeUnit.SECONDS))
            assertFalse(replaced.await(100, TimeUnit.MILLISECONDS))
        } finally { release.countDown(); delivery.join(5000); replacement.join(5000) }
        assertEquals(0L, replaced.count)
        listener.onRtp(byteArrayOf(2), 2)
        assertEquals(1, deliveries)
    }
}
