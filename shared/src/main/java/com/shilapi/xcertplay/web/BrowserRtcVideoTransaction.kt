package com.shilapi.xcertplay.web

/** One authenticated peer's last video SDP transaction; retries never apply SDP twice. */
internal class BrowserRtcVideoTransaction {
    private data class Answer(val q: Int, val generation: Int, val offer: String, val response: String)
    private var answer: Answer? = null

    @Synchronized fun replay(q: Int, generation: Int, offer: String): String? {
        val previous = answer ?: return null
        if (q != previous.q) return null
        check(generation == previous.generation && offer == previous.offer) { "video-transaction-conflict" }
        return previous.response
    }

    @Synchronized fun save(q: Int, generation: Int, offer: String, response: String) {
        check(offer.toByteArray(Charsets.UTF_8).size <= 48 * 1024) { "invalid-video-offer" }
        check(response.toByteArray(Charsets.UTF_8).size <= 64 * 1024) { "video-answer-size" }
        answer = Answer(q, generation, offer, response)
    }
}
