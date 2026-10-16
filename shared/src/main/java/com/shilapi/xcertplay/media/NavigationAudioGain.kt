package com.shilapi.xcertplay.media

import kotlin.math.pow

/** Per-track navigation attenuation; never changes the head unit's system stream volume. */
object NavigationAudioGain {
    const val MIN_DB = -20
    const val MAX_DB = 0

    fun clamp(db: Int): Int = db.coerceIn(MIN_DB, MAX_DB)

    /** Amplitude scale (not a percent); -20 dB = 0.1 and 0 dB = 1.0. */
    fun linear(db: Int): Float = 10.0.pow(clamp(db) / 20.0).toFloat()
}
