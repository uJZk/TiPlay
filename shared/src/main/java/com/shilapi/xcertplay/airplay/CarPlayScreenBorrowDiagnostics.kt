package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.util.concurrent.atomic.AtomicLong

/** Known local boundaries only; an unspecified caller must not manufacture a peer failure. */
internal enum class CarPlayConnectionCloseReason {
    UNSPECIFIED, CONTROL_STOPPED, PEER_EOF, CONTROL_DECRYPT_FAILED, CONTROL_IO_FAILED,
    EVENT_STOPPED, EVENT_EOF, EVENT_CIPHER_UNAVAILABLE, EVENT_DECRYPT_FAILED, EVENT_IO_FAILED,
    EVENT_AUTH_UNAVAILABLE, EVENT_ACCEPT_FAILED, EVENT_SEND_FAILED,
}

/** Sparse semantic evidence beside encrypted wire bytes, with no peer or authentication identity. */
internal class CarPlayScreenBorrowDiagnostics(
    private val activeCapture: () -> String? = RawTraffic::activeSessionId,
    private val record: (String, String, ByteArray) -> Boolean = RawTraffic::recordForSession,
) {
    private val connectionId = nextConnectionId.incrementAndGet()
    private var closed = false

    @Synchronized fun changed(state: CarPlayScreenBorrowState) {
        if (!closed) append("STATE", "NONE", state)
    }

    /** Record retirement even if the loan state never differed from its default. */
    @Synchronized fun closed(reason: CarPlayConnectionCloseReason, state: CarPlayScreenBorrowState) {
        if (closed) return
        closed = true
        append("CLOSE", reason.name, state)
    }

    private fun append(event: String, reason: String, state: CarPlayScreenBorrowState) {
        // Capture failures and clear/disable races cannot interrupt control or listener delivery.
        // No payload or string supplied by the sender enters this fixed schema.
        runCatching {
            val capture = activeCapture() ?: return
            val line = "schema=1 connectionId=$connectionId event=$event reason=$reason " +
                "desired=${state.desired} sent=${state.sent} owner=${state.owner} " +
                "pending=${state.pending} confirmedBorrow=${state.confirmedBorrow} " +
                "carPlayHasScreen=${state.carPlayHasScreen}\n"
            record(capture, CHANNEL, line.toByteArray(Charsets.UTF_8))
        }
    }

    private companion object {
        val nextConnectionId = AtomicLong()
        const val CHANNEL = "iphone/carplay-screen-loan/events"
    }
}
