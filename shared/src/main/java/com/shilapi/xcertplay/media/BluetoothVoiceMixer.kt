package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.AudioStreamId
import java.util.ArrayDeque
import kotlin.math.roundToInt

/** Bounded, paced mono speech mixer; Android converts its output to the negotiated SCO rate. */
internal class BluetoothVoiceMixer @JvmOverloads constructor(val rate: Int = 48_000,
    private val createResampler: (Int, Int) -> PcmResampler = ::NativePcmResampler,
    private val nowNanos: () -> Long = System::nanoTime) {
    private class Stream(val rate: Int, val channels: Int, outputRate: Int,
        createResampler: (Int, Int) -> PcmResampler) {
        var resampler = createResampler(rate, outputRate)
        private val samples = ShortArray(outputRate * 160 / 1000)
        private val deadlines = LongArray(samples.size)
        var inputFrames = 0L
        var outputFrames = 0L
        private var head = 0
        var size = 0
            private set
        val boundaries = ArrayDeque<Long>()
        var readPosition = 0L
        var writePosition = 0L
        var last = 0.0
        var starved = true
        var blendFrom = 0.0
        var blendRemaining = 0

        fun boundary() {
            if (boundaries.peekLast() != writePosition) boundaries.addLast(writePosition)
        }

        fun append(sample: Short, deadline: Long): Boolean {
            val full = size == samples.size
            if (full) { head = (head + 1) % samples.size; readPosition++; size-- }
            samples[(head + size) % samples.size] = sample
            deadlines[(head + size) % samples.size] = deadline
            size++; writePosition++
            return full
        }

        fun next(fadeFrames: Int, atNanos: Long): Double {
            var expired = false
            while (size > 0 && deadlines[head] < atNanos) {
                head = (head + 1) % samples.size; size--; readPosition++; expired = true
            }
            if (expired) {
                while (boundaries.peekFirst()?.let { it <= readPosition } == true) boundaries.removeFirst()
                starved = true
                blendFrom = last; blendRemaining = fadeFrames
            }
            if (size > 0 && boundaries.peekFirst() == readPosition) {
                boundaries.removeFirst()
                starved = true
            }
            if (size > 0) {
                val sample = samples[head].toDouble()
                head = (head + 1) % samples.size; size--
                readPosition++
                if (starved) {
                    starved = false
                    blendFrom = last
                    blendRemaining = fadeFrames
                }
                val previousWeight = (blendRemaining - 1).coerceAtLeast(0).toDouble() / fadeFrames
                last = sample * (1.0 - previousWeight) + blendFrom * previousWeight
            } else {
                if (!starved) {
                    starved = true
                    blendFrom = last
                    blendRemaining = fadeFrames
                }
                last = blendFrom * (blendRemaining - 1).coerceAtLeast(0).toDouble() / fadeFrames
            }
            if (blendRemaining > 0) blendRemaining--
            return last
        }
    }
    private val streams = mutableMapOf<AudioStreamId, Stream>()
    private val maximum = rate * 160 / 1000
    // Blend in place: do not append samples or wait for a new buffer.
    private val fadeFrames = (rate * 5 / 1000).coerceAtLeast(1)
    @Synchronized fun offer(id: AudioStreamId, inputRate: Int, channels: Int, pcm: ByteArray, discontinuity: Boolean = false, deadlineNanos: Long = Long.MAX_VALUE) {
        if (!BluetoothVoicePolicy.allowed(id) || inputRate !in 8000..96000 || channels !in 1..2 || pcm.size % (channels * 2) != 0) return
        var stream = streams[id]
        if (stream == null || stream.rate != inputRate || stream.channels != channels) {
            val previousOutput = stream?.last ?: 0.0
            stream?.resampler?.close()
            stream = Stream(inputRate, channels, rate, createResampler).also { it.last = previousOutput }; streams[id] = stream
        }
        if (discontinuity) {
            stream.boundary()
            // A missing source interval must not interpolate against the previous packet's tail.
            stream.resampler.close()
            stream.resampler = createResampler(inputRate, rate)
            stream.inputFrames = 0; stream.outputFrames = 0
        }
        val mono = ShortArray(pcm.size / (channels * 2)) { frame ->
            var sum = 0
            repeat(channels) { channel ->
                val offset = (frame * channels + channel) * 2
                sum += ((pcm[offset].toInt() and 255) or (pcm[offset + 1].toInt() shl 8)).toShort().toInt()
            }
            (sum / channels).toShort()
        }
        val outputDeadline = if (deadlineNanos == Long.MAX_VALUE) Long.MAX_VALUE else deadlineNanos +
            ((stream.outputFrames.toDouble() / rate - stream.inputFrames.toDouble() / inputRate) * 1_000_000_000.0).toLong()
        val converted = stream.resampler.convert(mono)
        stream.inputFrames += mono.size; stream.outputFrames += converted.size
        var trimmed = converted.size > maximum
        for (index in (converted.size - maximum).coerceAtLeast(0) until converted.size) {
            val deadline = if (outputDeadline == Long.MAX_VALUE) Long.MAX_VALUE else outputDeadline + index.toLong() * 1_000_000_000L / rate
            if (stream.append(converted[index], deadline)) trimmed = true
        }
        if (trimmed) {
            while (stream.boundaries.peekFirst()?.let { it <= stream.readPosition } == true) stream.boundaries.removeFirst()
            // The next retained sample is no longer adjacent to the last audible one.
            stream.starved = true
        }
    }
    @Synchronized fun clear(id: AudioStreamId) { streams.remove(id)?.resampler?.close() }
    @Synchronized fun clear() { streams.values.forEach { it.resampler.close() }; streams.clear() }
    @Synchronized fun next(frames: Int = rate / 50, outputLeadNanos: Long = 0): ShortArray {
        val at = nowNanos() + outputLeadNanos.coerceAtLeast(0)
        return ShortArray(frames) { index ->
            var sum = 0.0
            val presentation = at + index.toLong() * 1_000_000_000L / rate
            streams.forEach { (id, stream) ->
                val sample = stream.next(fadeFrames, presentation)
                sum += sample * if (BluetoothVoicePolicy.navigation(id)) 0.25 else 1.0
            }
            sum.roundToInt().coerceIn(-32768, 32767).toShort()
        }
    }
}
