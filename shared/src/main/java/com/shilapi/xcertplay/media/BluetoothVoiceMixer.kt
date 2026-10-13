package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.AudioStreamId
import java.util.ArrayDeque
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** Bounded, paced mono speech mixer; Android converts its output to the negotiated SCO rate. */
internal class BluetoothVoiceMixer(val rate: Int = 48_000) {
    private class Stream(val rate: Int, val channels: Int, outputRate: Int) {
        val resampler = VoicePcmResampler(rate, outputRate)
        val samples = ArrayDeque<Short>()
    }
    private val streams = mutableMapOf<AudioStreamId, Stream>()
    private val maximum = rate * 160 / 1000
    @Synchronized fun offer(id: AudioStreamId, inputRate: Int, channels: Int, pcm: ByteArray) {
        if (!BluetoothVoicePolicy.allowed(id) || inputRate !in 8000..96000 || channels !in 1..2 || pcm.size % (channels * 2) != 0) return
        var stream = streams[id]
        if (stream == null || stream.rate != inputRate || stream.channels != channels) {
            stream = Stream(inputRate, channels, rate); streams[id] = stream
        }
        val mono = ShortArray(pcm.size / (channels * 2)) { frame ->
            var sum = 0
            repeat(channels) { channel ->
                val offset = (frame * channels + channel) * 2
                sum += ((pcm[offset].toInt() and 255) or (pcm[offset + 1].toInt() shl 8)).toShort().toInt()
            }
            (sum / channels).toShort()
        }
        val converted = stream.resampler.convert(mono)
        for (index in (converted.size - maximum).coerceAtLeast(0) until converted.size) {
            if (stream.samples.size == maximum) stream.samples.removeFirst()
            stream.samples.addLast(converted[index])
        }
    }
    @Synchronized fun clear(id: AudioStreamId) { streams.remove(id) }
    @Synchronized fun clear() { streams.clear() }
    @Synchronized fun next(frames: Int = rate / 50): ShortArray = ShortArray(frames) {
        var sum = 0.0
        streams.forEach { (id, stream) ->
            val sample = stream.samples.pollFirst()?.toDouble() ?: 0.0
            sum += sample * if (BluetoothVoicePolicy.navigation(id)) 0.25 else 1.0
        }
        sum.roundToInt().coerceIn(-32768, 32767).toShort()
    }
}

/** Continuous resampling with anti-alias filtering when reducing a negotiated PCM sample rate. */
internal class VoicePcmResampler(inputRate: Int, outputRate: Int) {
    private val numerator = inputRate.toLong()
    private val denominator = outputRate.toLong()
    private var position = 0L
    private var previous = 0.0
    private val history = DoubleArray(33)
    private var cursor = 0
    private val filter = if (outputRate >= inputRate) null else {
        val cutoff = 0.45 * outputRate / inputRate
        DoubleArray(33) { i ->
            val x = i - 16
            (if (x == 0) 2 * cutoff else sin(2 * PI * cutoff * x) / (PI * x)) * (0.54 - 0.46 * cos(2 * PI * i / 32))
        }.also { taps -> val sum = taps.sum(); for (i in taps.indices) taps[i] /= sum }
    }
    fun convert(input: ShortArray): ShortArray {
        if (input.isEmpty()) return ShortArray(0)
        val filtered = DoubleArray(input.size) { i ->
            val sample = input[i].toDouble()
            val taps = filter
            if (taps == null) sample else {
                history[cursor] = sample
                var value = 0.0
                taps.indices.forEach { tap -> value += taps[tap] * history[(cursor - tap + history.size) % history.size] }
                cursor = (cursor + 1) % history.size
                value
            }
        }
        val output = ArrayList<Short>()
        while (position < (filtered.size - 1) * denominator) {
            val index = Math.floorDiv(position, denominator).toInt()
            val fraction = (position - index * denominator).toDouble() / denominator
            val a = if (index < 0) previous else filtered[index]
            val b = filtered[index + 1]
            output += (a + (b - a) * fraction).roundToInt().coerceIn(-32768, 32767).toShort()
            position += numerator
        }
        position -= filtered.size * denominator
        previous = filtered.last()
        return output.toShortArray()
    }
}
