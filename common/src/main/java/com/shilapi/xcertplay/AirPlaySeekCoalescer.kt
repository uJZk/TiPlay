package com.shilapi.xcertplay

/** iPhone slider updates can arrive faster than FCUP resources can be cancelled and reopened. */
internal class AirPlaySeekCoalescer(private val schedule: (Runnable, Long) -> Unit,
                                   private val cancelScheduled: (Runnable) -> Unit,
                                   private val delayMillis: Long = 150,
                                   private val seek: (Double) -> Unit) {
    private var pending: Runnable? = null
    private var generation = 0L

    fun request(seconds: Double) {
        cancel()
        val token = generation
        val next = Runnable {
            if (generation == token) {
                pending = null
                seek(seconds)
            }
        }
        pending = next
        schedule(next, delayMillis)
    }

    fun cancel() {
        generation++
        pending?.let(cancelScheduled)
        pending = null
    }
}
