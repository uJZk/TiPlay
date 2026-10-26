package com.shilapi.xcertplay.web

import java.io.Closeable
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bounded native-audio negotiation lane; never occupies the application RPC or video native lock. */
internal class BrowserRtcAudioSignaling(
    private val router: BrowserRtcAudioRouter,
    private val authenticated: () -> Boolean,
    private val live: () -> Boolean,
    private val respond: (String) -> Unit,
) : Closeable {
    private val closed = AtomicBoolean()
    private val worker = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, SynchronousQueue(),
        { task -> Thread(task, "browser-rtc-audio-sdp").apply { isDaemon = true } })

    fun offer(fields: Map<*, *>) {
        val q = fields["q"]
        val next = (fields["generation"] as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 1 && it <= Int.MAX_VALUE && it % 1.0 == 0.0 }?.toInt()
        fun reply(error: String?, answer: String? = null) {
            if (closed.get() || !live()) return
            val response = linkedMapOf<String, Any?>("q" to q, "k" to "audio-answer", "generation" to next,
                "audioTransport" to BrowserRtcAudioRouter.TRANSPORT)
            if (error != null) response["error"] = error else response["sdp"] = answer
            respond(WebJson.write(response))
        }
        try {
            check(!closed.get() && live()) { "audio-peer-closed" }
            check(authenticated()) { "authentication-required" }
            require(q is Number && q.toDouble().isFinite() && q.toDouble() >= 0 && q.toDouble() <= 9007199254740991.0
                && q.toLong().toDouble() == q.toDouble()) { "invalid-audio-request" }
            require(next != null) { "invalid-audio-generation" }
            val sdp = fields["sdp"] as? String ?: error("invalid-audio-offer")
            BrowserRtcAudioRouter.parseOffer(sdp)
            worker.execute {
                try {
                    check(!closed.get() && live() && authenticated()) { "audio-peer-closed" }
                    val answer = router.answer(sdp, next)
                    reply(null, answer)
                } catch (cause: Exception) { reply(reason(cause)) }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) { reply("audio-negotiation-busy") }
        catch (cause: Exception) { reply(reason(cause)) }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        router.close() // Cancels native gathering rather than waiting for the executor.
        worker.shutdownNow()
    }
    private fun reason(cause: Exception): String = cause.message?.takeIf { it in SAFE_ERRORS } ?: "audio-negotiation-failed"
    private companion object {
        val SAFE_ERRORS = setOf("authentication-required", "invalid-audio-request", "invalid-audio-generation",
            "invalid-audio-offer", "stale-audio-generation", "audio-peer-closed", "audio-only-offer-required",
            "audio-offer-must-be-receive-only", "audio-opus-not-negotiated", "audio-non-host-candidate",
            "duplicate-audio-mid", "invalid-audio-mid", "audio-mid-required", "audio-rtcp-mux-required",
            "audio-inactive-slot", "invalid-audio-slot-count", "audio-native-library-unavailable")
    }
}
