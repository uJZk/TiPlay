package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import java.io.Closeable
import java.util.concurrent.atomic.AtomicReference

/** Shares the live ordinary receiver's discovery profile with the fixed CarPlay listener. */
internal object ReceiverDiscoveryInfo {
    private class Registration(val provider: () -> ReceiverConfig?)
    private val current = AtomicReference<Registration?>()

    /** A retired receiver can release only its own registration, never its replacement's. */
    fun register(provider: () -> ReceiverConfig?): Closeable {
        val registration = Registration(provider)
        current.set(registration)
        return Closeable { current.compareAndSet(registration, null) }
    }

    /**
     * The observed Bluetooth probe has no CSeq and explicitly identifies its discovery origin.
     * Keep all ordinary CarPlay info and pairing requests on their existing session routes.
     *
     * UxPlay's matching probe and DNS-SD TXT data format are described in raop.c/raop_handlers.h
     * at commit 48f5ce47c9ef694afccfac907c9e8828329657fe. No service port is added to this plist;
     * the ordinary receiver's SRV record remains responsible for service-port discovery.
     */
    fun response(request: RtspMessage.Request): RtspMessage.Response? {
        if (request.method != "GET" || request.protocol != "RTSP/1.0" ||
            request.path.substringBefore('?') != "/info" || request.body.isNotEmpty() ||
            request.headers.containsKey("cseq") ||
            !request.headers["x-apple-qr"].equals("BT", ignoreCase = true) ||
            ReceiverInfoProtocol.queryTxtKeys(request).isEmpty()) return null

        val registration = current.get() ?: return unavailable()
        val config = registration.provider() ?: return unavailable()
        val response = ReceiverInfoProtocol.response(config, request)
        // A provider may race receiver replacement or shutdown while taking its snapshot.
        return if (current.get() === registration) response else unavailable()
    }

    private fun unavailable() = RtspMessage.Response(status = 503, statusText = "Service Unavailable")
}
