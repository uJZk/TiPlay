package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import java.io.Closeable
import java.io.InputStream
import java.net.Socket
import java.util.concurrent.atomic.AtomicReference

/** Shares the live ordinary receiver's discovery profile with the fixed CarPlay listener. */
internal object ReceiverDiscoveryInfo {
    class Discovery internal constructor(val response: RtspMessage.Response, internal val owner: Any?)
    private class Registration(val provider: () -> ReceiverConfig?,
        val serveLegacyConnection: ((Socket, InputStream, List<RtspMessage.Request>) -> Boolean)?)
    private class Lease(val registration: Registration) : Closeable {
        override fun close() { current.compareAndSet(registration, null) }
    }
    private val current = AtomicReference<Registration?>()

    /** A retired receiver can release only its own registration, never its replacement's. */
    fun register(provider: () -> ReceiverConfig?): Closeable {
        return attach(provider, null)
    }

    fun register(provider: () -> ReceiverConfig?,
        serveLegacyConnection: (Socket, InputStream, List<RtspMessage.Request>) -> Boolean): Closeable =
        attach(provider, serveLegacyConnection)

    private fun attach(provider: () -> ReceiverConfig?,
        serveLegacyConnection: ((Socket, InputStream, List<RtspMessage.Request>) -> Boolean)?): Closeable {
        val registration = Registration(provider, serveLegacyConnection)
        current.set(registration)
        return Lease(registration)
    }

    fun isCurrent(lease: Closeable?): Boolean = lease is Lease && current.get() === lease.registration

    fun isLegacyStart(request: RtspMessage.Request): Boolean = request.method == "POST" &&
        request.protocol == "RTSP/1.0" && request.path == "/fp-setup"

    /** Runs the receiver on the accepted socket; no loopback proxy or peer replacement. */
    fun serveLegacyConnection(socket: Socket, input: InputStream,
        initialRequests: List<RtspMessage.Request>, discovery: Discovery? = null): Boolean {
        if (initialRequests.firstOrNull()?.let(::isLegacyStart) != true) return false
        val registration = current.get() ?: return false
        if (discovery != null && discovery.owner !== registration) return false
        val serve = registration.serveLegacyConnection ?: return false
        if (runCatching { registration.provider() }.getOrNull() == null || current.get() !== registration) return false
        return serve(socket, input, initialRequests)
    }

    /**
     * The observed Bluetooth probe has no CSeq and explicitly identifies its discovery origin.
     * Keep all ordinary CarPlay info and pairing requests on their existing session routes.
     *
     * UxPlay's matching probe and DNS-SD TXT data format are described in raop.c/raop_handlers.h
     * at commit 48f5ce47c9ef694afccfac907c9e8828329657fe. No service port is added to this plist;
     * Bonjour still advertises the ordinary listener's port; this listener also adopts explicit
     * legacy FairPlay connections so its discovery identity describes a usable endpoint.
     */
    fun isBluetoothProbe(request: RtspMessage.Request): Boolean =
        request.method == "GET" && request.protocol == "RTSP/1.0" &&
            request.path.substringBefore('?') == "/info" && request.body.isEmpty() &&
            !request.headers.containsKey("cseq") &&
            request.headers["x-apple-qr"].equals("BT", ignoreCase = true) &&
            ReceiverInfoProtocol.queryTxtKeys(request).isNotEmpty()

    fun response(request: RtspMessage.Request): RtspMessage.Response? = discover(request)?.response

    fun discover(request: RtspMessage.Request, previous: Discovery? = null): Discovery? {
        if (!isBluetoothProbe(request)) return null

        val registration = current.get() ?: return Discovery(unavailable(), previous?.owner)
        if (previous != null && previous.owner !== registration) return Discovery(unavailable(), previous.owner)
        val config = runCatching { registration.provider() }.getOrNull() ?: return Discovery(unavailable(), registration)
        val response = ReceiverInfoProtocol.response(config, request)
        // A provider may race receiver replacement or shutdown while taking its snapshot.
        return Discovery(if (current.get() === registration) response else unavailable(), registration)
    }

    private fun unavailable() = RtspMessage.Response(status = 503, statusText = "Service Unavailable")
}
