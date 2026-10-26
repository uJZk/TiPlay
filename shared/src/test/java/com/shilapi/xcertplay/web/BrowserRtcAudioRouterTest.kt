package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class BrowserRtcAudioRouterTest {
    private val offer = File("src/test/resources/Browser-audio-track-offer.sdp").readText()
    private class Backend(override val slots: List<BrowserRtcAudioSlot>, val entered: CountDownLatch? = null,
                          val release: CountDownLatch? = null) : BrowserRtcAudioBackend {
        val sent = mutableListOf<Triple<String, ByteArray, Double>>()
        @Volatile var closed = false
        override fun answer(offer: String): String { entered?.countDown(); release?.await(3, TimeUnit.SECONDS); return offer.replace("a=recvonly", "a=sendonly") }
        override fun send(slot: String, payload: ByteArray, timestampUs: Double) { check(!closed); sent += Triple(slot, payload, timestampUs) }
        override fun ready() = !closed
        override fun snapshot(): Map<String, Any?> = emptyMap()
        override fun close() { closed = true; release?.countDown() }
    }
    private fun record(kind: Int, type: Int, epoch: Int, payload: ByteArray, mode: Int = 0): ByteArray =
        ByteBuffer.allocate(28 + payload.size).order(ByteOrder.BIG_ENDIAN).putInt(24 + payload.size)
            .put(kind.toByte()).put(type.toByte()).put(2).put((mode or if (kind == 6) 2 else 0).toByte())
            .putInt(48000).putInt(0).putInt(epoch).putDouble(Double.NaN).put(payload).array()
    private fun config(type: Int = 0, epoch: Int = 1, codec: String = "opus", mode: Int = 0, ended: Boolean = false) =
        record(6, type, epoch, WebJson.write(if (ended) mapOf("ended" to true) else mapOf("codec" to codec,
            "sampleRate" to 48000, "channels" to 2, "bitDepth" to 16, "samplesPerFrame" to 960)).toByteArray(), mode)
    private fun packet(type: Int = 0, epoch: Int = 1, mode: Int = 0, payload: ByteArray = byteArrayOf(0x78, 0x02, 0x03)) =
        record(7, type, epoch, ByteBuffer.allocate(8 + payload.size).putDouble(epoch * 20000.0).put(payload).array(), mode)
    private fun fields(record: ByteArray) = WebJson.parse(String(record, 28, record.size - 28)) as Map<*, *>

    private fun readyFields(record: ByteArray): Map<String, Any?> = fields(record).let { config -> mapOf(
        "rtcGeneration" to config["rtcGeneration"], "rtpSlot" to config["rtpSlot"], "rtcOwnerEpoch" to config["rtcOwnerEpoch"],
        "type" to (record[5].toInt() and 255), "mode" to when (record[7].toInt() and 12) { 4 -> "airplay-mirror"; 8 -> "airplay-audio"; else -> "carplay" }) }

    @Test fun realChromiumOfferAndBundleOnlyVariantsParseExactMidsAndPayloads() {
        val parsed = BrowserRtcAudioRouter.parseOffer(offer)
        assertEquals(16, parsed.size); assertEquals((0..15).map(Int::toString), parsed.map { it.mid })
        assertTrue(parsed.all { it.payloadType == 111 })
        val second = offer.indexOf("m=audio", offer.indexOf("m=audio") + 1)
        val bundleOnly = offer.substring(0, second) + offer.substring(second).replaceFirst("m=audio 9", "m=audio 0")
            .replaceFirst("a=mid:1\r\n", "a=mid:1\r\na=bundle-only\r\n")
        assertEquals(parsed, BrowserRtcAudioRouter.parseOffer(bundleOnly))
        for (bad in listOf(offer.replaceFirst("a=recvonly", "a=sendrecv"), offer.replaceFirst("m=audio", "m=video"),
            offer.replace("a=mid:1\r\n", "a=mid:0\r\n"), offer + "a=candidate:1 1 udp 1 1.2.3.4 1234 typ srflx\r\n")) {
            assertThrows(IllegalArgumentException::class.java) { BrowserRtcAudioRouter.parseOffer(bad) }
        }
    }

    @Test fun originalOpusPayloadQueuesBeforeNegotiationWhileUnsupportedRecordsStayUntouched() {
        val peers = mutableListOf<Backend>(); val captured = mutableListOf<ByteArray>(); val failures = mutableListOf<String>()
        val router = BrowserRtcAudioRouter(failures::add, { slots, _ -> Backend(slots).also(peers::add) },
            captureNative = { record, submit -> captured += record; submit() })
        try {
            assertNull(router.route(config())); val input = packet(); assertNull(router.route(input))
            val fallback = config(type = 1, codec = "aac-lc")
            assertSame(fallback, router.route(fallback))
            router.answer(offer, 1)
            val metadata = router.drainMetadata().single(); val fields = fields(metadata)
            assertEquals("webrtc-track-v1", fields["audioTransport"]); assertEquals("0", fields["rtpSlot"]); assertEquals(1L, fields["rtcGeneration"])
            assertEquals("SDP and metadata alone cannot release RTP", 0, peers.single().sent.size)
            assertTrue(router.readyTrack(readyFields(metadata)))
            assertEquals(1, peers.single().sent.size); assertArrayEquals(input.copyOfRange(36, input.size), peers.single().sent.single().second)
            assertEquals(20000.0, peers.single().sent.single().third, 0.0)
            assertEquals(2, captured.size); assertTrue(failures.isEmpty())
        } finally { router.close() }
    }

    @Test fun blockedAnswerDoesNotBlockFallbackAndCloseCancelsThePendingPeer() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val peers = mutableListOf<Backend>()
        val router = BrowserRtcAudioRouter({}, { slots, _ -> Backend(slots, entered, release).also(peers::add) })
        val failure = AtomicReference<Throwable>()
        val thread = Thread { try { router.answer(offer, 1) } catch (cause: Throwable) { failure.set(cause) } }
        thread.start(); assertTrue(entered.await(1, TimeUnit.SECONDS))
        val start = System.nanoTime(); val fallback = config(codec = "alac")
        assertSame(fallback, router.route(fallback)); assertTrue(System.nanoTime() - start < 250_000_000L)
        router.close(); thread.join(1000); assertFalse(thread.isAlive); assertTrue(peers.single().closed); assertNotNull(failure.get())
    }

    @Test fun seventeenUtterancesRetireSlotsAndRestartWithoutMissingOrRecapturingTheNewOwner() {
        val peers = mutableListOf<Backend>(); val captured = mutableListOf<ByteArray>(); val failed = CountDownLatch(1)
        val router = BrowserRtcAudioRouter({ if (it == "audio-slots-exhausted") failed.countDown() },
            { slots, _ -> Backend(slots).also(peers::add) }, captureNative = { record, submit -> captured += record; submit() })
        try {
            router.answer(offer, 1)
            for (epoch in 1..16) {
                val conf = requireNotNull(router.route(config(type = 1, epoch = epoch)))
                assertEquals((epoch - 1).toString(), fields(conf)["rtpSlot"])
                assertTrue(router.readyTrack(readyFields(conf)))
                assertNull(router.route(packet(type = 1, epoch = epoch)))
                assertEquals(true, fields(requireNotNull(router.route(config(type = 1, epoch = epoch, ended = true))))["ended"])
            }
            assertNull(router.route(config(type = 1, epoch = 17)))
            assertNull(router.route(packet(type = 1, epoch = 17)))
            assertTrue(failed.await(1, TimeUnit.SECONDS)); assertEquals(16, peers[0].sent.size)
            val capturedBefore = captured.size
            router.answer(offer, 2)
            val replay = router.drainMetadata().single()
            assertEquals("0", fields(replay)["rtpSlot"]); assertEquals(2L, fields(replay)["rtcGeneration"])
            assertEquals("regenerated metadata must not duplicate original capture", capturedBefore, captured.size)
            assertEquals(0, peers[1].sent.size)
            assertFalse(router.readyTrack(readyFields(replay) + mapOf("rtcGeneration" to 1)))
            assertTrue(router.readyTrack(readyFields(replay)))
            assertEquals(1, peers[1].sent.size); assertArrayEquals(byteArrayOf(0x78, 2, 3), peers[1].sent.single().second)
            assertNull("retired source cannot enter the replacement peer", router.route(packet(type = 1, epoch = 16)))
            assertEquals(1, peers[1].sent.size)
            router.route(config(type = 1, epoch = 17, ended = true))
            assertEquals(17, peers.sumOf { it.sent.size })
        } finally { router.close() }
    }

    @Test fun sourceModesAndEpochsAreIndependentAndEndedSlotsCannotRevive() {
        val peers = mutableListOf<Backend>(); val router = BrowserRtcAudioRouter({}, { slots, _ -> Backend(slots).also(peers::add) })
        try {
            router.answer(offer, 1)
            assertEquals("0", fields(requireNotNull(router.route(config(mode = 0))))["rtpSlot"])
            val second = requireNotNull(router.route(config(mode = 8)))
            assertEquals("1", fields(second)["rtpSlot"]); assertTrue(router.readyTrack(readyFields(second)))
            assertNull(router.route(packet(mode = 0))); assertEquals(0, peers.single().sent.size)
            router.route(packet(mode = 8)); assertEquals(1, peers.single().sent.size)
            router.route(config(mode = 8, ended = true)); assertNull(router.route(config(mode = 8))); assertNull(router.route(packet(mode = 8)))
            assertEquals(1, peers.single().sent.size)
        } finally { router.close() }
    }

    @Test fun incrementedHubEosKeepsItsWireTombstoneAndIdentifiesTheOriginalNativeOwner() {
        val captured = mutableListOf<ByteArray>()
        val router = BrowserRtcAudioRouter({}, { slots, _ -> Backend(slots) },
            captureNative = { record, submit -> captured += record; submit() })
        try {
            router.answer(offer, 1)
            router.route(config(epoch = 10)); router.route(packet(epoch = 10))
            val end = requireNotNull(router.route(config(epoch = 11, ended = true)))
            assertEquals(11, ByteBuffer.wrap(end).getInt(16))
            assertEquals("config, packet and incremented EOS each have one original native capture", 3, captured.size)
            assertEquals(11, ByteBuffer.wrap(captured.last()).getInt(16))
            assertEquals(10L, fields(end)["rtcOwnerEpoch"]); assertEquals("0", fields(end)["rtpSlot"])
            assertNull(router.route(config(epoch = 11)))
            assertNull(router.route(packet(epoch = 10)))
            assertEquals("1", fields(requireNotNull(router.route(config(epoch = 12))))["rtpSlot"])
        } finally { router.close() }
    }


    @Test fun exactRemoteReadyBarrierRetainsEarlyEosAndRejectsStaleOrMismatchedOwners() {
        val peers = mutableListOf<Backend>()
        val router = BrowserRtcAudioRouter({}, { slots, _ -> Backend(slots).also(peers::add) })
        try {
            router.answer(offer, 1)
            val metadata = requireNotNull(router.route(config(epoch = 10)))
            router.route(packet(epoch = 10))
            val eos = requireNotNull(router.route(config(epoch = 11, ended = true)))
            assertEquals(0, peers.single().sent.size)
            val exact = readyFields(metadata)
            for (wrong in listOf(mapOf("rtcGeneration" to 2), mapOf("rtpSlot" to "1"), mapOf("type" to 1),
                mapOf("mode" to "airplay-mirror"), mapOf("rtcOwnerEpoch" to 11))) {
                assertFalse(router.readyTrack(exact + wrong))
            }
            assertEquals(10L, fields(eos)["rtcOwnerEpoch"])
            assertTrue(router.readyTrack(exact)); assertEquals(1, peers.single().sent.size)
            assertTrue(router.readyTrack(exact)); assertEquals(1, peers.single().sent.size)
            router.reset(); assertFalse(router.readyTrack(exact))
            router.answer(offer, 2)
            val wrapped = requireNotNull(router.route(config(epoch = -2)))
            assertEquals(0xffff_fffeL, fields(wrapped)["rtcOwnerEpoch"])
            router.route(packet(epoch = -2)); assertTrue(router.readyTrack(readyFields(wrapped)))
            assertEquals(1, peers[1].sent.size)
        } finally { router.close() }
    }
    @Test fun nativeStagingIsBoundedAndOverflowDoesNotBlockUnsupportedFormats() {
        val failed = CountDownLatch(1); val router = BrowserRtcAudioRouter({ failed.countDown() }, { slots, _ -> Backend(slots) })
        try {
            router.route(config())
            repeat(129) { router.route(packet(payload = ByteArray(1000))) }
            assertTrue(failed.await(1, TimeUnit.SECONDS))
            val snapshot = router.snapshot(); assertTrue((snapshot["queuedPackets"] as Int) <= 128)
            val fallback = config(type = 2, codec = "aac-eld"); assertSame(fallback, router.route(fallback))
        } finally { router.close() }
    }
}
