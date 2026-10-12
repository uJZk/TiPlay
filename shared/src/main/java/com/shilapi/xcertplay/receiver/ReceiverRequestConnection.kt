package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import java.io.Closeable

/** Media/protocol state without a reader: the unified endpoint owns TCP framing and replies. */
interface ReceiverRequestConnection : Closeable {
    fun handle(request: RtspMessage.Request): RtspMessage.Response
    fun responseSent(response: RtspMessage.Response) {}
}
