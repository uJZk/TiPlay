package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoEncoder
import org.webrtc.VideoFrame
import java.lang.management.ManagementFactory
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Public Java encoder/selector contract. These tests do not load the Android JNI bridge. */
class BrowserRtcVideoSelectionTest {
    private val baseline = codec("42002a")
    private val high = codec("64002a")
    private val source = "avc1.64002a"

    private fun codec(profile: String, mode: String = "1") = BrowserRtcVideoPolicy.Codec("H264", mapOf(
        "profile-level-id" to profile, "packetization-mode" to mode, "level-asymmetry-allowed" to "1"))

    private fun info(codec: BrowserRtcVideoPolicy.Codec) = VideoCodecInfo(codec.name, codec.parameters, emptyList())

    private fun config(value: String = source) = WebVideoRecord(
        WebVideoRecords.KIND_CONFIG, 0, WebVideoRecords.CODEC_H264, 0, 1, 0,
        WebJson.write(mapOf("codec" to value, "width" to 1568, "height" to 1080,
            "fps" to 60, "mode" to "carplay")).toByteArray())

    private fun answer(codec: BrowserRtcVideoPolicy.Codec = high) =
        "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 118\r\na=sendonly\r\n" +
            "a=rtpmap:118 H264/90000\r\na=fmtp:118 " +
            codec.parameters.entries.joinToString(";") { "${it.key}=${it.value}" } + "\r\n"

    private fun frame(timeUs: Long, key: Boolean = true) = WebVideoRecord(
        WebVideoRecords.KIND_FRAME, if (key) WebVideoRecords.FLAG_KEY_FRAME else 0,
        WebVideoRecords.CODEC_H264, 0, 1, timeUs,
        byteArrayOf(0, 0, 0, 1, if (key) 0x65 else 0x41, 0xe0.toByte()),
        prefix = if (key) byteArrayOf(0, 0, 0, 1, 0x67, 0x64, 0, 0x2a) else null)

    private inner class Fixture(
        offered: List<BrowserRtcVideoPolicy.Codec> = listOf(baseline, high),
        now: () -> Long = { 1_000_000_000L },
    ) : AutoCloseable {
        var current: VideoEncoder? = null
        var captured: ((VideoFrame) -> Unit)? = null
        val statuses = mutableListOf<VideoCodecStatus>()
        val output = mutableListOf<ByteArray>()
        val keyRequests = AtomicInteger()
        val bridge = BrowserRtcVideoTrack(offered, { keyRequests.incrementAndGet() }, captureFrame = { value ->
            captured?.invoke(value) ?: current?.let { statuses.add(it.encode(value, VideoEncoder.EncodeInfo(emptyArray()))) }
        }, nowNanos = now)

        fun create(codec: BrowserRtcVideoPolicy.Codec) = requireNotNull(bridge.createEncoder(info(codec)))
        fun initialize(encoder: VideoEncoder, callback: VideoEncoder.Callback = VideoEncoder.Callback { image, _ ->
            output.add(ByteArray(image.buffer.remaining()).also { image.buffer.duplicate().get(it) })
        }): VideoCodecStatus = encoder.initEncode(VideoEncoder.Settings(2, 1568, 1080, 4_000, 60, 1, false), callback)

        override fun close() = bridge.close()
    }

    @Test fun baselineFirstSenderCanSwitchToTheOfferedHighProfileWithoutSendingMismatchedBytes() {
        Fixture().use { f ->
            val first = f.create(baseline)
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            assertEquals(source, f.bridge.diagnostics()["source"])

            val selector = f.bridge.getEncoderSelector()
            // The native source's first resolution callback precedes encoder initialization.
            // Its requested switch may still be queued when the first old-format AU arrives.
            val selected = requireNotNull(selector.onResolutionChange(1568, 1080))
            assertEquals(high.parameters, selected.params)
            assertEquals(VideoCodecStatus.OK, f.initialize(first))
            f.current = first
            selector.onCurrentEncoder(info(baseline))
            assertTrue(f.bridge.offer(frame(0)))
            assertEquals(listOf(VideoCodecStatus.NO_OUTPUT), f.statuses)
            assertTrue(f.output.isEmpty())
            assertNull(f.bridge.failure)
            assertEquals(high.parameters, requireNotNull(selector.onAvailableBitrate(4_000)).params)

            val replacement = requireNotNull(f.bridge.createEncoder(selected))
            assertEquals(VideoCodecStatus.OK, f.initialize(replacement))
            f.current = replacement
            selector.onCurrentEncoder(selected)
            val recovery = frame(33_334)
            assertTrue(f.bridge.offer(recovery))
            assertEquals(1, f.output.size)
            assertArrayEquals(recovery.prefix!! + recovery.payload, f.output.single())
            assertNull(f.bridge.failure)
            assertNull(selector.onAvailableBitrate(4_000))
            assertTrue(f.keyRequests.get() > 0)
        }
    }

    @Test fun allocatingOtherFormatsDoesNotReplaceTheReceiveContractOrTheRunningEncoder() {
        Fixture(offered = listOf(baseline, high, codec("4d002a"))).use { f ->
            val running = f.create(high)
            assertEquals(VideoCodecStatus.OK, f.initialize(running))
            f.current = running
            f.bridge.negotiated(answer())
            f.create(baseline) // libwebrtc may allocate an implementation only to query it.
            f.create(codec("4d002a"))
            assertTrue(f.bridge.configure(config()))
            assertTrue(f.bridge.offer(frame(0)))
            assertNull(f.bridge.getEncoderSelector().onResolutionChange(1568, 1080))
            assertEquals(listOf(VideoCodecStatus.OK), f.statuses)
            assertEquals(1, f.output.size)
            assertNull(f.bridge.failure)
        }
    }

    @Test fun switchingEncodersWaitsForAFreshSourceKeyFrame() {
        Fixture().use { f ->
            val first = f.create(baseline)
            assertEquals(VideoCodecStatus.OK, f.initialize(first))
            f.current = first
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            assertTrue(f.bridge.offer(frame(0)))
            val replacement = f.create(high)
            assertEquals(VideoCodecStatus.OK, f.initialize(replacement))
            f.current = replacement

            assertTrue(f.bridge.offer(frame(16_667, key = false)))
            assertTrue(f.output.isEmpty())
            val recovery = frame(33_334)
            assertTrue(f.bridge.offer(recovery))
            assertArrayEquals(recovery.prefix!! + recovery.payload, f.output.single())
            assertNull(f.bridge.failure)
        }
    }

    @Test fun wrongPacketizationAndInsufficientEncoderLevelNeverPublishTheSource() {
        Fixture().use { f ->
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            for ((index, wrong) in listOf(codec("64002a", "0"), codec("64001f")).withIndex()) {
                val encoder = f.create(wrong)
                assertEquals(VideoCodecStatus.OK, f.initialize(encoder))
                f.current = encoder
                assertTrue(f.bridge.offer(frame(index * 16_667L)))
                assertEquals(VideoCodecStatus.NO_OUTPUT, f.statuses.last())
                assertTrue(f.output.isEmpty())
                assertNull(f.bridge.failure)
                assertEquals(high.parameters, requireNotNull(f.bridge.getEncoderSelector().onAvailableBitrate(4_000)).params)
            }
            val correct = f.create(high)
            assertEquals(VideoCodecStatus.OK, f.initialize(correct))
            f.current = correct
            assertTrue(f.bridge.offer(frame(33_334)))
            assertEquals(1, f.output.size)
        }
    }

    @Test fun theSourceCannotExceedTheAuthenticatedRemoteLevelEvenIfTheEncoderCan() {
        Fixture(offered = listOf(codec("64001f"))).use { f ->
            val encoder = f.create(high)
            assertEquals(VideoCodecStatus.OK, f.initialize(encoder))
            f.current = encoder
            f.bridge.negotiated(answer())
            assertFalse(f.bridge.configure(config()))
            assertEquals("codec-profile-not-negotiated", f.bridge.failure)
            assertFalse(f.bridge.offer(frame(0)))
            assertTrue(f.output.isEmpty())
            assertNull(f.bridge.getEncoderSelector().onEncoderBroken())
        }
    }

    @Test fun theEncoderSelectorUsesTheNegotiatedLevelWhenTheOfferPermitsAHigherLevel() {
        Fixture(offered = listOf(baseline, codec("640032"))).use { f ->
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            val selected = requireNotNull(f.bridge.getEncoderSelector().onResolutionChange(1568, 1080))
            assertEquals("64002a", selected.params["profile-level-id"])
            assertEquals("1", selected.params["packetization-mode"])
            val encoder = requireNotNull(f.bridge.createEncoder(selected))
            assertEquals(VideoCodecStatus.OK, f.initialize(encoder))
            f.current = encoder
            val original = frame(0)
            assertTrue(f.bridge.offer(original))
            assertArrayEquals(original.prefix!! + original.payload, f.output.single())
            assertNull(f.bridge.failure)
        }
    }

    @Test fun anAnswerWithALowerLevelCannotAdmitTheSourcesHigherOfferedLevel() {
        Fixture(offered = listOf(codec("640032"))).use { f ->
            f.bridge.negotiated(answer())
            assertFalse(f.bridge.configure(config("avc1.640032")))
            assertEquals("codec-profile-not-negotiated", f.bridge.failure)
            assertNull(f.bridge.getEncoderSelector().onResolutionChange(1568, 1080))
            assertFalse(f.bridge.offer(frame(0)))
            assertTrue(f.output.isEmpty())
        }
    }

    @Test fun anUncompletedEncoderSelectionHasABoundedFailure() {
        var now = 1_000_000_000L
        Fixture(now = { now }).use { f ->
            val wrong = f.create(baseline)
            assertEquals(VideoCodecStatus.OK, f.initialize(wrong))
            f.current = wrong
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            assertTrue(f.bridge.offer(frame(0)))
            now += 5_999_999_999L
            assertNull(f.bridge.pollFailure())
            now++
            assertEquals("video-encoder-selection-timeout", f.bridge.pollFailure())
            assertFalse(f.bridge.offer(frame(16_667)))
            assertNull(f.bridge.getEncoderSelector().onAvailableBitrate(4_000))
            assertTrue(f.output.isEmpty())
        }
    }

    @Test fun delayedOldEncoderReleaseAndInitializationCannotTakeBackTheSelectedEncoder() {
        Fixture().use { f ->
            val old = f.create(baseline)
            assertEquals(VideoCodecStatus.OK, f.initialize(old))
            val current = f.create(high)
            assertEquals(VideoCodecStatus.OK, f.initialize(current))
            f.current = current
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))

            assertEquals(VideoCodecStatus.OK, old.release())
            assertEquals(VideoCodecStatus.ERR_PARAMETER, f.initialize(old))
            assertTrue(f.bridge.offer(frame(0)))
            assertEquals(listOf(VideoCodecStatus.OK), f.statuses)
            assertEquals(1, f.output.size)
            assertNull(f.bridge.getEncoderSelector().onResolutionChange(1568, 1080))
            assertNull(f.bridge.failure)
        }
    }

    @Test fun callbacksFromAnOldNativeStreamCannotReplaceTheCurrentStreamsAnnouncedFormat() {
        Fixture().use { f ->
            val stale = f.bridge.getEncoderSelector()
            val current = f.bridge.getEncoderSelector()
            val running = f.create(high)
            assertEquals(VideoCodecStatus.OK, f.initialize(running))
            f.current = running
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            current.onCurrentEncoder(info(high))
            stale.onCurrentEncoder(info(baseline))

            assertNull(stale.onAvailableBitrate(4_000))
            assertNull(stale.onResolutionChange(640, 360))
            assertEquals(high.parameters, requireNotNull(stale.onEncoderBroken()).params)
            val announced = f.bridge.diagnostics()["announced"] as Map<*, *>
            assertEquals("64002a", announced["profileLevelId"])
            assertTrue(f.bridge.offer(frame(0)))
            assertEquals(1, f.output.size)
            assertNull(current.onResolutionChange(1568, 1080))
            assertNull(f.bridge.failure)
        }
    }

    @Test fun aRetiredBridgeCannotUseItsOldSelectorOrAnAlreadyCapturedFrameToAffectTheReplacement() {
        val old = Fixture()
        var held: VideoFrame? = null
        try {
            val encoder = old.create(high)
            assertEquals(VideoCodecStatus.OK, old.initialize(encoder))
            old.bridge.negotiated(answer())
            assertTrue(old.bridge.configure(config()))
            old.captured = { it.retain(); held = it }
            assertTrue(old.bridge.offer(frame(0)))
            val selector = old.bridge.getEncoderSelector()
            old.close()

            Fixture().use { replacement ->
                val next = replacement.create(high)
                assertEquals(VideoCodecStatus.OK, replacement.initialize(next))
                replacement.current = next
                replacement.bridge.negotiated(answer())
                assertTrue(replacement.bridge.configure(config()))
                assertNull(selector.onResolutionChange(1568, 1080))
                assertNull(selector.onAvailableBitrate(4_000))
                assertNull(selector.onEncoderBroken())
                selector.onCurrentEncoder(info(baseline))
                assertEquals(VideoCodecStatus.ERR_PARAMETER, old.initialize(encoder))
                assertEquals(VideoCodecStatus.NO_OUTPUT, encoder.encode(requireNotNull(held), VideoEncoder.EncodeInfo(emptyArray())))
                assertNull(old.bridge.createEncoder(info(high)))
                assertTrue(replacement.bridge.offer(frame(16_667)))
                assertEquals(1, replacement.output.size)
                assertTrue(old.output.isEmpty())
                assertNull(replacement.bridge.failure)
            }
        } finally { held?.release(); old.close() }
    }

    @Test fun encoderReleaseWaitsForTheNativeCallbackAndPreventsLaterCallbackUse() {
        val entered = CountDownLatch(1)
        val allowReturn = CountDownLatch(1)
        val releaseStarted = CountDownLatch(1)
        val released = CountDownLatch(1)
        val callbacks = AtomicInteger()
        val executor = Executors.newFixedThreadPool(2)
        var captured: VideoFrame? = null
        Fixture().use { f ->
            try {
                val encoder = f.create(high)
                assertEquals(VideoCodecStatus.OK, f.initialize(encoder, VideoEncoder.Callback { _, _ ->
                    callbacks.incrementAndGet()
                    entered.countDown()
                    check(allowReturn.await(3, TimeUnit.SECONDS))
                }))
                f.current = encoder
                f.bridge.negotiated(answer())
                assertTrue(f.bridge.configure(config()))
                // Native libwebrtc invokes Encode asynchronously, after onFrameCaptured
                // returns. Retain the frame and leave offer() before entering the callback.
                f.captured = { it.retain(); captured = it }
                assertTrue(f.bridge.offer(frame(0)))
                val input = requireNotNull(captured)
                val first = executor.submit<VideoCodecStatus> { encoder.encode(input, VideoEncoder.EncodeInfo(emptyArray())) }
                assertTrue(entered.await(3, TimeUnit.SECONDS))
                val release = executor.submit<VideoCodecStatus> {
                    releaseStarted.countDown()
                    encoder.release().also { released.countDown() }
                }
                assertTrue(releaseStarted.await(3, TimeUnit.SECONDS))
                assertFalse("Release must not return while its native callback is still running", released.await(100, TimeUnit.MILLISECONDS))
                allowReturn.countDown()
                assertEquals(VideoCodecStatus.OK, first.get(3, TimeUnit.SECONDS))
                assertEquals(VideoCodecStatus.OK, release.get(3, TimeUnit.SECONDS))
                f.captured = null
                assertTrue(f.bridge.offer(frame(16_667)))
                assertEquals(1, callbacks.get())
                assertEquals(VideoCodecStatus.NO_OUTPUT, f.statuses.last())
                assertNull(f.bridge.failure)
            } finally { allowReturn.countDown(); executor.shutdownNow(); captured?.release() }
        }
    }

    @Test fun reinitializingTheSameWrapperCannotEnterAHalfCompletedRelease() {
        Fixture().use { f ->
            val encoder = f.create(high)
            assertEquals(VideoCodecStatus.OK, f.initialize(encoder))
            f.current = encoder
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            val newCallbacks = AtomicInteger()
            val release = FutureTask { encoder.release() }
            val initialize = FutureTask { f.initialize(encoder, VideoEncoder.Callback { _, _ -> newCallbacks.incrementAndGet() }) }
            val releaser = Thread(release, "video-wrapper-release").apply { isDaemon = true }
            val initializer = Thread(initialize, "video-wrapper-reinitialize").apply { isDaemon = true }
            fun awaitBlocked(thread: Thread) {
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
                while (thread.state != Thread.State.BLOCKED && thread.isAlive && System.nanoTime() < deadline) Thread.sleep(1)
                assertEquals(Thread.State.BLOCKED, thread.state)
            }
            try {
                synchronized(f.bridge) {
                    // Pause release at the shared state transaction. Re-init must remain
                    // behind that release until BOTH its callback and active slot retire.
                    releaser.start()
                    awaitBlocked(releaser)
                    initializer.start()
                    awaitBlocked(initializer)
                    assertEquals("Re-init must wait for the unfinished release, not enter shared state ahead of it",
                        releaser.id, ManagementFactory.getThreadMXBean().getThreadInfo(initializer.id).lockOwnerId)
                }
                assertEquals(VideoCodecStatus.OK, release.get(3, TimeUnit.SECONDS))
                assertEquals(VideoCodecStatus.OK, initialize.get(3, TimeUnit.SECONDS))
                assertTrue(f.bridge.offer(frame(0)))
                assertEquals(1, newCallbacks.get())
                assertEquals(VideoCodecStatus.OK, f.statuses.last())
                assertNull(f.bridge.failure)
            } finally { releaser.join(3000); initializer.join(3000) }
        }
    }

    @Test fun anOldAccessUnitWaitingAtTheCallbackGateCannotEnterAReinitializedNativeCallback() {
        Fixture().use { f ->
            val encoder = f.create(high)
            val oldCallbacks = AtomicInteger()
            val newCallbacks = AtomicInteger()
            assertEquals(VideoCodecStatus.OK, f.initialize(encoder,
                VideoEncoder.Callback { _, _ -> oldCallbacks.incrementAndGet() }))
            f.current = encoder
            f.bridge.negotiated(answer())
            assertTrue(f.bridge.configure(config()))
            var retained: VideoFrame? = null
            f.captured = { it.retain(); retained = it }
            assertTrue(f.bridge.offer(frame(0)))
            val input = requireNotNull(retained)
            val gate = encoder.javaClass.getDeclaredField("callbackGate").let { field ->
                field.isAccessible = true
                field.get(encoder)
            }
            val result = FutureTask { encoder.encode(input, VideoEncoder.EncodeInfo(emptyArray())) }
            val worker = Thread(result, "video-old-au-at-callback-gate").apply { isDaemon = true }
            try {
                synchronized(gate) {
                    worker.start()
                    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
                    while (worker.state != Thread.State.BLOCKED && worker.isAlive && System.nanoTime() < deadline) Thread.sleep(1)
                    assertEquals(Thread.State.BLOCKED, worker.state)
                    val blocked = ManagementFactory.getThreadMXBean().getThreadInfo(worker.id)
                    assertEquals(System.identityHashCode(gate), blocked.lockInfo.identityHashCode)
                    assertEquals(Thread.currentThread().id, blocked.lockOwnerId)

                    // The old Encode has already prepared its image. Reuse the public
                    // wrapper while it is waiting, as the native reset path can do.
                    assertEquals(VideoCodecStatus.OK, encoder.release())
                    assertEquals(VideoCodecStatus.OK, f.initialize(encoder,
                        VideoEncoder.Callback { _, _ -> newCallbacks.incrementAndGet() }))
                }
                assertEquals(VideoCodecStatus.NO_OUTPUT, result.get(3, TimeUnit.SECONDS))
                assertEquals(0, oldCallbacks.get())
                assertEquals(0, newCallbacks.get())
                f.captured = null
                assertTrue(f.bridge.offer(frame(16_667)))
                assertEquals(1, newCallbacks.get())
                assertEquals(0, oldCallbacks.get())
                assertEquals(VideoCodecStatus.OK, f.statuses.last())
                assertNull(f.bridge.failure)
            } finally { worker.join(3000); retained?.release() }
        }
    }
}
