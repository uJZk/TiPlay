/* SPDX-License-Identifier: GPL-3.0-only */
package com.shilapi.xcertplay.media

import java.io.Closeable
import kotlin.math.ceil
import kotlin.math.roundToInt

/** The browser's float32 vr32/HQ engine, built directly for Android; each stream owns its handle. */
internal class NativeSoxr(ratio: Double, channels: Int = 1) : Closeable {
    private var handle = nativeCreate(ratio, channels).also { check(it != 0L) { "Could not create native libsoxr" } }
    @Synchronized fun process(input: FloatArray, frames: Int, output: FloatArray, capacity: Int): Long {
        check(handle != 0L)
        return nativeProcess(handle, input, frames, output, capacity).also { check(it >= 0L) { "Native libsoxr processing failed" } }
    }
    @Synchronized fun ratio(value: Double, slewFrames: Int) {
        check(handle != 0L && nativeRatio(handle, value, slewFrames))
    }
    @Synchronized override fun close() {
        if (handle != 0L) nativeDestroy(handle)
        handle = 0L
    }
    companion object {
        init { System.loadLibrary("tiplay_soxr") }
        @JvmStatic private external fun nativeCreate(ratio: Double, channels: Int): Long
        @JvmStatic private external fun nativeProcess(handle: Long, input: FloatArray, frames: Int, output: FloatArray, capacity: Int): Long
        @JvmStatic private external fun nativeRatio(handle: Long, ratio: Double, slew: Int): Boolean
        @JvmStatic private external fun nativeDestroy(handle: Long)
    }
}

internal interface PcmResampler : Closeable {
    fun convert(input: ShortArray): ShortArray
}

/** Continuous packet adapter: drain before feeding and preserve filter state through temporary shortages. */
internal class NativePcmResampler(private val inputRate: Int, private val outputRate: Int) : PcmResampler {
    private val engine = NativeSoxr(inputRate.toDouble() / outputRate)
    private val input = FloatArray(4096)
    private val output = FloatArray(512)
    override fun convert(input: ShortArray): ShortArray {
        if (input.isEmpty()) return ShortArray(0)
        var result = ShortArray(ceil(input.size.toDouble() * outputRate / inputRate).toInt() + output.size)
        var position = 0; var emitted = 0; var needInput = false
        val limit = input.size * 16 + 128
        var calls = 0
        while (position < input.size || !needInput) {
            check(calls++ < limit) { "Native resampler made no bounded progress" }
            val available = if (needInput) minOf(this.input.size, input.size - position) else 0
            repeat(available) { this.input[it] = input[position + it] / 32768f }
            val counts = engine.process(this.input, available, output, output.size)
            val consumed = (counts ushr 32).toInt(); val produced = counts.toInt()
            position += consumed
            if (emitted + produced > result.size) result = result.copyOf(maxOf(result.size * 2, emitted + produced))
            repeat(produced) { result[emitted++] = (output[it] * 32768.0).roundToInt().coerceIn(-32768, 32767).toShort() }
            if (consumed == 0 && produced == 0) {
                check(available == 0) { "Native resampler stalled with input" }
                if (position == input.size) break
                needInput = true
            } else needInput = false
        }
        return result.copyOf(emitted)
    }
    override fun close() = engine.close()
}
