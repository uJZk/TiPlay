package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.AudioStreamId
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class BluetoothVoiceMixerTest {
    private fun pcm(value: Int, frames: Int = 960, channels: Int = 1) = ByteArray(frames * channels * 2) { index ->
        (if (index % 2 == 0) value else value shr 8).toByte()
    }
    @Test fun protocolGuidanceIsAllowedButMediaAlertsAndUnknownPurposesAreDropped() {
        val mixer = BluetoothVoiceMixer()
        for (id in listOf(AudioStreamId(103, "media"), AudioStreamId(102, "compatibility"),
            AudioStreamId(100, "alert"), AudioStreamId(100, "unknown"))) mixer.offer(id, 48000, 1, pcm(20000))
        assertTrue(mixer.next().all { it == 0.toShort() })
        mixer.offer(AudioStreamId(100, "default"), 48000, 1, pcm(10000))
        assertEquals(2500, mixer.next()[0].toInt())
    }
    @Test fun bluetoothNavigationIsAlwaysAttenuatedEvenWhenCallSamplesEndAndMixIsClipped() {
        val mixer = BluetoothVoiceMixer()
        val navigation = AudioStreamId(100, "default"); val call = AudioStreamId(100, "telephony")
        mixer.offer(navigation, 48000, 2, pcm(12000, channels = 2))
        mixer.offer(call, 48000, 1, pcm(20000, frames = 480))
        val mixed = mixer.next()
        assertEquals(23000, mixed[100].toInt())
        assertEquals(3000, mixed[600].toInt())
        mixer.clear()
        mixer.offer(call, 48000, 1, pcm(32000))
        mixer.offer(AudioStreamId(100, "speechrecognition"), 48000, 1, pcm(32000))
        assertEquals(32767, mixer.next()[0].toInt())
    }
    @Test fun unpacedLiveProducerKeepsOnlyItsFreshBoundedTailAndStopClearsIt() {
        val mixer = BluetoothVoiceMixer(); val call = AudioStreamId(100, "telephony")
        repeat(20) { mixer.offer(call, 48000, 1, pcm(it * 1000)) }
        assertTrue(mixer.next().all { it >= 11000.toShort() })
        mixer.clear(call)
        assertTrue(mixer.next().all { it == 0.toShort() })
    }
    @Test fun continuousCaptureResamplingPreservesNegotiatedDurationAcrossReadBoundaries() {
        val resampler = VoicePcmResampler(16000, 48000)
        val frames = (0 until 50).map { resampler.convert(ShortArray(320) { 1000 }) }
        assertEquals(47997, frames.sumOf { it.size }) // One source sample of interpolation delay, then exact pacing.
        assertTrue(frames.flatMap { it.toList() }.all { it == 1000.toShort() })
    }
    @Test fun downsamplingFiltersFrequenciesAboveTheNewNyquistLimit() {
        fun energy(frequency: Int): Double {
            val resampler = VoicePcmResampler(96000, 48000)
            val input = ShortArray(96000) { (sin(2 * PI * frequency * it / 96000) * 20000).toInt().toShort() }
            return resampler.convert(input).drop(100).sumOf { it.toDouble() * it }
        }
        assertTrue(energy(40000) / energy(1000) < 0.001)
    }
}
