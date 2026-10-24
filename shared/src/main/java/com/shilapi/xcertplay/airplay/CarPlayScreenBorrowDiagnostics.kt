package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.util.concurrent.atomic.AtomicLong

/** Known local boundaries only; an unspecified caller must not manufacture a peer failure. */
internal enum class CarPlayConnectionCloseReason {
    UNSPECIFIED, CONTROL_STOPPED, PEER_EOF, CONTROL_DECRYPT_FAILED, CONTROL_IO_FAILED,
    EVENT_STOPPED, EVENT_EOF, EVENT_CIPHER_UNAVAILABLE, EVENT_DECRYPT_FAILED, EVENT_IO_FAILED,
    EVENT_AUTH_UNAVAILABLE, EVENT_ACCEPT_FAILED, EVENT_SEND_FAILED,
    SCREEN_RETURN_WITHOUT_STREAM,
}

internal enum class CarPlayScreenDataBoundary { SETUP, DATA_EOF, DATA_FAILED, TEARDOWN }

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

    /** Resource ownership and a live data stream are independent facts. */
    @Synchronized fun screen(boundary: CarPlayScreenDataBoundary, available: Boolean, state: CarPlayScreenBorrowState) {
        if (!closed) append("SCREEN", boundary.name, state, " screenAvailable=$available")
    }

    @Synchronized fun command(event: CarPlayCommandResults.Event, state: CarPlayScreenBorrowState) {
        if (!closed) append("COMMAND", event.boundary.name, state,
            " eventGeneration=${event.generation} cseq=${event.cseq} borrowed=${event.borrowed}" +
                " elapsedUs=${event.elapsedNanos / 1_000} rtspStatus=${event.rtspStatus ?: "UNKNOWN"}" +
                " commandStatus=${event.commandStatus ?: "UNKNOWN"} result=${event.result}")
    }

    /** Record retirement even if the loan state never differed from its default. */
    @Synchronized fun closed(reason: CarPlayConnectionCloseReason, state: CarPlayScreenBorrowState) {
        if (closed) return
        closed = true
        append("CLOSE", reason.name, state)
    }

    private fun append(event: String, reason: String, state: CarPlayScreenBorrowState, extra: String = "") {
        // Capture failures and clear/disable races cannot interrupt control or listener delivery.
        // No payload or string supplied by the sender enters this fixed schema.
        runCatching {
            val capture = activeCapture() ?: return
            val line = "schema=1 connectionId=$connectionId event=$event reason=$reason " +
                "desired=${state.desired} sent=${state.sent} owner=${state.owner} " +
                "pending=${state.pending} confirmedBorrow=${state.confirmedBorrow} " +
                "carPlayHasScreen=${state.carPlayHasScreen}$extra\n"
            record(capture, CHANNEL, line.toByteArray(Charsets.UTF_8))
        }
    }

    private companion object {
        val nextConnectionId = AtomicLong()
        const val CHANNEL = "iphone/carplay-screen-loan/events"
    }
}
