package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.AudioStreamId
import org.junit.Assert.*
import org.junit.Test

class BluetoothVoiceMixerTest {
    // Isolate discontinuity envelopes from the independently tested native filter response.
    private fun mixer(now: () -> Long = System::nanoTime) = BluetoothVoiceMixer(createResampler = { _, _ -> object : PcmResampler {
        override fun convert(input: ShortArray) = input.copyOf()
        override fun close() = Unit
    } }, nowNanos = now)
    private fun pcm(value: Int, frames: Int = 960, channels: Int = 1) = ByteArray(frames * channels * 2) { index ->
        (if (index % 2 == 0) value else value shr 8).toByte()
    }
    @Test fun protocolGuidanceIsAllowedButMediaAlertsAndUnknownPurposesAreDropped() {
        val mixer = mixer()
        for (id in listOf(AudioStreamId(103, "media"), AudioStreamId(102, "compatibility"),
            AudioStreamId(100, "alert"), AudioStreamId(100, "unknown"))) mixer.offer(id, 48000, 1, pcm(20000))
        assertTrue(mixer.next().all { it == 0.toShort() })
        mixer.offer(AudioStreamId(100, "default"), 48000, 1, pcm(10000))
        assertEquals(2500, mixer.next()[300].toInt())
    }
    @Test fun bluetoothNavigationIsAlwaysAttenuatedEvenWhenCallSamplesEndAndMixIsClipped() {
        val mixer = mixer()
        val navigation = AudioStreamId(100, "default"); val call = AudioStreamId(100, "telephony")
        mixer.offer(navigation, 48000, 2, pcm(12000, channels = 2))
        mixer.offer(call, 48000, 1, pcm(20000, frames = 480))
        val mixed = mixer.next()
        assertEquals(23000, mixed[300].toInt())
        assertEquals(3000, mixed[800].toInt()) // The call's 5 ms decay has ended; navigation keeps its gain.
        mixer.clear()
        mixer.offer(call, 48000, 1, pcm(32000))
        mixer.offer(AudioStreamId(100, "speechrecognition"), 48000, 1, pcm(32000))
        assertEquals(32767, mixer.next()[300].toInt())
    }
    @Test fun unpacedLiveProducerKeepsOnlyItsFreshBoundedTailAndStopClearsIt() {
        val mixer = mixer(); val call = AudioStreamId(100, "telephony")
        repeat(20) { mixer.offer(call, 48000, 1, pcm(it * 1000)) }
        val audible = mixer.next()
        assertTrue(audible.take(240).zipWithNext().all { (a, b) -> b >= a })
        assertTrue(audible.drop(240).all { it >= 11000.toShort() })
        mixer.clear(call)
        assertTrue(mixer.next().all { it == 0.toShort() })
    }
    private fun maximumStep(samples: ShortArray): Int = samples.toList().zipWithNext()
        .maxOf { (a, b) -> kotlin.math.abs(b.toInt() - a.toInt()) }

    @Test fun onsetAndUnderrunFadeWithinFiveMillisecondsWithoutBufferingMoreSamples() {
        val mixer = mixer(); val call = AudioStreamId(100, "telephony")
        mixer.offer(call, 48000, 1, pcm(12000))
        val output = mixer.next(1440)
        assertEquals(50, output[0].toInt())
        assertEquals(12000, output[239].toInt())
        assertTrue(maximumStep(output) <= 50)
        assertTrue(output.takeLast(240).all { it == 0.toShort() })
        assertTrue(mixer.next().all { it == 0.toShort() })
    }

    @Test fun droppingOldPcmCrossfadesFromTheLastAudibleValueAndKeepsTheSameBound() {
        val mixer = mixer(); val call = AudioStreamId(100, "telephony")
        mixer.offer(call, 48000, 1, pcm(16000))
        assertEquals(16000, mixer.next(480).last().toInt())
        mixer.offer(call, 48000, 1, pcm(-16000, frames = 12000))
        val output = mixer.next(7680) // The existing 160 ms limit, with no extra queued fade block.
        assertTrue(kotlin.math.abs(output[0].toInt() - 16000) <= 134)
        assertTrue(maximumStep(output) <= 134)
        assertTrue(output.drop(240).all { it == (-16000).toShort() })
        val tail = mixer.next()
        assertTrue(tail.drop(240).all { it == 0.toShort() })
    }

    @Test fun aTimestampGapBlendsAtItsQueuedBoundaryWithoutCuttingEarlierSpeech() {
        val mixer = mixer(); val call = AudioStreamId(100, "telephony")
        mixer.offer(call, 48000, 1, pcm(12000))
        mixer.next(480)
        mixer.offer(call, 48000, 1, pcm(-12000), discontinuity = true)
        val output = mixer.next()
        assertTrue(output.take(480).all { it == 12000.toShort() })
        assertEquals(-12000, output[719].toInt())
        assertTrue(maximumStep(output) <= 100)
    }

    @Test fun ordinaryPacketBoundariesDoNotCreateFadesAndRecoveryDoesNotJump() {
        val mixer = mixer(); val call = AudioStreamId(100, "telephony")
        mixer.offer(call, 48000, 1, pcm(12000, frames = 480))
        mixer.next(400)
        mixer.offer(call, 48000, 1, pcm(12000, frames = 480))
        assertTrue(mixer.next(500).all { it == 12000.toShort() })
        mixer.next(960)
        mixer.offer(call, 48000, 1, pcm(-12000), discontinuity = true)
        val recovery = mixer.next()
        assertEquals(-50, recovery[0].toInt())
        assertEquals(-12000, recovery[239].toInt())
        assertTrue(maximumStep(recovery) <= 50)
    }

    @Test fun aPlaybackStallDiscardsExpiredPcmAndBlendsIntoFreshSpeech() {
        var now = 0L
        val mixer = mixer { now }; val call = AudioStreamId(100, "telephony")
        mixer.offer(call, 48000, 1, pcm(16000), deadlineNanos = 50_000_000L)
        assertEquals(16000, mixer.next(480).last().toInt())
        now = 200_000_000L
        mixer.offer(call, 48000, 1, pcm(-16000), deadlineNanos = 300_000_000L)
        val output = mixer.next()
        assertTrue(kotlin.math.abs(output[0].toInt() - 16000) <= 134)
        assertTrue(output.drop(240).all { it == (-16000).toShort() })
        assertTrue(maximumStep(output) <= 134)
    }

    @Test fun alreadyQueuedAudioTrackFramesCountAgainstSpeechDeadlines() {
        val mixer = mixer { 0L }; val call = AudioStreamId(100, "telephony")
        mixer.offer(call, 48000, 1, pcm(16000), deadlineNanos = 20_000_000L)
        assertTrue(mixer.next(outputLeadNanos = 50_000_000L).all { it == 0.toShort() })
    }

    @Test fun resamplerLookaheadCannotRefreshTheDeadlineOfItsBufferedOutput() {
        val mixer = BluetoothVoiceMixer(createResampler = { _, _ -> object : PcmResampler {
            private var pending = ShortArray(0)
            override fun convert(input: ShortArray): ShortArray = pending.also { pending = input.copyOf() }
            override fun close() = Unit
        } }, nowNanos = { 138_000_000L })
        val call = AudioStreamId(100, "telephony")
        mixer.offer(call, 48000, 1, pcm(16000, frames = 480), deadlineNanos = 125_000_000L)
        mixer.offer(call, 48000, 1, pcm(-16000, frames = 480), deadlineNanos = 135_000_000L)
        assertTrue(mixer.next().all { it == 0.toShort() })
    }

    @Test fun expiringOneStreamPreservesOtherSpeechAndNavigationAttenuation() {
        val mixer = mixer { 200_000_000L }
        mixer.offer(AudioStreamId(100, "telephony"), 48000, 1, pcm(16000), deadlineNanos = 0L)
        mixer.offer(AudioStreamId(100, "default"), 48000, 1, pcm(12000), deadlineNanos = 300_000_000L)
        assertEquals(3000, mixer.next()[300].toInt())
    }
}
