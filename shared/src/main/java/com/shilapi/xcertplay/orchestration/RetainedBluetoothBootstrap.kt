package com.shilapi.xcertplay.orchestration

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import com.shilapi.xcertplay.iap2.session.Iap2Session
import com.shilapi.xcertplay.iap2.wire.Iap2Frame
import com.shilapi.xcertplay.mfi.Iap2MfiAuthenticationClient
import com.shilapi.xcertplay.mfi.MfiAuthenticator
import com.shilapi.xcertplay.transport.BluetoothRfcommDuplexStream
import com.shilapi.xcertplay.transport.Iap2ArtworkTransfer
import com.shilapi.xcertplay.transport.Iap2IdentificationConfig
import com.shilapi.xcertplay.transport.Iap2WirelessCarPlayEndpoint
import com.shilapi.xcertplay.transport.Iap2WirelessControlClient
import java.io.IOException
import java.util.UUID

/** Re-enters iPhone discovery without releasing the existing Wi-Fi listener or MFi session. */
internal class RetainedBluetoothBootstrap : AutoCloseable {
    private val resources = mutableListOf<AutoCloseable>()
    @Volatile private var closed = false
    val isClosed: Boolean get() = closed

    fun run(
        device: BluetoothDevice,
        connect: (BluetoothSocket, String) -> Unit,
        identification: Iap2IdentificationConfig,
        endpoint: Iap2WirelessCarPlayEndpoint,
        mfi: MfiAuthenticator,
        log: (String) -> Unit,
        onIncoming: (Iap2Frame) -> Unit,
        onArtwork: (Iap2ArtworkTransfer) -> Unit,
        receiveArtwork: Boolean = true,
        receiveText: Boolean = true,
    ) {
        val socket = own(device.createRfcommSocketToServiceRecord(
            UUID.fromString("00000000-deca-fade-deca-deafdecacafe")))
        log("browser display reconnect bootstrap started")
        connect(socket, device.address)
        log("browser display reconnect Bluetooth connected")
        val stream = own(BluetoothRfcommDuplexStream(socket, log))
        val channel = own(Iap2Session.openWireless(stream,
            traceContext = "browser-resize-rfcomm", onTrace = log, onArtwork = onArtwork, receiveArtwork = receiveArtwork))
        Iap2WirelessControlClient(channel, Iap2MfiAuthenticationClient(mfi), receiveArtwork, receiveText).run(
            identification = identification,
            endpoint = endpoint,
            timeoutMillis = 30_000,
            keepAliveAfterDeadline = { !closed },
            onReady = { log("browser display reconnect bootstrap ready") },
            onStartSessionSent = { log("browser display reconnect bootstrap StartSession sent") },
            onIncoming = onIncoming,
            onProgress = log,
        )
    }

    @Synchronized internal fun <T : AutoCloseable> own(resource: T): T {
        if (closed) {
            resource.close()
            throw IOException("Retained Bluetooth bootstrap closed")
        }
        resources += resource
        return resource
    }

    override fun close() {
        val retiring = synchronized(this) {
            if (closed) return
            closed = true
            resources.asReversed().toList().also { resources.clear() }
        }
        retiring.forEach { resource -> runCatching { resource.close() } }
    }
}
