package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverDeviceTrust
import java.io.Closeable

/** Bridge between the receiver and the already-authenticated browser control channel. */
object AirPlayTrustNotifications {
    private var current: ReceiverDeviceTrust? = null

    @Synchronized fun attach(trust: ReceiverDeviceTrust): Closeable {
        current?.close()
        current = trust
        return Closeable {
            synchronized(this) {
                if (current === trust) { current = null; trust.close() }
            }
        }
    }

    @Synchronized fun browserSeen(session: String) { current?.browserSeen(session) }
    @Synchronized fun browserGone(session: String) { current?.browserGone(session) }
    @Synchronized fun prompt(session: String): Map<String, Any?>? = current?.prompt(session)
    @Synchronized fun respond(session: String, id: String, allow: Boolean): Boolean = current?.respond(session, id, allow) == true
    @Synchronized fun forgetAll() { current?.forgetAll() }
}
