package com.shilapi.xcertplay.web

/** Browser consumer ownership, independent of audio record sequence and SCTP delivery. */
internal class BrowserRtcAudioLease {
    data class Lease(val generation: Int, val revision: Long)
    private var generation: Int? = null
    private var enabled = false
    private var revision = 0L

    /** Ignore delayed cancellation/retries belonging to an older browser consumer. */
    @Synchronized fun request(enable: Boolean, next: Int): Boolean {
        if (!enable) {
            if (!enabled || generation != next) return false
            enabled = false
        } else {
            generation?.let { previous ->
                val distance = (next.toLong() - previous.toLong()) and 0xffff_ffffL
                if (distance == 0L || distance > 0x7fff_ffffL) return false
            }
            generation = next
            enabled = true
        }
        revision++
        return true
    }

    @Synchronized fun current(): Lease? = if (enabled) Lease(requireNotNull(generation), revision) else null
    @Synchronized fun owns(lease: Lease): Boolean = enabled && generation == lease.generation && revision == lease.revision
}

/** A whole unsent audio record can be retired before credit admission; a partial record must finish. */
internal class BrowserRtcAudioLeaseRetired : IllegalStateException("audio-lease-retired")
