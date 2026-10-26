package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class BrowserRtcAudioSignalingTest {
    private val offer = File("src/test/resources/Browser-audio-track-offer.sdp").readText()
    private class Backend(override val slots: List<BrowserRtcAudioSlot>, val entered: CountDownLatch, val release: CountDownLatch) : BrowserRtcAudioBackend {
        @Volatile var closed = false
        override fun answer(offer: String): String { entered.countDown(); release.await(3, TimeUnit.SECONDS); return offer }
        override fun send(slot: String, payload: ByteArray, timestampUs: Double) {}
        override fun ready() = !closed
        override fun snapshot(): Map<String, Any?> = emptyMap()
        override fun close() { closed = true; release.countDown() }
    }
    private fun request(q: Long = 1L shl 40, generation: Int = 1) = mapOf("k" to "audio-offer", "q" to q, "generation" to generation, "sdp" to offer)

    @Test fun nativeGatheringDoesNotBlockApplicationRpcOrAcknowledgements() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val application = CountDownLatch(1); val acknowledged = CountDownLatch(1)
        val replies = LinkedBlockingQueue<String>(); val failures = LinkedBlockingQueue<String>()
        val router = BrowserRtcAudioRouter({}, { slots, _ -> Backend(slots, entered, release) })
        BrowserRtcAudioSignaling(router, { true }, { true }, replies::add).use { signaling ->
            BrowserRtcControlQueue({ true }, {}, { acknowledged.countDown() }, { fields ->
                if (fields["k"] == "audio-offer") { signaling.offer(fields); null }
                else { application.countDown(); WebJson.write(mapOf("q" to fields["q"], "state" to "ready")) }
            }, { _, response -> replies.add(response) }, { reason, _ -> failures.add(reason) }).use { queue ->
                queue.offer(WebJson.write(request()).toByteArray()); assertTrue(entered.await(1, TimeUnit.SECONDS))
                queue.offer(WebJson.write(mapOf("q" to 3, "e" to emptyList<Any>())).toByteArray())
                queue.offer(WebJson.write(mapOf("k" to "ack", "channel" to "audio", "q" to 1, "bytes" to 24)).toByteArray())
                assertTrue(application.await(1, TimeUnit.SECONDS)); assertTrue(acknowledged.await(1, TimeUnit.SECONDS))
                assertEquals(3L, (WebJson.parse(requireNotNull(replies.poll(1, TimeUnit.SECONDS))) as Map<*, *>)["q"])
                release.countDown()
                val reply = WebJson.parse(requireNotNull(replies.poll(1, TimeUnit.SECONDS))) as Map<*, *>
                assertEquals(1L shl 40, reply["q"]); assertEquals(1L, reply["generation"]); assertTrue(reply["sdp"] is String)
                assertTrue(failures.isEmpty())
            }
        }
    }

    @Test fun concurrentOffersFailBoundedlyWithoutRetiringTheHealthyNegotiation() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val replies = LinkedBlockingQueue<String>()
        val router = BrowserRtcAudioRouter({}, { slots, _ -> Backend(slots, entered, release) })
        BrowserRtcAudioSignaling(router, { true }, { true }, replies::add).use { signaling ->
            signaling.offer(request()); assertTrue(entered.await(1, TimeUnit.SECONDS))
            signaling.offer(request(q = 2, generation = 2))
            val busy = WebJson.parse(requireNotNull(replies.poll(1, TimeUnit.SECONDS))) as Map<*, *>
            assertEquals("audio-negotiation-busy", busy["error"])
            release.countDown()
            val accepted = WebJson.parse(requireNotNull(replies.poll(1, TimeUnit.SECONDS))) as Map<*, *>
            assertFalse(accepted.containsKey("error")); assertTrue(router.ready())
        }
    }

    @Test fun authenticationAndMediaValidationHappenBeforeNativeAllocation() {
        val allocations = AtomicInteger(); val replies = LinkedBlockingQueue<String>()
        fun router() = BrowserRtcAudioRouter({}, { slots, _ -> allocations.incrementAndGet(); Backend(slots, CountDownLatch(0), CountDownLatch(0)) })
        BrowserRtcAudioSignaling(router(), { false }, { true }, replies::add).use { signaling ->
            signaling.offer(request())
            assertEquals("authentication-required", (WebJson.parse(requireNotNull(replies.poll(1, TimeUnit.SECONDS))) as Map<*, *>)["error"])
        }
        BrowserRtcAudioSignaling(router(), { true }, { true }, replies::add).use { signaling ->
            signaling.offer(request() + mapOf("sdp" to offer.replaceFirst("m=audio", "m=video")))
            assertEquals("audio-only-offer-required", (WebJson.parse(requireNotNull(replies.poll(1, TimeUnit.SECONDS))) as Map<*, *>)["error"])
        }
        assertEquals(0, allocations.get())
    }

    @Test fun closeCancelsPendingGatheringAndSuppressesItsLateControlReply() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val replies = LinkedBlockingQueue<String>(); val retired = CountDownLatch(1)
        val router = BrowserRtcAudioRouter({}, { slots, _ -> object : BrowserRtcAudioBackend {
            override val slots = slots
            override fun answer(offer: String): String { entered.countDown(); try { release.await(3, TimeUnit.SECONDS); return offer } finally { retired.countDown() } }
            override fun send(slot: String, payload: ByteArray, timestampUs: Double) {}
            override fun ready() = true
            override fun snapshot(): Map<String, Any?> = emptyMap()
            override fun close() { release.countDown() }
        } })
        val signaling = BrowserRtcAudioSignaling(router, { true }, { true }, replies::add)
        signaling.offer(request()); assertTrue(entered.await(1, TimeUnit.SECONDS)); signaling.close()
        assertTrue(retired.await(1, TimeUnit.SECONDS)); assertNull(replies.poll(100, TimeUnit.MILLISECONDS))
    }
}
