package com.shilapi.xcertplay.receiver

import java.net.BindException
import java.net.DatagramSocket
import java.net.InetSocketAddress

/** Socket close is nonblocking while a native receive unwinds. Verify release of the exact port. */
internal fun awaitReleasedUdpPort(socket: DatagramSocket, address: InetSocketAddress) {
    val deadline = System.nanoTime() + 1_000_000_000L
    while (true) {
        try { socket.bind(address); return }
        catch (failure: BindException) {
            if (System.nanoTime() >= deadline) throw failure
            Thread.sleep(5)
        }
    }
}
